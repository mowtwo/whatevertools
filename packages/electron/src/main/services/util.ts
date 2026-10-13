import { nativeImage, type NativeImage } from 'electron'
import fs from 'node:fs'
import type { WireImage } from '../../shared/protocol'

/** 路径 / Data URL / 字节 → NativeImage */
export function toNativeImage(input: unknown): NativeImage | null {
  if (typeof input === 'string') {
    if (input.startsWith('data:')) return nativeImage.createFromDataURL(input)
    if (fs.existsSync(input)) return nativeImage.createFromPath(input)
    return null
  }
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) return nativeImage.createFromBuffer(Buffer.from(input as Uint8Array))
  if (input instanceof ArrayBuffer) return nativeImage.createFromBuffer(Buffer.from(input))
  return null
}

export function wireImage(img: NativeImage): WireImage {
  const { width, height } = img.getSize()
  return { __whatevertoolsImage: true, png: new Uint8Array(img.toPNG()), width, height }
}

/** 对象里所有 NativeImage 换成可传输的形式 */
export function serialize(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== 'object' || depth > 6) return v
  if (typeof (v as any).toPNG === 'function' && typeof (v as any).getSize === 'function') return wireImage(v as NativeImage)
  if (Array.isArray(v)) return v.map((x) => serialize(x, depth + 1))
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = serialize(x, depth + 1)
  return out
}
