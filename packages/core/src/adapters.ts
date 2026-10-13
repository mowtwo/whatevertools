// 能力适配器接口：引擎（语义）在 core 里，适配器只负责存储/传输，各平台各自实现。
//   存储：db-memory（参考实现）/ db-file（Node）/ db-indexeddb（浏览器）
//   同步：sync-folder（共享文件夹）/ sync-http（HTTP，附参考服务端）

export interface DbDoc {
  _id: string
  _rev?: string
  _deleted?: boolean
  [k: string]: unknown
}

export interface AttachmentMeta {
  type: string
  rev: string
  size: number
}

/** 存储后端的完整快照：文档常驻内存（同步 API 依赖这一点），附件按需读取 */
export interface DbSnapshot {
  docs: Record<string, DbDoc>
  attachments: Record<string, AttachmentMeta>
  /** 本地变更序号（同步用） */
  seq: number
  /** 同步状态（游标等），由同步引擎读写 */
  sync?: Record<string, unknown>
  /** 后端愿意的话可以把附件内容一起给出（浏览器端用，保证同步读取） */
  attachmentData?: Record<string, Uint8Array>
}

/** 一批持久化变更 */
export interface DbWrite {
  put?: DbDoc[]
  delete?: string[]
  seq?: number
  sync?: Record<string, unknown>
  attachmentsMeta?: Record<string, AttachmentMeta | null>
}

/** 存储适配器 */
export interface DbBackend {
  readonly name: string
  load(): Promise<DbSnapshot> | DbSnapshot
  /** 引擎会合并短时间内的多次写入后调用 */
  write(change: DbWrite): Promise<void> | void
  readAttachment(id: string): Promise<Uint8Array | null> | Uint8Array | null
  writeAttachment(id: string, data: Uint8Array): Promise<void> | void
  deleteAttachment(id: string): Promise<void> | void
  /** 退出前同步写盘（能做到的话） */
  flushSync?(): void
  close?(): Promise<void> | void
}

/** 同步传输中的一条变更 */
export interface SyncChange {
  id: string
  rev: string
  deleted?: boolean
  doc?: DbDoc
  /** 变更产生的时间（毫秒） */
  ts: number
  /** 产生变更的设备 */
  device: string
}

/** 同步适配器：namespace 一般是插件 id */
export interface SyncAdapter {
  readonly name: string
  push(namespace: string, changes: SyncChange[]): Promise<void>
  pull(namespace: string, cursor: string | null): Promise<{ changes: SyncChange[]; cursor: string | null }>
  /** 远端有变化时回调（可选，没有就靠定时拉取） */
  watch?(namespace: string, onRemote: () => void): () => void
}
