// 定时任务引擎（所有平台共用）：一次性（时间戳）和 5 段 cron。
// 触发时调用 runner（平台负责启动插件并调用插件的回调），按结果记成功/失败。存储走 HostStore。
// hook：schedule:fire apply(args=[pluginId, code]) 可以拦截某次触发（返回 false 跳过）
import type { HookRegistry } from './hooks'
import type { HostStore } from './store'

export interface ScheduleTrigger { cron: string; startTime?: number; endTime?: number }
export interface ScheduleTask {
  code: string
  label: string
  trigger: number | ScheduleTrigger
  successCount: number
  failureCount: number
  lastExecuteAt?: number
  lastStatus?: 'success' | 'failure'
}

function field(spec: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part.trim())
    if (!m) return null
    const step = m[4] ? Number(m[4]) : 1
    const lo = m[1] === '*' ? min : Number(m[2])
    const hi = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : lo
    if (lo < min || hi > max || lo > hi || step < 1) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/** 5 段标准 cron（分 时 日 月 周），返回判断某一分钟是否命中的函数 */
export function parseCron(expr: string): ((d: Date) => boolean) | null {
  const parts = String(expr).trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [mi, h, dom, mon, dow] = [field(parts[0], 0, 59), field(parts[1], 0, 23), field(parts[2], 1, 31), field(parts[3], 1, 12), field(parts[4], 0, 7)]
  if (!mi || !h || !dom || !mon || !dow) return null
  if (dow.has(7)) dow.add(0)
  const domAny = parts[2] === '*'
  const dowAny = parts[4] === '*'
  return (d: Date) => {
    if (!mi.has(d.getMinutes()) || !h.has(d.getHours()) || !mon.has(d.getMonth() + 1)) return false
    if (domAny || dowAny) return dom.has(d.getDate()) && dow.has(d.getDay())
    return dom.has(d.getDate()) || dow.has(d.getDay())
  }
}

export interface SchedulerOptions {
  store: HostStore
  hooks: HookRegistry
  /** 触发：启动插件并调用它的定时任务回调；抛错或 reject 记为失败 */
  run: (pluginId: string, code: string) => Promise<void>
  log?: (msg: string) => void
  now?: () => number
}

const KEY = (id: string) => `schedules/${id}`

export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private ticker: ReturnType<typeof setTimeout> | null = null
  private lastTick = 0
  private running = new Set<string>()

  constructor(private o: SchedulerOptions) {}

  private now() {
    return this.o.now?.() ?? Date.now()
  }

  list(pluginId: string): ScheduleTask[] {
    return this.o.store.get<ScheduleTask[]>(KEY(pluginId)) ?? []
  }

  private save(pluginId: string, list: ScheduleTask[]) {
    this.o.store.set(KEY(pluginId), list)
  }

  /** 插件加载时调用：恢复它的一次性任务定时器 */
  load(pluginId: string) {
    for (const t of this.list(pluginId)) this.arm(pluginId, t)
    this.ensureTicker()
  }

  unload(pluginId: string) {
    for (const t of this.list(pluginId)) this.disarm(pluginId, t.code)
  }

  add(pluginId: string, s: { code: string; label: string; trigger: number | ScheduleTrigger }) {
    if (!s || typeof s.code !== 'string' || !s.code || typeof s.label !== 'string') throw new Error('定时任务需要 code 和 label')
    if (typeof s.trigger === 'number') {
      if (s.trigger <= this.now()) throw new Error('定时任务的时间已经过去')
    } else if (!s.trigger || !parseCron(s.trigger.cron)) throw new Error('cron 必须是 5 段标准格式')
    const list = this.list(pluginId).filter((t) => t.code !== s.code)
    this.disarm(pluginId, s.code)
    const task: ScheduleTask = { code: s.code, label: s.label, trigger: s.trigger, successCount: 0, failureCount: 0 }
    list.push(task)
    this.save(pluginId, list)
    this.arm(pluginId, task)
    this.ensureTicker()
  }

  remove(pluginId: string, code: string) {
    const list = this.list(pluginId)
    if (!list.some((t) => t.code === code)) throw new Error(`定时任务不存在：${code}`)
    this.disarm(pluginId, code)
    this.save(pluginId, list.filter((t) => t.code !== code))
  }

  private key(pluginId: string, code: string) {
    return `${pluginId}\u0000${code}`
  }

  private arm(pluginId: string, t: ScheduleTask) {
    if (typeof t.trigger !== 'number') return
    const delay = t.trigger - this.now()
    // setTimeout 上限约 24.8 天，更远的交给分钟轮询
    if (delay > 0x7fffffff) return
    this.timers.set(this.key(pluginId, t.code), setTimeout(() => void this.fire(pluginId, t.code), Math.max(0, delay)))
  }

  private disarm(pluginId: string, code: string) {
    const k = this.key(pluginId, code)
    const timer = this.timers.get(k)
    if (timer) clearTimeout(timer)
    this.timers.delete(k)
  }

  private pluginIds() {
    return this.o.store.keys('schedules/').map((k) => k.slice('schedules/'.length))
  }

  /** 每分钟检查 cron；按上次检查到现在之间的每一分钟补检查（休眠、定时器漂移不会漏掉） */
  private tick() {
    const now = this.now()
    const start = this.lastTick ? this.lastTick + 60000 : now
    this.lastTick = Math.floor(now / 60000) * 60000
    // 休眠很久时最多补 60 分钟，避免醒来后连续触发一大串
    for (let t = Math.max(Math.floor(start / 60000) * 60000, this.lastTick - 59 * 60000); t <= this.lastTick; t += 60000) {
      const d = new Date(t)
      for (const pid of this.pluginIds()) {
        for (const task of this.list(pid)) {
          if (typeof task.trigger === 'number') {
            if (task.trigger - now <= 0x7fffffff && !this.timers.has(this.key(pid, task.code))) this.arm(pid, task)
            continue
          }
          const { cron, startTime, endTime } = task.trigger
          if (endTime && t > endTime) {
            this.remove(pid, task.code)
            continue
          }
          if (startTime && t < startTime) continue
          if (parseCron(cron)?.(d)) void this.fire(pid, task.code)
        }
      }
    }
  }

  private ensureTicker() {
    if (this.ticker) return
    const loop = () => {
      this.tick()
      this.ticker = setTimeout(loop, 60000 - (this.now() % 60000) + 50)
    }
    this.lastTick = Math.floor(this.now() / 60000) * 60000
    this.ticker = setTimeout(loop, 60000 - (this.now() % 60000) + 50)
  }

  stop() {
    if (this.ticker) clearTimeout(this.ticker)
    this.ticker = null
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  async fire(pluginId: string, code: string) {
    const k = this.key(pluginId, code)
    // 上一次还没跑完就不再叠加触发
    if (this.running.has(k)) return
    const allowed = this.o.hooks.runApply('schedule:fire', { plugin: pluginId }, null, [pluginId, code], () => true)
    if (allowed === false) return
    this.running.add(k)
    let ok = true
    try {
      await this.o.run(pluginId, code)
    } catch (e) {
      ok = false
      this.o.log?.(`定时任务 ${pluginId}/${code} 失败：${(e as Error).message}`)
    } finally {
      this.running.delete(k)
    }
    const list = this.list(pluginId)
    const task = list.find((x) => x.code === code)
    if (!task) return
    task.lastExecuteAt = this.now()
    task.lastStatus = ok ? 'success' : 'failure'
    if (ok) task.successCount++
    else task.failureCount++
    if (typeof task.trigger === 'number') {
      this.disarm(pluginId, code)
      this.save(pluginId, list.filter((x) => x.code !== code))
    } else this.save(pluginId, list)
  }
}
