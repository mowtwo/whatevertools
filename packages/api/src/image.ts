// NativeImage 兼容类：平台没有原生 nativeImage（web / tauri）时使用
import type { Capabilities, ImageData, Rect } from '@whatevertools/core'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
  const g = globalThis as any
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64')
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=')
  }
  return out
}

export function fromBase64(s: string): Uint8Array {
  const g = globalThis as any
  if (g.Buffer) return new Uint8Array(g.Buffer.from(s, 'base64'))
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63)
    out[o++] = (n >> 16) & 255
    if (clean[i + 2] !== undefined) out[o++] = (n >> 8) & 255
    if (clean[i + 3] !== undefined) out[o++] = n & 255
  }
  return out.slice(0, o)
}

function bytes(b: Uint8Array): Uint8Array {
  const g = globalThis as any
  return g.Buffer ? g.Buffer.from(b) : b
}

export class CompatImage {
  constructor(private img: ImageData | null, private caps: Capabilities) {}
  getSize() {
    return { width: this.img?.width ?? 0, height: this.img?.height ?? 0 }
  }
  isEmpty() {
    return !this.img || !this.img.width
  }
  toPNG() {
    return bytes(this.img?.png ?? new Uint8Array())
  }
  toJPEG(quality: number) {
    if (!this.img) return bytes(new Uint8Array())
    if (!this.caps.image?.toJPEG) throw new Error('[whatevertools] 当前平台不支持 toJPEG')
    return bytes(this.caps.image.toJPEG(this.img, quality))
  }
  toDataURL() {
    return this.img ? `data:image/png;base64,${toBase64(this.img.png)}` : 'data:image/png;base64,'
  }
  crop(rect: Rect) {
    if (!this.img) return this
    if (!this.caps.image?.crop) throw new Error('[whatevertools] 当前平台不支持 crop')
    return new CompatImage(this.caps.image.crop(this.img, rect), this.caps)
  }
  resize(opts: { width?: number; height?: number }) {
    if (!this.img) return this
    if (!this.caps.image?.resize) throw new Error('[whatevertools] 当前平台不支持 resize')
    return new CompatImage(this.caps.image.resize(this.img, opts), this.caps)
  }
}

export function isImageData(v: unknown): v is ImageData {
  return !!v && typeof v === 'object' && (v as ImageData).png instanceof Uint8Array && typeof (v as ImageData).width === 'number'
}

/** 能力层图片 → 插件看到的 NativeImage */
export function wrapImage(caps: Capabilities, img: ImageData | null): unknown {
  if (img && caps.image?.wrap) return caps.image.wrap(img)
  return new CompatImage(img, caps)
}

/** 把结果里的能力层图片全部包装 */
export function wrapImagesDeep(caps: Capabilities, v: unknown, depth = 0): unknown {
  if (isImageData(v)) return wrapImage(caps, v)
  if (!v || typeof v !== 'object' || depth > 5 || v instanceof Uint8Array) return v
  if (Array.isArray(v)) return v.map((x) => wrapImagesDeep(caps, x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = wrapImagesDeep(caps, x, depth + 1)
  return out
}
