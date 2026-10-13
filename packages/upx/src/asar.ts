// Electron asar 读写：[Pickle(uint32 头大小)][Pickle(头 JSON)][文件数据]，offset 相对数据区起点
import { PackageError, normalizeEntryPath } from './errors'

export interface AsarFileNode {
  size: number
  offset: string
  executable?: true
  unpacked?: true
  integrity?: unknown
}
export interface AsarDirNode {
  files: Record<string, AsarNode>
}
export interface AsarLinkNode {
  link: string
}
export type AsarNode = AsarFileNode | AsarDirNode | AsarLinkNode

export interface AsarEntry {
  path: string
  size: number
  executable: boolean
  unpacked: boolean
  link?: string
}

export interface AsarArchive {
  /** 原始头 JSON */
  readonly header: AsarDirNode
  list(): AsarEntry[]
  has(path: string): boolean
  read(path: string): Uint8Array
  readText(path: string): string
  /** 全部可读文件（不含 unpacked 和链接） */
  files(): Map<string, Uint8Array>
}

const isDir = (n: AsarNode): n is AsarDirNode => !!n && typeof n === 'object' && 'files' in n
const isLink = (n: AsarNode): n is AsarLinkNode => !!n && typeof n === 'object' && 'link' in n
const bad = (msg: string) => new PackageError('EBADASAR', `asar 格式错误：${msg}`)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

/** 只看头部结构是否像 asar（不解析 JSON） */
export function looksLikeAsar(b: Uint8Array): boolean {
  if (b.length < 17 || u32(b, 0) !== 4) return false
  const n = u32(b, 4)
  return n >= 8 && 8 + n <= b.length && u32(b, 8) === n - 4 && u32(b, 12) <= n - 8 && b[16] === 0x7b
}

export function readAsar(bytes: Uint8Array): AsarArchive {
  if (bytes.length < 16) throw bad('文件太短')
  if (u32(bytes, 0) !== 4) throw bad('头部 Pickle 大小不是 4')
  const n = u32(bytes, 4)
  if (n < 8 || 8 + n > bytes.length) throw bad('头部大小越界')
  if (u32(bytes, 8) !== n - 4) throw bad('头部 Pickle 负载大小不匹配')
  const strLen = u32(bytes, 12)
  if (strLen > n - 8) throw bad('头部字符串长度越界')
  let header: AsarDirNode
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + strLen)))
  } catch (e: any) {
    throw bad(`头部 JSON 无法解析：${e?.message ?? e}`)
  }
  if (!header || typeof header !== 'object' || !isDir(header) || typeof header.files !== 'object') throw bad('头部缺少 files')
  const dataStart = 8 + n

  // 扁平化：路径 → 节点，同时校验名字和范围
  const flat = new Map<string, AsarFileNode | AsarLinkNode>()
  const dirs = new Set<string>()
  const walk = (dir: AsarDirNode, prefix: string, depth: number) => {
    if (depth > 256) throw bad('目录嵌套过深')
    if (!dir.files || typeof dir.files !== 'object') throw bad(`目录 ${prefix || '/'} 缺少 files`)
    for (const name of Object.keys(dir.files)) {
      const rel = normalizeEntryPath(name)
      if (rel.includes('/')) throw new PackageError('EUNSAFEPATH', `条目名含路径分隔符：${name}`)
      const p = prefix ? `${prefix}/${rel}` : rel
      const node = dir.files[name]
      if (!node || typeof node !== 'object') throw bad(`条目 ${p} 无效`)
      if (flat.has(p) || dirs.has(p)) throw bad(`条目重复：${p}`)
      if (isDir(node)) {
        dirs.add(p)
        walk(node, p, depth + 1)
      } else if (isLink(node)) {
        if (typeof node.link !== 'string') throw bad(`链接 ${p} 无效`)
        flat.set(p, node)
      } else {
        const f = node as AsarFileNode
        if (!Number.isSafeInteger(f.size) || f.size < 0) throw bad(`文件 ${p} 大小无效`)
        if (!f.unpacked) {
          const off = typeof f.offset === 'string' && /^\d+$/.test(f.offset) ? Number(f.offset) : NaN
          if (!Number.isSafeInteger(off) || dataStart + off + f.size > bytes.length) throw bad(`文件 ${p} 数据越界（归档可能被截断）`)
        }
        flat.set(p, f)
      }
    }
  }
  walk(header, '', 0)

  const resolve = (path: string): AsarFileNode => {
    let p = normalizeEntryPath(path)
    for (let hops = 0; hops < 40; hops++) {
      const node = flat.get(p)
      if (!node) {
        if (dirs.has(p)) throw new PackageError('EISDIR', `是目录：${p}`)
        throw new PackageError('ENOENT', `归档中没有该文件：${p}`)
      }
      if (!isLink(node)) {
        if (node.unpacked) throw new PackageError('ENOENT', `文件在归档外（unpacked），无法读取：${p}`)
        return node
      }
      p = normalizeEntryPath(node.link)
    }
    throw new PackageError('ELOOP', `链接层级过多：${path}`)
  }
  const slice = (f: AsarFileNode) => {
    const start = dataStart + Number(f.offset)
    return bytes.subarray(start, start + f.size)
  }

  return {
    header,
    list() {
      const out: AsarEntry[] = []
      for (const [path, node] of flat) {
        if (isLink(node)) out.push({ path, size: 0, executable: false, unpacked: false, link: node.link })
        else out.push({ path, size: node.size, executable: !!node.executable, unpacked: !!node.unpacked })
      }
      return out
    },
    has(path) {
      try {
        return flat.has(normalizeEntryPath(path)) || dirs.has(normalizeEntryPath(path))
      } catch {
        return false
      }
    },
    read: (path) => slice(resolve(path)),
    readText: (path) => new TextDecoder().decode(slice(resolve(path))),
    files() {
      const m = new Map<string, Uint8Array>()
      for (const [path, node] of flat) if (!isLink(node) && !node.unpacked) m.set(path, slice(node))
      return m
    },
  }
}

export interface WriteAsarOptions {
  /** 哪些文件标记为可执行 */
  executable?: (path: string) => boolean
}

/** 生成 asar；键排序保证输出确定；不写 integrity */
export function writeAsar(files: Map<string, Uint8Array> | Record<string, Uint8Array>, opts: WriteAsarOptions = {}): Uint8Array {
  const entries = (files instanceof Map ? [...files] : Object.entries(files)).map(([p, d]) => [normalizeEntryPath(p), d] as const)
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const root: AsarDirNode = { files: {} }
  const chunks: Uint8Array[] = []
  let offset = 0
  for (const [p, data] of entries) {
    if (!(data instanceof Uint8Array)) throw new PackageError('EINVAL', `文件内容必须是 Uint8Array：${p}`)
    const segs = p.split('/')
    let dir = root
    for (const seg of segs.slice(0, -1)) {
      const next = dir.files[seg] ?? (dir.files[seg] = { files: {} })
      if (!isDir(next)) throw new PackageError('EINVAL', `路径冲突（既是文件又是目录）：${p}`)
      dir = next
    }
    const name = segs[segs.length - 1]
    if (name in dir.files) throw new PackageError('EINVAL', `路径冲突或重复：${p}`)
    const node: AsarFileNode = { size: data.length, offset: String(offset) }
    if (opts.executable?.(p)) node.executable = true
    dir.files[name] = node
    chunks.push(data)
    offset += data.length
  }
  const json = new TextEncoder().encode(JSON.stringify(root))
  const padded = (json.length + 3) & ~3
  const headerPickle = 8 + padded // [负载大小][字符串长度][字符串+填充]
  const out = new Uint8Array(8 + headerPickle + offset)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 4, true)
  dv.setUint32(4, headerPickle, true)
  dv.setUint32(8, headerPickle - 4, true)
  dv.setUint32(12, json.length, true)
  out.set(json, 16)
  let pos = 8 + headerPickle
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}
