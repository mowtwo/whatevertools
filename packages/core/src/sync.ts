// 同步引擎：把 DocDb 的本地变更推到 SyncAdapter，再拉取其他设备的变更合并进来。
// 冲突按 revWins 确定性裁决（各设备结果一致）。附件暂不同步。
import type { DbDoc, SyncAdapter, SyncChange } from './adapters'
import type { DocDb } from './db'

/** 与旧平台 replicateStateFromCloud 一致：null = 未开启同步；1 = 拉取中；0 = 已拉取完成 */
export type ReplicateState = null | 0 | 1

export interface ReplicatorOptions {
  namespace: string
  device: string
  /** 定时同步间隔（毫秒），0 表示只在本地变更/远端通知时同步 */
  interval?: number
  /** 本地变更后多久推送 */
  pushDelay?: number
  /** 拉取到远端文档时回调（对应 onDbPull） */
  onPull?: (docs: DbDoc[]) => void
  onError?: (err: unknown) => void
}

export class Replicator {
  state: ReplicateState = 1
  private timer: ReturnType<typeof setInterval> | null = null
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private offChange: (() => void) | null = null
  private offWatch: (() => void) | null = null

  constructor(readonly db: DocDb, readonly adapter: SyncAdapter, readonly opts: ReplicatorOptions) {}

  start() {
    this.offChange = this.db.onChange((changes) => {
      if (changes.some((c) => c.origin === 'local')) this.schedulePush()
    })
    this.offWatch = this.adapter.watch?.(this.opts.namespace, () => void this.sync()) ?? null
    if (this.opts.interval !== 0) this.timer = setInterval(() => void this.sync(), this.opts.interval ?? 30000)
    void this.sync()
    return this
  }

  stop() {
    this.offChange?.()
    this.offWatch?.()
    if (this.timer) clearInterval(this.timer)
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.timer = this.pushTimer = null
  }

  private schedulePush() {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.sync()
    }, this.opts.pushDelay ?? 1000)
  }

  /** 推送 + 拉取一轮；并发调用会合并 */
  sync(): Promise<void> {
    if (this.running) return this.running
    this.running = (async () => {
      try {
        await this.push()
        await this.pull()
        this.state = 0
      } catch (e) {
        this.opts.onError?.(e)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  private async push() {
    const since = this.db.getSyncState<number>('pushedSeq') ?? 0
    const upTo = this.db.seq
    if (upTo <= since) return
    const docs = this.db.changesSince(since)
    const now = Date.now()
    const changes: SyncChange[] = docs.map((d) => ({ id: d._id, rev: d._rev!, deleted: d._deleted || undefined, doc: d._deleted ? undefined : d, ts: now, device: this.opts.device }))
    if (changes.length) await this.adapter.push(this.opts.namespace, changes)
    this.db.setSyncState('pushedSeq', upTo)
  }

  private async pull() {
    let cursor = this.db.getSyncState<string | null>('cursor') ?? null
    for (let round = 0; round < 50; round++) {
      const { changes, cursor: next } = await this.adapter.pull(this.opts.namespace, cursor)
      const remote = changes.filter((c) => c.device !== this.opts.device)
      if (remote.length) {
        const applied = this.db.applyRemote(remote.map((c) => (c.deleted ? { _id: c.id, _rev: c.rev, _deleted: true } : { ...(c.doc as DbDoc), _id: c.id, _rev: c.rev })))
        if (applied.length) this.opts.onPull?.(applied)
      }
      const advanced = next !== cursor
      cursor = next
      this.db.setSyncState('cursor', cursor)
      if (!changes.length || !advanced) break
    }
  }
}
