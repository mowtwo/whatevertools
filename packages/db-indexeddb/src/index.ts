// IndexedDB 存储：文档、附件元数据、附件内容分三个 object store。
// load() 会把附件内容也读进来，让浏览器端的同步 API（getAttachment）可以直接返回。
import type { AttachmentMeta, DbBackend, DbDoc, DbSnapshot, DbWrite } from '@whatevertools/core'

export interface IndexedDbBackendOptions {
  /** 数据库名，一般是 whatevertools:<插件 id> */
  name: string
  /** 是否在 load 时预读附件内容（默认 true） */
  preloadAttachments?: boolean
  indexedDB?: IDBFactory
}

const STORES = ['docs', 'atts', 'data', 'meta'] as const

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export class IndexedDbBackend implements DbBackend {
  readonly name = 'indexeddb'
  private dbp: Promise<IDBDatabase>

  constructor(private opts: IndexedDbBackendOptions) {
    const idb = opts.indexedDB ?? globalThis.indexedDB
    if (!idb) throw new Error('IndexedDB 不可用')
    const open = idb.open(opts.name, 1)
    open.onupgradeneeded = () => {
      for (const s of STORES) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s)
    }
    this.dbp = req(open)
  }

  private async tx(mode: IDBTransactionMode, fn: (t: IDBTransaction) => void) {
    const db = await this.dbp
    const t = db.transaction(STORES as unknown as string[], mode)
    fn(t)
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  }

  async load(): Promise<DbSnapshot> {
    const db = await this.dbp
    const t = db.transaction(STORES as unknown as string[], 'readonly')
    const all = async <T>(store: string) => {
      const s = t.objectStore(store)
      const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())])
      return Object.fromEntries(keys.map((k, i) => [String(k), values[i] as T]))
    }
    const docs = await all<DbDoc>('docs')
    const attachments = await all<AttachmentMeta>('atts')
    const meta = await all<unknown>('meta')
    const attachmentData = this.opts.preloadAttachments === false ? undefined : await all<Uint8Array>('data')
    return { docs, attachments, seq: (meta.seq as number) ?? 0, sync: (meta.sync as Record<string, unknown>) ?? {}, attachmentData }
  }

  async write(w: DbWrite) {
    await this.tx('readwrite', (t) => {
      const docs = t.objectStore('docs')
      for (const d of w.put ?? []) docs.put(d, d._id)
      for (const id of w.delete ?? []) docs.delete(id)
      const atts = t.objectStore('atts')
      for (const [id, m] of Object.entries(w.attachmentsMeta ?? {})) m ? atts.put(m, id) : atts.delete(id)
      const meta = t.objectStore('meta')
      if (w.seq !== undefined) meta.put(w.seq, 'seq')
      if (w.sync) {
        const s = meta.get('sync')
        s.onsuccess = () => meta.put({ ...(s.result ?? {}), ...w.sync }, 'sync')
      }
    })
  }

  async readAttachment(id: string) {
    const db = await this.dbp
    return ((await req(db.transaction('data').objectStore('data').get(id))) as Uint8Array | undefined) ?? null
  }

  async writeAttachment(id: string, data: Uint8Array) {
    await this.tx('readwrite', (t) => t.objectStore('data').put(data, id))
  }

  async deleteAttachment(id: string) {
    await this.tx('readwrite', (t) => t.objectStore('data').delete(id))
  }

  async close() {
    ;(await this.dbp).close()
  }
}
