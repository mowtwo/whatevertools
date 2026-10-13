// 压缩/解压：优先 Web Streams（浏览器、Node 18+），否则用 Node 内置 zlib（不静态引用，打包器不会碰）
import { PackageError } from './errors'

type Format = 'gzip' | 'deflate-raw'

async function viaStream(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** Node 内置模块：process.getBuiltinModule（Node 20.16+/22.3+），不经过 import/require */
function nodeZlib(): any {
  const p = (globalThis as any).process
  const z = typeof p?.getBuiltinModule === 'function' ? p.getBuiltinModule('node:zlib') : undefined
  if (!z) throw new PackageError('ENOTSUP', '当前环境既没有 CompressionStream 也没有 node:zlib')
  return z
}

async function run(bytes: Uint8Array, format: Format, decompress: boolean): Promise<Uint8Array> {
  const Ctor: any = decompress ? (globalThis as any).DecompressionStream : (globalThis as any).CompressionStream
  try {
    if (typeof Ctor === 'function') return await viaStream(bytes, new Ctor(format))
    const z = nodeZlib()
    const fn = decompress ? (format === 'gzip' ? z.gunzipSync : z.inflateRawSync) : format === 'gzip' ? z.gzipSync : z.deflateRawSync
    const r: Uint8Array = fn(bytes)
    return new Uint8Array(r.buffer, r.byteOffset, r.byteLength)
  } catch (e: any) {
    if (e instanceof PackageError) throw e
    throw new PackageError('ECORRUPT', `${decompress ? '解压' : '压缩'}失败（${format}）：${e?.message ?? e}`)
  }
}

export const gunzip = (bytes: Uint8Array) => run(bytes, 'gzip', true)
export const gzip = (bytes: Uint8Array) => run(bytes, 'gzip', false)
export const inflateRaw = (bytes: Uint8Array) => run(bytes, 'deflate-raw', true)
