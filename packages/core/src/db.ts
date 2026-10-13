// 文档数据库引擎：旧平台 db / dbStorage 的语义（_id/_rev、冲突以结果返回、附件只能新建、1M/10M 限制），
// 持久化交给 DbBackend。文档常驻内存，所以 get/put 等可以同步返回。
import type { AttachmentMeta, DbBackend, DbDoc, DbSnapshot, DbWrite } from './adapters'

export interface DbResult { id: string; rev?: string; ok?: boolean; error?: boolean; name?: string; message?: string }

export const DOC_LIMIT = 1024 * 1024
export const ATTACHMENT_LIMIT = 10 * 1024 * 1024
/** dbStorage 的键存成这个前缀的文档，跟着数据库一起同步，但不出现在 allDocs 里 */
export const STORAGE_PREFIX = '\u0000storage/'

function md5ish(s: string): string {
  // 不依赖 node:crypto 的简短哈希（FNV-1a 64 位的两段），只用来让 rev 唯一
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519)
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + Math.random().toString(16).slice(2, 10))
}

export function revNumber(rev: string | undefined): number {
  return rev ? Number(rev.split('-')[0]) || 0 : 0
}

/** 确定性的冲突裁决（同 CouchDB）：版本号大的赢，相同则比较 rev 字符串 */
export function revWins(a: string, b: string): boolean {
  const na = revNumber(a), nb = revNumber(b)
  return na !== nb ? na > nb : a > b
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export interface DocChange {
  doc: DbDoc
  /** local = 本机写入；remote = 同步拉取 */
  origin: 'local' | 'remote'
}

export class DocDb {
  private docs: Record<string, DbDoc> = {}
  private atts: Record<string, AttachmentMeta> = {}
  private attCache = new Map<string, Uint8Array>()
  /** 删除留下的墓碑：id → rev（同步需要） */
  private tombstones: Record<string, string> = {}
  private seqNo = 0
  private syncState: Record<string, unknown> = {}
  private pending: DbWrite = {}
  private timer: ReturnType<typeof setTimeout> | null = null
  private loaded: Promise<void> | null = null
  private listeners = new Set<(changes: DocChange[]) => void>()
  /** 变更日志（同步引擎读取）：seq → id */
  private changeLog: Array<{ seq: number; id: string }> = []

  constructor(readonly backend: DbBackend, private writeDelay = 30) {}

  /** 必须先 load 才能用 */
  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = Promise.resolve(this.backend.load()).then((snap: DbSnapshot) => {
        for (const [id, d] of Object.entries(snap.docs ?? {})) {
          if (d._deleted) this.tombstones[id] = d._rev ?? ''
          else this.docs[id] = d
        }
        this.atts = { ...(snap.attachments ?? {}) }
        this.seqNo = snap.seq ?? 0
        this.syncState = { ...(snap.sync ?? {}) }
        for (const [id, data] of Object.entries(snap.attachmentData ?? {})) this.attCache.set(id, data)
      })
    }
    return this.loaded
  }

  onChange(fn: (changes: DocChange[]) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get seq() {
    return this.seqNo
  }

  private queue(w: DbWrite) {
    const p = this.pending
    if (w.put) {
      const ids = new Set(w.put.map((d) => d._id))
      p.put = [...(p.put ?? []).filter((d) => !ids.has(d._id)), ...w.put]
      p.delete = (p.delete ?? []).filter((id) => !ids.has(id))
    }
    if (w.delete) {
      const ids = new Set(w.delete)
      p.delete = [...new Set([...(p.delete ?? []), ...w.delete])]
      p.put = (p.put ?? []).filter((d) => !ids.has(d._id))
    }
    if (w.attachmentsMeta) p.attachmentsMeta = { ...(p.attachmentsMeta ?? {}), ...w.attachmentsMeta }
    if (w.sync) p.sync = { ...(p.sync ?? {}), ...w.sync }
    p.seq = this.seqNo
    if (!this.timer) this.timer = setTimeout(() => this.flush().catch(() => {}), this.writeDelay)
  }

  /** 写盘失败时的回调（默认打印） */
  onWriteError: (err: unknown) => void = (e) => console.error('[whatevertools] 数据库写盘失败，稍后重试', e)

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const w = this.pending
    this.pending = {}
    if (!(w.put || w.delete || w.attachmentsMeta || w.sync || w.seq !== undefined)) return
    try {
      await this.backend.write(w)
    } catch (e) {
      // 写失败：把这批放回队列（新的变更优先），稍后重试，不能丢
      const newer = this.pending
      this.pending = {}
      this.queue(w)
      this.queue(newer)
      this.onWriteError(e)
      throw e
    }
  }

  /** 退出前尽量同步写盘 */
  flushSync() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const w = this.pending
    this.pending = {}
    if (w.put || w.delete || w.attachmentsMeta || w.sync) {
      const r = this.backend.write(w)
      if (r && typeof (r as Promise<void>).then === 'function') (r as Promise<void>).catch(() => {})
    }
    this.backend.flushSync?.()
  }

  private nextRev(prev: string | undefined, body: string) {
    return `${revNumber(prev) + 1}-${md5ish(body)}`
  }

  private err(id: string, name: string, message: string): DbResult {
    return { id, error: true, name, message }
  }

  private emit(changes: DocChange[]) {
    if (changes.length) for (const fn of this.listeners) fn(changes)
  }

  private logChange(id: string) {
    this.seqNo++
    this.changeLog.push({ seq: this.seqNo, id })
    if (this.changeLog.length > 5000) this.changeLog.splice(0, this.changeLog.length - 5000)
  }

  private putOne(input: DbDoc): { res: DbResult; change?: DbDoc } {
    if (!input || typeof input !== 'object' || typeof input._id !== 'string' || !input._id) {
      return { res: this.err(String((input as DbDoc | undefined)?._id ?? ''), 'bad_request', 'doc._id must be a non-empty string') }
    }
    const id = input._id
    const cur = this.docs[id]
    if (cur && cur._rev !== input._rev) return { res: this.err(id, 'conflict', 'Document update conflict') }
    if (!cur && input._rev && !input._deleted && input._rev !== this.tombstones[id]) return { res: this.err(id, 'conflict', 'Document update conflict') }
    if (this.atts[id]) return { res: this.err(id, 'conflict', 'Document update conflict') }
    if (input._deleted) {
      if (!cur) return { res: this.err(id, 'not_found', 'missing') }
      const rev = this.nextRev(cur._rev, id)
      delete this.docs[id]
      this.tombstones[id] = rev
      this.logChange(id)
      const tomb = { _id: id, _rev: rev, _deleted: true }
      this.queue({ put: [tomb] })
      return { res: { id, ok: true, rev }, change: tomb }
    }
    let body: string
    try {
      body = JSON.stringify(input)
    } catch (e) {
      return { res: this.err(id, 'bad_request', `doc is not serializable: ${(e as Error).message}`) }
    }
    if (utf8Length(body) > DOC_LIMIT) return { res: this.err(id, 'exception', 'doc size exceeds 1M') }
    const doc = JSON.parse(body) as DbDoc
    doc._rev = this.nextRev(cur?._rev ?? this.tombstones[id], body)
    this.docs[id] = doc
    delete this.tombstones[id]
    this.logChange(id)
    this.queue({ put: [doc] })
    return { res: { id, ok: true, rev: doc._rev }, change: doc }
  }

  put(doc: DbDoc): DbResult {
    const { res, change } = this.putOne(doc)
    if (change) this.emit([{ doc: clone(change), origin: 'local' }])
    return res
  }

  get(id: string): DbDoc | null {
    const d = this.docs[id]
    return d ? clone(d) : null
  }

  remove(docOrId: DbDoc | string): DbResult {
    const id = typeof docOrId === 'string' ? docOrId : docOrId?._id
    const cur = this.docs[id]
    if (!cur) return this.err(String(id), 'not_found', 'missing')
    if (typeof docOrId !== 'string' && docOrId._rev !== undefined && docOrId._rev !== cur._rev) return this.err(id, 'conflict', 'Document update conflict')
    return this.put({ ...cur, _deleted: true })
  }

  bulkDocs(docs: DbDoc[]): DbResult[] {
    if (!Array.isArray(docs)) return [this.err('', 'bad_request', 'docs must be an array')]
    const changes: DocChange[] = []
    const res = docs.map((d) => {
      const r = this.putOne(d)
      if (r.change) changes.push({ doc: clone(r.change), origin: 'local' })
      return r.res
    })
    this.emit(changes)
    return res
  }

  allDocs(filter?: string | string[]): DbDoc[] {
    let list: DbDoc[]
    if (Array.isArray(filter)) list = filter.map((id) => this.docs[id]).filter(Boolean)
    else {
      const prefix = typeof filter === 'string' ? filter : ''
      list = Object.values(this.docs).filter((d) => !d._id.startsWith(STORAGE_PREFIX) && d._id.startsWith(prefix))
    }
    return clone(list.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0)))
  }

  async postAttachment(id: string, data: Uint8Array, type: string): Promise<DbResult> {
    if (typeof id !== 'string' || !id) return this.err(String(id), 'bad_request', 'id must be a non-empty string')
    if (this.atts[id] || this.docs[id]) return this.err(id, 'conflict', 'Document update conflict')
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
    if (bytes.byteLength > ATTACHMENT_LIMIT) return this.err(id, 'exception', 'attachment size exceeds 10M')
    const rev = this.nextRev(undefined, `${id}:${bytes.byteLength}`)
    const meta = { type: String(type || 'application/octet-stream'), rev, size: bytes.byteLength }
    // 先占住 id，避免同 id 并发写入都成功
    this.atts[id] = meta
    try {
      await this.backend.writeAttachment(id, bytes)
    } catch (e) {
      delete this.atts[id]
      return this.err(id, 'exception', `attachment write failed: ${(e as Error).message}`)
    }
    this.attCache.set(id, bytes)
    this.queue({ attachmentsMeta: { [id]: meta } })
    return { id, ok: true, rev }
  }

  /** 已缓存时同步返回 */
  getAttachmentCached(id: string): Uint8Array | null | undefined {
    if (!this.atts[id]) return null
    return this.attCache.get(id)
  }

  async getAttachment(id: string): Promise<Uint8Array | null> {
    if (!this.atts[id]) return null
    const hit = this.attCache.get(id)
    if (hit) return hit
    const data = await this.backend.readAttachment(id)
    if (data) this.attCache.set(id, data)
    return data
  }

  getAttachmentType(id: string): string | null {
    return this.atts[id]?.type ?? null
  }

  async removeAttachment(id: string): Promise<DbResult> {
    const meta = this.atts[id]
    if (!meta) return this.err(id, 'not_found', 'missing')
    delete this.atts[id]
    this.attCache.delete(id)
    await this.backend.deleteAttachment(id)
    this.queue({ attachmentsMeta: { [id]: null } })
    return { id, ok: true, rev: meta.rev }
  }

  // ---------- dbStorage ----------

  setItem(key: string, value: unknown) {
    const id = STORAGE_PREFIX + String(key)
    const cur = this.docs[id]
    this.put({ _id: id, _rev: cur?._rev ?? this.tombstones[id], value: value === undefined ? null : clone(value) })
  }

  getItem(key: string): unknown {
    const d = this.docs[STORAGE_PREFIX + String(key)]
    return d ? clone(d.value) ?? null : null
  }

  removeItem(key: string): boolean {
    const d = this.docs[STORAGE_PREFIX + String(key)]
    if (!d) return false
    return !!this.remove(d).ok
  }

  // ---------- 同步引擎用 ----------

  /** 某个序号之后本机改过的文档（含墓碑） */
  changesSince(seq: number): DbDoc[] {
    const ids = [...new Set(this.changeLog.filter((c) => c.seq > seq).map((c) => c.id))]
    // 日志覆盖不到 seq 之后的全部变更（重启后日志为空，或被截断）时退回全量，否则会漏推
    const covered = this.changeLog.length > 0 && this.changeLog[0].seq <= seq + 1
    if (this.seqNo > seq && !covered) {
      return [...Object.values(this.docs), ...Object.entries(this.tombstones).map(([id, rev]) => ({ _id: id, _rev: rev, _deleted: true }))].map(clone)
    }
    return ids.map((id) => (this.docs[id] ? clone(this.docs[id]) : { _id: id, _rev: this.tombstones[id], _deleted: true }))
  }

  /** 应用远端变更：按 revWins 裁决，返回实际生效的文档 */
  applyRemote(docs: DbDoc[]): DbDoc[] {
    const applied: DbDoc[] = []
    for (const d of docs) {
      if (!d?._id || !d._rev) continue
      const curRev = this.docs[d._id]?._rev ?? this.tombstones[d._id]
      if (curRev && !revWins(d._rev, curRev)) continue
      if (d._deleted) {
        delete this.docs[d._id]
        this.tombstones[d._id] = d._rev
        this.queue({ put: [{ _id: d._id, _rev: d._rev, _deleted: true }] })
      } else {
        this.docs[d._id] = clone(d)
        delete this.tombstones[d._id]
        this.queue({ put: [clone(d)] })
      }
      applied.push(clone(d))
    }
    this.emit(applied.map((doc) => ({ doc, origin: 'remote' as const })))
    return applied
  }

  getSyncState<T>(key: string): T | undefined {
    return this.syncState[key] as T | undefined
  }

  setSyncState(key: string, value: unknown) {
    this.syncState[key] = value
    this.queue({ sync: { [key]: value } })
  }
}

function utf8Length(s: string) {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) (n += 4), i++
    else n += 3
  }
  return n
}

/** 参考实现：内存后端（测试、无持久化场景） */
export class MemoryBackend implements DbBackend {
  readonly name = 'memory'
  docs: Record<string, DbDoc> = {}
  attachments: Record<string, AttachmentMeta> = {}
  data = new Map<string, Uint8Array>()
  seq = 0
  sync: Record<string, unknown> = {}
  load(): DbSnapshot {
    return { docs: { ...this.docs }, attachments: { ...this.attachments }, seq: this.seq, sync: { ...this.sync }, attachmentData: Object.fromEntries(this.data) }
  }
  write(w: DbWrite) {
    for (const d of w.put ?? []) this.docs[d._id] = d
    for (const id of w.delete ?? []) delete this.docs[id]
    for (const [id, m] of Object.entries(w.attachmentsMeta ?? {})) {
      if (m) this.attachments[id] = m
      else delete this.attachments[id]
    }
    if (w.seq !== undefined) this.seq = w.seq
    if (w.sync) Object.assign(this.sync, w.sync)
  }
  readAttachment(id: string) {
    return this.data.get(id) ?? null
  }
  writeAttachment(id: string, data: Uint8Array) {
    this.data.set(id, data)
  }
  deleteAttachment(id: string) {
    this.data.delete(id)
  }
}
