// canvas 基础：建画布、格式嗅探、解码、编码、头部信息解析。
export type Cv = HTMLCanvasElement | OffscreenCanvas
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const hasDoc = () => typeof document !== 'undefined' && typeof document.createElement === 'function'

export function newCanvas(w: number, h: number): Cv {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
  if (hasDoc()) {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    return c
  }
  if (typeof OffscreenCanvas === 'undefined') throw new Error('当前环境没有 canvas（document / OffscreenCanvas 都不可用）')
  return new OffscreenCanvas(w, h)
}

export function ctxOf(c: Cv): Ctx {
  // willReadFrequently 走 CPU 画布：读像素多，结果也更稳定
  const ctx = c.getContext('2d', { willReadFrequently: true }) as Ctx | null
  if (!ctx) throw new Error('无法获取 2d canvas 上下文')
  return ctx
}

export function err(message: string, code?: string): Error {
  const e = new Error(message) as Error & { code?: string }
  if (code) e.code = code
  return e
}

// ---- 格式嗅探 ----

export type InFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'avif' | 'heif' | 'svg' | 'ico' | 'tiff'

const MIME: Record<string, string> = {
  png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  avif: 'image/avif', heif: 'image/heif', svg: 'image/svg+xml', ico: 'image/x-icon', tiff: 'image/tiff',
}
export const mimeOf = (fmt: string) => MIME[fmt] ?? 'application/octet-stream'

const ascii = (u: Uint8Array, s: number, n: number) => String.fromCharCode(...u.subarray(s, s + n))

export function detectFormat(u: Uint8Array): InFormat | undefined {
  if (u.length < 4) return undefined
  if (u[0] === 0x89 && ascii(u, 1, 3) === 'PNG') return 'png'
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'jpeg'
  if (ascii(u, 0, 4) === 'GIF8') return 'gif'
  if (ascii(u, 0, 4) === 'RIFF' && ascii(u, 8, 4) === 'WEBP') return 'webp'
  if (u[0] === 0x42 && u[1] === 0x4d) return 'bmp'
  if (u[0] === 0 && u[1] === 0 && u[2] === 1 && u[3] === 0) return 'ico'
  if ((u[0] === 0x49 && u[1] === 0x49 && u[2] === 0x2a && u[3] === 0) || (u[0] === 0x4d && u[1] === 0x4d && u[2] === 0 && u[3] === 0x2a)) return 'tiff'
  if (ascii(u, 4, 4) === 'ftyp') {
    const brand = ascii(u, 8, 4)
    if (brand === 'avif' || brand === 'avis') return 'avif'
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'heif'
  }
  // SVG：跳过 BOM / 空白后以 <svg 或 <?xml 开头
  const head = new TextDecoder().decode(u.subarray(0, 512)).replace(/^﻿/, '').trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && /<svg/i.test(new TextDecoder().decode(u.subarray(0, 4096))))) return 'svg'
  if (head.startsWith('<!--') && /<svg/i.test(new TextDecoder().decode(u.subarray(0, 4096)))) return 'svg'
  return undefined
}

// ---- 头部信息：alpha、EXIF 方向、DPI ----

export interface HeaderInfo { hasAlpha?: boolean; channels?: number; orientation?: number; density?: number; width?: number; height?: number }

export function parseHeader(u: Uint8Array, fmt: InFormat): HeaderInfo {
  try {
    if (fmt === 'png') return parsePng(u)
    if (fmt === 'jpeg') return parseJpeg(u)
    if (fmt === 'webp') return parseWebp(u)
  } catch {}
  return {}
}

const dv = (u: Uint8Array) => new DataView(u.buffer, u.byteOffset, u.byteLength)

function parsePng(u: Uint8Array): HeaderInfo {
  const d = dv(u)
  const colorType = u[25]
  let hasAlpha = colorType === 4 || colorType === 6
  let density: number | undefined
  for (let p = 8; p + 8 <= u.length;) {
    const len = d.getUint32(p), type = ascii(u, p + 4, 4)
    if (type === 'tRNS') hasAlpha = true
    if (type === 'pHYs' && u[p + 16] === 1) density = Math.round(d.getUint32(p + 8) * 0.0254)
    if (type === 'IDAT' || type === 'IEND') break
    p += 12 + len
  }
  return { hasAlpha, density, channels: colorType === 0 ? 1 : colorType === 4 ? 2 : hasAlpha ? 4 : 3 }
}

function parseWebp(u: Uint8Array): HeaderInfo {
  const chunk = ascii(u, 12, 4)
  if (chunk === 'VP8X') return { hasAlpha: (u[20] & 0x10) !== 0 }
  if (chunk === 'VP8L') return { hasAlpha: (u[24] & 0x10) !== 0 }
  return { hasAlpha: false }
}

function parseJpeg(u: Uint8Array): HeaderInfo {
  const d = dv(u)
  const out: HeaderInfo = { hasAlpha: false }
  for (let p = 2; p + 4 <= u.length;) {
    if (u[p] !== 0xff) break
    const marker = u[p + 1]
    if (marker === 0xd9 || marker === 0xda) break
    const len = d.getUint16(p + 2)
    if (marker === 0xe0 && ascii(u, p + 4, 4) === 'JFIF' && u[p + 11] === 1) out.density = d.getUint16(p + 12)
    if (marker === 0xe1 && ascii(u, p + 4, 4) === 'Exif') out.orientation = exifOrientation(u, p + 10)
    // SOFn：分量数（1 = 灰度）和存储宽高
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) { out.channels = u[p + 9] === 1 ? 1 : 3; out.height = d.getUint16(p + 5); out.width = d.getUint16(p + 7) }
    p += 2 + len
  }
  return out
}

function exifOrientation(u: Uint8Array, t: number): number | undefined {
  const d = dv(u)
  const le = u[t] === 0x49
  const ifd = t + d.getUint32(t + 4, le)
  const n = d.getUint16(ifd, le)
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (d.getUint16(e, le) === 0x0112) {
      const v = d.getUint16(e + 8, le)
      return v >= 1 && v <= 8 ? v : undefined
    }
  }
  return undefined
}

// ---- 解码 ----

/** SVG 的固有尺寸：width/height 属性，退而求其次用 viewBox */
function svgSize(text: string): { w: number; h: number } | undefined {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (!tag) return undefined
  const num = (name: string) => { const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag); return m ? +m[1] : undefined }
  let w = num('width'), h = num('height')
  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1].split(/[\s,]+/).map(Number)
  if (vb && vb.length === 4) {
    if (w == null && h == null) { w = vb[2]; h = vb[3] }
    else if (w == null && h != null) w = (h * vb[2]) / vb[3]
    else if (h == null && w != null) h = (w * vb[3]) / vb[2]
  }
  return w && h ? { w, h } : undefined
}

/** 浏览器把 svg 当图片加载时根元素必须带 xmlns（librsvg 不要求，很多插件手写的 svg 没写） */
export function withSvgNamespace(text: string): string {
  return text.replace(/<svg\b([^>]*)>/i, (m, attrs: string) => {
    let extra = ''
    if (!/\sxmlns\s*=/.test(attrs)) extra += ' xmlns="http://www.w3.org/2000/svg"'
    if (/xlink:/.test(text) && !/\sxmlns:xlink\s*=/.test(attrs)) extra += ' xmlns:xlink="http://www.w3.org/1999/xlink"'
    return extra ? `<svg${extra}${attrs}>` : m
  })
}

async function decodeSvg(u: Uint8Array, density = 72): Promise<Cv> {
  const scale = density / 72
  const text = withSvgNamespace(new TextDecoder().decode(u))
  const blob = new Blob([text], { type: 'image/svg+xml' })
  const size = svgSize(text)
  if (hasDoc() && typeof Image !== 'undefined') {
    // Chrome 的 createImageBitmap 解不了 svg blob，只能走 <img>
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      const w = (size?.w ?? (img.naturalWidth || 300)) * scale
      const h = (size?.h ?? (img.naturalHeight || 150)) * scale
      const c = newCanvas(w, h)
      ctxOf(c).drawImage(img, 0, 0, c.width, c.height)
      return c
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const bmp = await createImageBitmap(blob)
  const c = newCanvas((size?.w ?? bmp.width) * scale, (size?.h ?? bmp.height) * scale)
  ctxOf(c).drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c
}

/** 按 EXIF 方向值把“存储方向”的图摆正（o = 1..8） */
export function orient(c: Cv, o: number): Cv {
  const w = c.width, h = c.height, swap = o >= 5
  const out = newCanvas(swap ? h : w, swap ? w : h), ctx = ctxOf(out)
  const m: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w],
  }
  if (!m[o]) return c
  ctx.imageSmoothingEnabled = false
  ctx.setTransform(...m[o])
  ctx.drawImage(c, 0, 0)
  return out
}
const INVERSE: Record<number, number> = { 6: 8, 8: 6 }

export async function decode(u: Uint8Array, fmt: InFormat, opts: { autoOrient?: boolean; density?: number; head?: HeaderInfo } = {}): Promise<Cv> {
  try {
    if (fmt === 'svg') return await decodeSvg(u, opts.density)
    const blob = new Blob([u as BlobPart], { type: mimeOf(fmt) })
    const o = opts.head?.orientation ?? 1
    // 知道 EXIF 方向（jpeg）时统一按 from-image 解码再自己纠正：Chrome 对 'none' 也会套用 EXIF
    const mode = o > 1 || opts.autoOrient ? 'from-image' : 'none'
    let bmp: ImageBitmap
    try {
      bmp = await createImageBitmap(blob, { imageOrientation: mode as ImageOrientation })
    } catch (e) {
      // 老浏览器不认 imageOrientation: 'none'，退回默认
      if (e instanceof TypeError) bmp = await createImageBitmap(blob)
      else throw e
    }
    let c = newCanvas(bmp.width, bmp.height)
    ctxOf(c).drawImage(bmp, 0, 0)
    bmp.close()
    if (o > 1) {
      const { width: rw, height: rh } = opts.head ?? {}
      // 5~8 能从宽高看出浏览器有没有套用；2~4 按规范视为已套用
      const applied = o >= 5 && rw && rh ? c.width === rh && c.height === rw : true
      if (applied && !opts.autoOrient) c = orient(c, INVERSE[o] ?? o)
      else if (!applied && opts.autoOrient) c = orient(c, o)
    }
    return c
  } catch {
    throw err('Input buffer contains unsupported image format')
  }
}

// ---- 编码 ----

export async function encode(c: Cv, mime: string, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: mime, quality }).catch(() => null)
  return new Promise((resolve) => (c as HTMLCanvasElement).toBlob(resolve, mime, quality))
}
