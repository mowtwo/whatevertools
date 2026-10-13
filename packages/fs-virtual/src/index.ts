// 虚拟文件系统：POSIX 路径、内存常驻（同步 API 可用），可选持久化到 IndexedDB（写入后异步落盘）。
// 外部文件（拖入的 File、网络资源）可以先挂一个懒加载条目，预取完成前同步读取会抛 EAGAIN。
import type { FsCapability, FsDirent, FsStat } from '@whatevertools/core'

interface Node {
  type: 'file' | 'dir'
  /** 懒加载条目预先知道的大小 */
  size?: number
  data?: Uint8Array
  /** 懒加载内容（预取完成后清除） */
  lazy?: Promise<Uint8Array>
  mode: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
}

export interface PersistAdapter {
  load(): Promise<Array<[string, { type: 'file' | 'dir'; data?: Uint8Array; mtimeMs: number; mode: number }]>>
  put(path: string, node: { type: 'file' | 'dir'; data?: Uint8Array; mtimeMs: number; mode: number }): Promise<void>
  delete(path: string): Promise<void>
}

function err(code: string, syscall: string, path: string): Error {
  const msgs: Record<string, string> = { EINVAL: 'invalid argument', ENOENT: 'no such file or directory', EEXIST: 'file already exists', ENOTDIR: 'not a directory', EISDIR: 'illegal operation on a directory', ENOTEMPTY: 'directory not empty', EAGAIN: 'resource temporarily unavailable (still loading)', EACCES: 'permission denied' }
  return Object.assign(new Error(`${code}: ${msgs[code] ?? code}, ${syscall} '${path}'`), { code, syscall, path, errno: -1 })
}

export function normalize(p: string, cwd = '/'): string {
  let s = String(p).replace(/\\/g, '/')
  if (s.startsWith('file://')) s = decodeURIComponent(s.slice(7))
  if (!s.startsWith('/')) s = `${cwd.replace(/\/$/, '')}/${s}`
  const out: string[] = []
  for (const part of s.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

const parent = (p: string) => (p === '/' ? '/' : p.slice(0, p.lastIndexOf('/')) || '/')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export interface VirtualFsOptions {
  persist?: PersistAdapter
  /** 启动时创建的目录 */
  dirs?: string[]
  /** 这些目录下的文件不落盘（拖入、选中、待下载的文件只在本次页面里有效） */
  ephemeral?: string[]
  cwd?: string
}

export class VirtualFs implements FsCapability {
  private nodes = new Map<string, Node>()
  private watchers = new Set<{ path: string; recursive: boolean; fn: (e: 'rename' | 'change', f: string | null) => void }>()
  readonly cwd: string

  constructor(private opts: VirtualFsOptions = {}) {
    this.cwd = opts.cwd ?? '/'
    this.nodes.set('/', this.dirNode())
    for (const d of opts.dirs ?? []) this.mkdirSync(d, { recursive: true })
  }

  /** 从持久化层恢复 */
  async load() {
    if (!this.opts.persist) return
    for (const [p, n] of await this.opts.persist.load()) {
      this.nodes.set(p, { ...n, ctimeMs: n.mtimeMs, birthtimeMs: n.mtimeMs })
    }
  }

  private dirNode(): Node {
    const t = Date.now()
    return { type: 'dir', mode: 0o40755, mtimeMs: t, ctimeMs: t, birthtimeMs: t }
  }

  private save(p: string) {
    const n = this.nodes.get(p)
    if (!this.opts.persist) return
    if (this.opts.ephemeral?.some((d) => p === d || p.startsWith(d + '/'))) return
    if (n && !n.lazy) void this.opts.persist.put(p, { type: n.type, data: n.data, mtimeMs: n.mtimeMs, mode: n.mode }).catch(() => {})
    else if (!n) void this.opts.persist.delete(p).catch(() => {})
  }

  private notify(p: string, e: 'rename' | 'change') {
    for (const w of this.watchers) {
      if (p === w.path || parent(p) === w.path || (w.recursive && p.startsWith(w.path + '/'))) w.fn(e, p.slice(w.path.length + 1) || base(p))
    }
  }

  private abs(p: string) {
    return normalize(p, this.cwd)
  }

  private need(p: string, syscall: string): Node {
    const n = this.nodes.get(p)
    if (!n) throw err('ENOENT', syscall, p)
    return n
  }

  private needParentDir(p: string, syscall: string) {
    const par = this.nodes.get(parent(p))
    if (!par) throw err('ENOENT', syscall, p)
    if (par.type !== 'dir') throw err('ENOTDIR', syscall, p)
  }

  /** 挂一个外部文件（如拖入的 File）：内容异步获取 */
  mountLazy(path: string, load: () => Promise<Uint8Array>, size?: number) {
    const p = this.abs(path)
    this.mkdirSync(parent(p), { recursive: true })
    const t = Date.now()
    const node: Node = { type: 'file', mode: 0o100644, mtimeMs: t, ctimeMs: t, birthtimeMs: t, data: undefined, size }
    node.lazy = load().then(
      (d) => {
        node.data = d
        node.lazy = undefined
        this.save(p)
        return d
      },
      (e) => {
        // 加载失败：去掉这个条目，避免永远停在 EAGAIN
        if (this.nodes.get(p) === node) this.nodes.delete(p)
        throw e
      },
    )
    node.lazy.catch(() => {})
    this.nodes.set(p, node)
    return p
  }

  // ---------- 同步 ----------

  readFileSync(path: string): Uint8Array {
    const p = this.abs(path)
    const n = this.need(p, 'open')
    if (n.type === 'dir') throw err('EISDIR', 'read', p)
    if (n.lazy) throw err('EAGAIN', 'read', p)
    return n.data ?? new Uint8Array()
  }

  writeFileSync(path: string, data: Uint8Array, opts: { append?: boolean; mode?: number } = {}) {
    const p = this.abs(path)
    this.needParentDir(p, 'open')
    const cur = this.nodes.get(p)
    if (cur?.type === 'dir') throw err('EISDIR', 'open', p)
    const t = Date.now()
    let next = data
    if (opts.append && cur?.data) {
      next = new Uint8Array(cur.data.length + data.length)
      next.set(cur.data)
      next.set(data, cur.data.length)
    }
    this.nodes.set(p, { type: 'file', data: next, mode: opts.mode ?? cur?.mode ?? 0o100644, mtimeMs: t, ctimeMs: t, birthtimeMs: cur?.birthtimeMs ?? t })
    this.save(p)
    this.notify(p, cur ? 'change' : 'rename')
  }

  statSync(path: string): FsStat | null {
    const n = this.nodes.get(this.abs(path))
    if (!n) return null
    return { size: n.data?.length ?? n.size ?? 0, mtimeMs: n.mtimeMs, ctimeMs: n.ctimeMs, birthtimeMs: n.birthtimeMs, atimeMs: n.mtimeMs, mode: n.mode, isFile: n.type === 'file', isDirectory: n.type === 'dir', isSymbolicLink: false }
  }

  readdirSync(path: string): FsDirent[] {
    const p = this.abs(path)
    const n = this.need(p, 'scandir')
    if (n.type !== 'dir') throw err('ENOTDIR', 'scandir', p)
    const prefix = p === '/' ? '/' : p + '/'
    const out: FsDirent[] = []
    for (const [k, v] of this.nodes) {
      if (k !== p && k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) out.push({ name: k.slice(prefix.length), isFile: v.type === 'file', isDirectory: v.type === 'dir', isSymbolicLink: false })
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : 1))
  }

  mkdirSync(path: string, opts: { recursive?: boolean } = {}) {
    const p = this.abs(path)
    const cur = this.nodes.get(p)
    if (cur) {
      if (opts.recursive && cur.type === 'dir') return
      throw err('EEXIST', 'mkdir', p)
    }
    if (!this.nodes.has(parent(p))) {
      if (!opts.recursive) throw err('ENOENT', 'mkdir', p)
      this.mkdirSync(parent(p), opts)
    }
    this.needParentDir(p, 'mkdir')
    this.nodes.set(p, this.dirNode())
    this.save(p)
    this.notify(p, 'rename')
  }

  rmSync(path: string, opts: { recursive?: boolean; force?: boolean } = {}) {
    const p = this.abs(path)
    const n = this.nodes.get(p)
    if (!n) {
      if (opts.force) return
      throw err('ENOENT', 'rm', p)
    }
    if (n.type === 'dir') {
      const kids = [...this.nodes.keys()].filter((k) => k.startsWith(p + '/'))
      if (kids.length && !opts.recursive) throw err('ENOTEMPTY', 'rmdir', p)
      for (const k of kids) {
        this.nodes.delete(k)
        this.save(k)
      }
    }
    if (p === '/') return
    this.nodes.delete(p)
    this.save(p)
    this.notify(p, 'rename')
  }

  renameSync(from: string, to: string) {
    const a = this.abs(from)
    const b = this.abs(to)
    const n = this.need(a, 'rename')
    this.needParentDir(b, 'rename')
    if (a === b) return
    if (b.startsWith(a + '/')) throw err('EINVAL', 'rename', b)
    const target = this.nodes.get(b)
    if (target?.type === 'dir' && [...this.nodes.keys()].some((k) => k.startsWith(b + '/'))) throw err('ENOTEMPTY', 'rename', b)
    if (target && target.type !== n.type) throw err(target.type === 'dir' ? 'EISDIR' : 'ENOTDIR', 'rename', b)
    const moves = [...this.nodes.entries()].filter(([k]) => k === a || k.startsWith(a + '/'))
    for (const [k] of moves) {
      this.nodes.delete(k)
      this.save(k)
    }
    for (const [k, v] of moves) {
      const nk = b + k.slice(a.length)
      this.nodes.set(nk, v)
      this.save(nk)
    }
    void n
    this.notify(a, 'rename')
    this.notify(b, 'rename')
  }

  copyFileSync(from: string, to: string) {
    this.writeFileSync(to, new Uint8Array(this.readFileSync(from)))
  }

  realpathSync(path: string) {
    const p = this.abs(path)
    this.need(p, 'realpath')
    return p
  }

  // ---------- 异步 ----------

  async readFile(path: string) {
    const p = this.abs(path)
    const n = this.need(p, 'open')
    if (n.lazy) await n.lazy
    return this.readFileSync(p)
  }
  async writeFile(path: string, data: Uint8Array, opts?: { append?: boolean; mode?: number }) {
    this.writeFileSync(path, data, opts)
  }
  async stat(path: string) {
    return this.statSync(path)
  }
  async readdir(path: string) {
    return this.readdirSync(path)
  }
  async mkdir(path: string, opts?: { recursive?: boolean }) {
    this.mkdirSync(path, opts)
  }
  async rm(path: string, opts?: { recursive?: boolean; force?: boolean }) {
    this.rmSync(path, opts)
  }
  async rename(from: string, to: string) {
    this.renameSync(from, to)
  }
  async copyFile(from: string, to: string) {
    await this.readFile(from)
    this.copyFileSync(from, to)
  }

  watch(path: string, fn: (e: 'rename' | 'change', f: string | null) => void, opts: { recursive?: boolean } = {}) {
    const w = { path: this.abs(path), recursive: !!opts.recursive, fn }
    this.watchers.add(w)
    return () => this.watchers.delete(w)
  }
}

/** IndexedDB 持久化：每个路径一条记录 */
export function indexedDbPersist(name: string, idb: IDBFactory = globalThis.indexedDB): PersistAdapter {
  const open = new Promise<IDBDatabase>((resolve, reject) => {
    const r = idb.open(name, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('nodes')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  const tx = async (mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void) => {
    const db = await open
    return new Promise<any>((resolve, reject) => {
      const t = db.transaction('nodes', mode)
      const req = fn(t.objectStore('nodes'))
      t.oncomplete = () => resolve(req ? (req as IDBRequest).result : undefined)
      t.onerror = () => reject(t.error)
    })
  }
  return {
    async load() {
      const db = await open
      return new Promise((resolve, reject) => {
        const t = db.transaction('nodes', 'readonly')
        const s = t.objectStore('nodes')
        const keys = s.getAllKeys()
        const vals = s.getAll()
        t.oncomplete = () => resolve(keys.result.map((k, i) => [String(k), vals.result[i]]))
        t.onerror = () => reject(t.error)
      })
    },
    put: (p, n) => tx('readwrite', (s) => s.put(n, p)),
    delete: (p) => tx('readwrite', (s) => s.delete(p)),
  }
}
