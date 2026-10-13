// 动态功能（插件运行时增删的功能）和指令快捷键表，所有平台共用，存储走 HostStore
import type { Feature } from './manifest'
import type { HostStore } from './store'

export class FeatureStore {
  constructor(private store: HostStore) {}

  list(pluginId: string, codes?: string[]): Feature[] {
    const all = this.store.get<Feature[]>(`features/${pluginId}`) ?? []
    return Array.isArray(codes) ? all.filter((f) => codes.includes(f.code)) : all
  }

  /** 新增或更新；static 是插件描述文件里的功能 code（不能被覆盖） */
  set(pluginId: string, feature: Feature, staticCodes: string[] = []) {
    if (!feature || typeof feature.code !== 'string' || !feature.code || !Array.isArray(feature.cmds) || !feature.cmds.length) throw new Error('动态功能需要 code 和非空的 cmds')
    if (staticCodes.includes(feature.code)) throw new Error(`动态功能 ${feature.code} 与描述文件里的功能重复`)
    const list = this.list(pluginId).filter((f) => f.code !== feature.code)
    list.push(JSON.parse(JSON.stringify(feature)))
    this.store.set(`features/${pluginId}`, list)
  }

  remove(pluginId: string, code: string): boolean {
    const list = this.list(pluginId)
    const next = list.filter((f) => f.code !== code)
    if (next.length === list.length) return false
    this.store.set(`features/${pluginId}`, next)
    return true
  }
}

export interface HotkeyEntry { pluginId: string; label: string; accelerator: string; autocopy?: boolean }

/** 指令快捷键表：pluginId → 指令 → 快捷键。注册全局快捷键由 hotkey 入口来源负责 */
export class HotkeyTable {
  private listeners = new Set<() => void>()
  /** 本次运行内的临时快捷键（不落盘，如独立应用描述文件里声明的默认快捷键） */
  private overlay: Record<string, Record<string, { accelerator: string; autocopy?: boolean }>> = {}
  constructor(private store: HostStore) {}

  private saved(): Record<string, Record<string, { accelerator: string; autocopy?: boolean }>> {
    return this.store.get('hotkeys') ?? {}
  }

  private merged() {
    const out = this.saved()
    for (const [pid, m] of Object.entries(this.overlay)) out[pid] = { ...m, ...(out[pid] ?? {}) }
    return out
  }

  get(pluginId: string, label: string) {
    return this.merged()[pluginId]?.[label]?.accelerator
  }

  list(): HotkeyEntry[] {
    return Object.entries(this.merged()).flatMap(([pluginId, m]) => Object.entries(m).map(([label, v]) => ({ pluginId, label, ...v })))
  }

  set(pluginId: string, label: string, accelerator: string | null, autocopy = false, persist = true) {
    const target = persist ? this.saved() : this.overlay
    const m = (target[pluginId] ??= {})
    if (!accelerator) delete m[label]
    else m[label] = { accelerator, autocopy: autocopy || undefined }
    if (persist) this.store.set('hotkeys', target)
    // 用户在设置里清掉快捷键时，临时的默认值也一起去掉
    if (persist && !accelerator) delete this.overlay[pluginId]?.[label]
    this.listeners.forEach((f) => f())
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
