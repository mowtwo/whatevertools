// 最小 zip 读取：中央目录 + store/deflate；不支持 zip64、加密、分卷
import { PackageError, normalizeEntryPath } from './errors'
import { inflateRaw } from './gzip'

const bad = (msg: string) => new PackageError('EBADZIP', `zip 格式错误：${msg}`)

export async function readZip(b: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  // 从尾部找中央目录结束记录（注释最长 65535）
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw bad('找不到中央目录')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  if (count === 0xffff || p === 0xffffffff) throw new PackageError('ENOTSUP', 'zip64 包暂不支持')
  const out = new Map<string, Uint8Array>()
  const names = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw bad('中央目录损坏')
    const flags = dv.getUint16(p + 8, true)
    const method = dv.getUint16(p + 10, true)
    const csize = dv.getUint32(p + 20, true)
    const usize = dv.getUint32(p + 24, true)
    const nlen = dv.getUint16(p + 28, true)
    const elen = dv.getUint16(p + 30, true)
    const clen = dv.getUint16(p + 32, true)
    const lho = dv.getUint32(p + 42, true)
    if (p + 46 + nlen > b.length) throw bad('文件名越界')
    const rawName = names.decode(b.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + elen + clen
    if (rawName.endsWith('/') || rawName.endsWith('\\')) continue
    const name = normalizeEntryPath(rawName)
    if (name.startsWith('__MACOSX/')) continue
    if (flags & 1) throw new PackageError('ENOTSUP', `zip 内文件已加密：${name}`)
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new PackageError('ENOTSUP', 'zip64 包暂不支持')
    if (lho + 30 > b.length || dv.getUint32(lho, true) !== 0x04034b50) throw bad(`本地文件头损坏：${name}`)
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true)
    if (start + csize > b.length) throw bad(`数据越界（可能被截断）：${name}`)
    const raw = b.subarray(start, start + csize)
    let data: Uint8Array
    if (method === 0) data = raw
    else if (method === 8) data = await inflateRaw(raw)
    else throw new PackageError('ENOTSUP', `不支持的压缩方式 ${method}：${name}`)
    if (data.length !== usize) throw bad(`解压后大小不符：${name}`)
    if (out.has(name)) throw bad(`条目重复：${name}`)
    out.set(name, data)
  }
  return out
}
