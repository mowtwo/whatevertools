// 浏览器版 sharp：在 Canvas 上实现 sharp 的常用子集，注入成 utools.sharp / image.sharp。
// 链式方法只记录操作，输出时按调用顺序在 RGBA 画布上执行；实例不被输出改动，可以重复输出。
import { ctxOf, decode, detectFormat, encode, err, mimeOf, newCanvas, parseHeader, type Cv, type InFormat } from './canvas'
import { cssOf, parseColor, type ColorInput, type Rgba } from './color'
import * as px from './pixels'

export { parseColor } from './color'
export { detectFormat } from './canvas'

export interface CanvasSharpIO {
  readFile?(path: string): Uint8Array | Promise<Uint8Array>
  writeFile?(path: string, data: Uint8Array): void | Promise<void>
  /** 有 Buffer shim 时用它包装输出 */
  Buffer?: { from(u8: Uint8Array): Uint8Array }
}

export interface OutputInfo {
  format: string; width: number; height: number; channels: number; size: number; premultiplied: boolean
  trimOffsetLeft?: number; trimOffsetTop?: number
}

export interface Metadata {
  format?: string; width: number; height: number; channels: number; hasAlpha: boolean
  space: 'srgb'; depth: 'uchar'; density?: number; pages: number; orientation?: number; size?: number
  autoOrient: { width: number; height: number }
}

type Raw = { width: number; height: number; channels: number }
type Source =
  | { kind: 'path'; path: string; density?: number }
  | { kind: 'bytes'; u8: Uint8Array; density?: number }
  | { kind: 'raw'; u8: Uint8Array; raw: Raw }
  | { kind: 'create'; width: number; height: number; channels: number; bg: Rgba }
  | { kind: 'bad'; message: string }

/** 执行状态：画布 + 输出通道数（1 灰 / 2 灰+α / 3 RGB / 4 RGBA） */
interface St { c: Cv; ch: number; fmt: string; trimLeft?: number; trimTop?: number }
interface Op { auto?: boolean; run(st: St): St | Promise<St> }

const hasA = (ch: number) => ch === 2 || ch === 4
const withA = (ch: number) => (hasA(ch) ? ch : ch + 1)
const noA = (ch: number) => (hasA(ch) ? ch - 1 : ch)
const isFn = (v: unknown): v is (...a: any[]) => any => typeof v === 'function'

function toU8(v: any): Uint8Array | undefined {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  return undefined
}

function toSource(input: any, options: any = {}): Source {
  if (input && typeof input === 'object' && !toU8(input) && !Array.isArray(input)) { options = { ...input, ...options }; input = undefined }
  if (input == null && options.create) {
    const c = options.create
    if (!(c.width > 0 && c.height > 0) || ![3, 4].includes(c.channels)) return { kind: 'bad', message: 'Expected valid width, height and channels for create' }
    return { kind: 'create', width: Math.round(c.width), height: Math.round(c.height), channels: c.channels, bg: parseColor(c.background) }
  }
  if (typeof input === 'string') return { kind: 'path', path: input, density: options.density }
  const u8 = toU8(input)
  if (u8) {
    if (options.raw) {
      const r = options.raw as Raw
      if (!(r.width > 0 && r.height > 0) || ![1, 2, 3, 4].includes(r.channels)) return { kind: 'bad', message: 'Expected width, height and channels for raw pixel input' }
      if (u8.length < r.width * r.height * r.channels) return { kind: 'bad', message: 'Input buffer is smaller than raw width * height * channels' }
      return { kind: 'raw', u8, raw: r }
    }
    return { kind: 'bytes', u8, density: options.density }
  }
  if (options.text) return { kind: 'bad', message: 'sharp-canvas 不支持 text 输入' }
  if (Array.isArray(input)) return { kind: 'bad', message: 'sharp-canvas 不支持多图 join 输入' }
  if (input == null) return { kind: 'bad', message: 'Input not provided（浏览器版不支持流式输入）' }
  return { kind: 'bad', message: 'Unsupported input: expected path string, Buffer / Uint8Array / ArrayBuffer, or { create }' }
}

const DEFAULT_ALPHA: Record<string, boolean> = { png: true, webp: true, gif: true, avif: true, heif: true, svg: true, ico: true, jpeg: false, bmp: false, tiff: false }

function fill(w: number, h: number, bg?: Rgba): Cv {
  const c = newCanvas(w, h)
  if (bg && bg.a > 0) { const ctx = ctxOf(c); ctx.fillStyle = cssOf(bg); ctx.fillRect(0, 0, c.width, c.height) }
  return c
}

function pixels(st: St, fn: (d: Uint8ClampedArray, w: number, h: number) => void): St {
  const ctx = ctxOf(st.c), w = st.c.width, h = st.c.height
  const img = ctx.getImageData(0, 0, w, h)
  fn(img.data, w, h)
  ctx.putImageData(img, 0, 0)
  return st
}

function drawTo(src: Cv, w: number, h: number, smooth: boolean): Cv {
  const c = newCanvas(w, h), ctx = ctxOf(c)
  ctx.imageSmoothingEnabled = smooth
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

/** 缩放；缩小超过 2 倍时逐级减半，避免锯齿 */
function scaleTo(c: Cv, w: number, h: number, smooth: boolean): Cv {
  let cur = c
  while (smooth && (cur.width > w * 2 || cur.height > h * 2)) {
    cur = drawTo(cur, cur.width > w * 2 ? Math.ceil(cur.width / 2) : cur.width, cur.height > h * 2 ? Math.ceil(cur.height / 2) : cur.height, true)
  }
  return cur.width === w && cur.height === h && cur !== c ? cur : drawTo(cur, w, h, smooth)
}

function crop(c: Cv, x: number, y: number, w: number, h: number): Cv {
  const out = newCanvas(w, h)
  ctxOf(out).drawImage(c, x, y, w, h, 0, 0, w, h)
  return out
}

/** gravity / position（字符串或 sharp.gravity / sharp.position / sharp.strategy 的数字）-> [gx, gy] */
function gravity(g: unknown): [number, number] {
  if (typeof g === 'number') g = ['center', 'north', 'east', 'south', 'west', 'northeast', 'southeast', 'southwest', 'northwest'][g] ?? 'center'
  const s = String(g ?? 'center').toLowerCase()
  let gx = 0.5, gy = 0.5
  if (/north|top/.test(s)) gy = 0
  if (/south|bottom/.test(s)) gy = 1
  if (/east|right/.test(s)) gx = 1
  if (/west|left/.test(s)) gx = 0
  return [gx, gy]
}

const BLEND: Record<string, GlobalCompositeOperation | 'skip' | 'clear'> = {
  over: 'source-over', in: 'source-in', out: 'source-out', atop: 'source-atop', source: 'copy',
  dest: 'skip', 'dest-over': 'destination-over', 'dest-in': 'destination-in', 'dest-out': 'destination-out', 'dest-atop': 'destination-atop',
  xor: 'xor', add: 'lighter', saturate: 'lighter', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  darken: 'darken', lighten: 'lighten', 'colour-dodge': 'color-dodge', 'color-dodge': 'color-dodge',
  'colour-burn': 'color-burn', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', clear: 'clear',
}

const ALIAS: Record<string, string> = { jpg: 'jpeg', tif: 'tiff', heic: 'heif' }
const OUT_FORMATS = ['png', 'jpeg', 'webp', 'avif', 'heif', 'gif', 'tiff', 'raw']
const fmtName = (f: unknown) => { const s = String((f as any)?.id ?? f).toLowerCase(); return ALIAS[s] ?? s }

let filterOk: boolean | undefined
function canFilter(): boolean {
  if (filterOk === undefined) {
    try { const ctx = ctxOf(newCanvas(1, 1)); ctx.filter = 'blur(1px)'; filterOk = ctx.filter === 'blur(1px)' } catch { filterOk = false }
  }
  return filterOk
}

/** ctx.filter 模糊；先把边缘像素向外延伸，避免边缘发虚变透明 */
function filterBlur(c: Cv, sigma: number): Cv {
  const w = c.width, h = c.height, p = Math.ceil(sigma * 3)
  const pad = newCanvas(w + 2 * p, h + 2 * p), pc = ctxOf(pad)
  pc.imageSmoothingEnabled = false
  pc.drawImage(c, p, p)
  const strips: number[][] = [
    [0, 0, 1, h, 0, p, p, h], [w - 1, 0, 1, h, w + p, p, p, h], [0, 0, w, 1, p, 0, w, p], [0, h - 1, w, 1, p, h + p, w, p],
    [0, 0, 1, 1, 0, 0, p, p], [w - 1, 0, 1, 1, w + p, 0, p, p], [0, h - 1, 1, 1, 0, h + p, p, p], [w - 1, h - 1, 1, 1, w + p, h + p, p, p],
  ]
  for (const s of strips) pc.drawImage(c, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7])
  const out = newCanvas(w, h), oc = ctxOf(out)
  oc.filter = `blur(${sigma}px)`
  oc.drawImage(pad, -p, -p)
  return out
}

function allOpaque(c: Cv): boolean {
  const d = ctxOf(c).getImageData(0, 0, c.width, c.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false
  return true
}

const UNSUPPORTED = ['affine', 'convolve', 'recomb', 'boolean', 'joinChannel', 'bandbool', 'clahe', 'dilate', 'erode', 'unflatten', 'pipe', 'stream']

export class CanvasSharp {
  private ops: Op[] = []
  private out: { fmt?: string; opts: any } = { opts: {} }

  constructor(private lib: Lib, private src: Source) {
    for (const name of UNSUPPORTED) (this as any)[name] = () => { throw err(`sharp-canvas 不支持 ${name}()`, 'EWTUNSUPPORTED') }
  }

  private add(run: Op['run'], auto?: boolean): this { this.ops.push({ run, auto }); return this }

  // ---- 输入 ----

  private async bytes(s: { kind: 'path'; path: string } | { kind: 'bytes'; u8: Uint8Array }): Promise<Uint8Array> {
    if (s.kind === 'bytes') return s.u8
    if (!this.lib.io.readFile) throw err(`Input file is missing: ${s.path}`)
    try { return toU8(await this.lib.io.readFile(s.path))! } catch { throw err(`Input file is missing: ${s.path}`) }
  }

  private async load(src: Source, autoOrient: boolean): Promise<St> {
    if (src.kind === 'bad') throw err(src.message)
    if (src.kind === 'create') return { c: fill(src.width, src.height, src.channels === 3 ? { ...src.bg, a: 1 } : src.bg), ch: src.channels, fmt: 'raw' }
    if (src.kind === 'raw') {
      const { width: w, height: h, channels: n } = src.raw
      const c = newCanvas(w, h), ctx = ctxOf(c)
      const img = ctx.createImageData(w, h), d = img.data, s = src.u8
      for (let p = 0, i = 0, j = 0; p < w * h; p++, i += 4, j += n) {
        if (n <= 2) { d[i] = d[i + 1] = d[i + 2] = s[j]; d[i + 3] = n === 2 ? s[j + 1] : 255 }
        else { d[i] = s[j]; d[i + 1] = s[j + 1]; d[i + 2] = s[j + 2]; d[i + 3] = n === 4 ? s[j + 3] : 255 }
      }
      ctx.putImageData(img, 0, 0)
      return { c, ch: n, fmt: 'raw' }
    }
    const u8 = await this.bytes(src)
    const fmt = detectFormat(u8)
    if (!fmt) throw err('Input buffer contains unsupported image format')
    const head = parseHeader(u8, fmt)
    const c = await decode(u8, fmt, { autoOrient, density: src.density, head })
    const alpha = head.hasAlpha ?? DEFAULT_ALPHA[fmt]
    return { c, ch: head.channels ?? (alpha ? 4 : 3), fmt }
  }

  private async run(): Promise<St> {
    let st = await this.load(this.src, this.ops.some((o) => o.auto))
    for (const op of this.ops) st = await op.run(st)
    return st
  }

  // ---- 信息 ----

  metadata(cb?: (e: Error | null, m?: Metadata) => void): Promise<Metadata> | this {
    return this.settle(this.readMetadata(), cb, (m) => [m])
  }

  private async readMetadata(): Promise<Metadata> {
    const src = this.src
    const base = { space: 'srgb' as const, depth: 'uchar' as const, pages: 1 }
    if (src.kind === 'bad') throw err(src.message)
    if (src.kind === 'raw' || src.kind === 'create') {
      const width = src.kind === 'raw' ? src.raw.width : src.width, height = src.kind === 'raw' ? src.raw.height : src.height
      const channels = src.kind === 'raw' ? src.raw.channels : src.channels
      return { ...base, format: 'raw', width, height, channels, hasAlpha: hasA(channels), size: src.kind === 'raw' ? src.u8.length : undefined, autoOrient: { width, height } }
    }
    const u8 = await this.bytes(src)
    const fmt = detectFormat(u8) as InFormat | undefined
    if (!fmt) throw err('Input buffer contains unsupported image format')
    const head = parseHeader(u8, fmt)
    const c = await decode(u8, fmt, { autoOrient: false, density: src.density, head })
    const hasAlpha = head.hasAlpha ?? DEFAULT_ALPHA[fmt]
    const m: Metadata = {
      ...base, format: fmt, width: c.width, height: c.height, channels: head.channels ?? (hasAlpha ? 4 : 3), hasAlpha,
      size: u8.length, autoOrient: (head.orientation ?? 1) >= 5 ? { width: c.height, height: c.width } : { width: c.width, height: c.height },
    }
    const density = fmt === 'svg' ? src.density ?? 72 : head.density
    if (density) m.density = density
    if (head.orientation) m.orientation = head.orientation
    return m
  }

  stats(cb?: (e: Error | null, s?: any) => void): Promise<ReturnType<typeof px.stats>> | this {
    return this.settle(this.run().then((st) => px.stats(ctxOf(st.c).getImageData(0, 0, st.c.width, st.c.height).data, st.c.width, st.ch)), cb, (s) => [s])
  }

  // ---- 几何 ----

  resize(width?: any, height?: number | null, opts?: any): this {
    const o = { ...(width && typeof width === 'object' ? width : { width, height }), ...(opts ?? {}) }
    if (width && typeof width === 'object' && height && typeof height === 'object') Object.assign(o, height)
    return this.add((st) => {
      const W0 = st.c.width, H0 = st.c.height
      const tw = o.width ? Math.round(o.width) : 0, th = o.height ? Math.round(o.height) : 0
      if (!tw && !th) return st
      const fit = o.fit ?? 'cover'
      let sw: number, sh: number
      if (!th) { sw = tw; sh = Math.max(1, Math.round((H0 * tw) / W0)) }
      else if (!tw) { sh = th; sw = Math.max(1, Math.round((W0 * th) / H0)) }
      else if (fit === 'fill') { sw = tw; sh = th }
      else {
        const s = fit === 'inside' || fit === 'contain' ? Math.min(tw / W0, th / H0) : Math.max(tw / W0, th / H0)
        sw = Math.max(1, Math.round(W0 * s)); sh = Math.max(1, Math.round(H0 * s))
        if (fit === 'cover') { sw = Math.max(sw, tw); sh = Math.max(sh, th) }
      }
      // 不放大 / 不缩小：触发时整个 resize 跳过
      if (o.withoutEnlargement && (sw > W0 || sh > H0)) return st
      if (o.withoutReduction && (sw < W0 || sh < H0)) return st
      const scaled = sw === W0 && sh === H0 ? st.c : scaleTo(st.c, sw, sh, o.kernel !== 'nearest')
      const [gx, gy] = gravity(o.position ?? o.gravity)
      if (tw && th && fit === 'cover' && (sw !== tw || sh !== th)) {
        return { ...st, c: crop(scaled, Math.round((sw - tw) * gx), Math.round((sh - th) * gy), tw, th) }
      }
      if (tw && th && fit === 'contain' && (sw !== tw || sh !== th)) {
        const bg = parseColor(o.background)
        const c = fill(tw, th, bg)
        ctxOf(c).drawImage(scaled, Math.round((tw - sw) * gx), Math.round((th - sh) * gy))
        return { ...st, c, ch: bg.a < 1 ? withA(st.ch) : st.ch }
      }
      return { ...st, c: scaled }
    })
  }

  extend(e: number | { top?: number; bottom?: number; left?: number; right?: number; background?: ColorInput; extendWith?: string }): this {
    const o = typeof e === 'number' ? { top: e, bottom: e, left: e, right: e } : e
    return this.add((st) => {
      const t = Math.round(o.top ?? 0), b = Math.round(o.bottom ?? 0), l = Math.round(o.left ?? 0), r = Math.round(o.right ?? 0)
      const bg = parseColor((o as any).background)
      const c = fill(st.c.width + l + r, st.c.height + t + b, bg)
      ctxOf(c).drawImage(st.c, l, t)
      return { ...st, c, ch: bg.a < 1 ? withA(st.ch) : st.ch }
    })
  }

  extract(o: { left: number; top: number; width: number; height: number }): this {
    return this.add((st) => {
      const ok = [o.left, o.top, o.width, o.height].every((v) => Number.isInteger(v) && v >= 0) && o.width > 0 && o.height > 0
      if (!ok || o.left + o.width > st.c.width || o.top + o.height > st.c.height) throw err('extract_area: bad extract area')
      return { ...st, c: crop(st.c, o.left, o.top, o.width, o.height) }
    })
  }

  trim(opts?: number | string | { background?: ColorInput; threshold?: number; lineArt?: boolean }): this {
    const o = typeof opts === 'number' ? { threshold: opts } : typeof opts === 'string' ? { background: opts } : opts ?? {}
    return this.add((st) => {
      const w = st.c.width, h = st.c.height
      const d = ctxOf(st.c).getImageData(0, 0, w, h).data
      const bg = o.background != null ? parseColor(o.background) : { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
      const box = px.trimBox(d, w, h, bg, o.threshold ?? 10)
      if (!box) return st
      return { ...st, c: crop(st.c, box.left, box.top, box.width, box.height), trimLeft: -box.left, trimTop: -box.top }
    })
  }

  rotate(angle?: number, opts?: { background?: ColorInput }): this {
    if (angle == null) return this.autoOrient()
    return this.add((st) => {
      const a = ((Math.round(angle * 1e6) / 1e6) % 360 + 360) % 360
      if (a === 0) return st
      const w = st.c.width, h = st.c.height
      if (a % 90 === 0) {
        const swap = a !== 180
        const c = newCanvas(swap ? h : w, swap ? w : h), ctx = ctxOf(c)
        ctx.imageSmoothingEnabled = false
        if (a === 90) ctx.translate(h, 0)
        else if (a === 180) ctx.translate(w, h)
        else ctx.translate(0, w)
        ctx.rotate((a * Math.PI) / 180)
        ctx.drawImage(st.c, 0, 0)
        return { ...st, c }
      }
      // 任意角度：画布扩成外接矩形，空白用背景色（默认黑）
      const rad = (a * Math.PI) / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad))
      const nw = Math.round(w * cos + h * sin), nh = Math.round(w * sin + h * cos)
      const bg = parseColor(opts?.background)
      const c = fill(nw, nh, bg), ctx = ctxOf(c)
      ctx.imageSmoothingQuality = 'high'
      ctx.translate(nw / 2, nh / 2)
      ctx.rotate(rad)
      ctx.drawImage(st.c, -w / 2, -h / 2)
      return { ...st, c, ch: bg.a < 1 ? withA(st.ch) : st.ch }
    })
  }

  /** 按 EXIF 方向摆正：实际在解码时用 imageOrientation: 'from-image' 完成 */
  autoOrient(): this { return this.add((st) => st, true) }

  flip(on = true): this { return on ? this.mirror(false) : this }
  flop(on = true): this { return on ? this.mirror(true) : this }

  private mirror(horizontal: boolean): this {
    return this.add((st) => {
      const w = st.c.width, h = st.c.height
      const c = newCanvas(w, h), ctx = ctxOf(c)
      ctx.imageSmoothingEnabled = false
      if (horizontal) { ctx.translate(w, 0); ctx.scale(-1, 1) } else { ctx.translate(0, h); ctx.scale(1, -1) }
      ctx.drawImage(st.c, 0, 0)
      return { ...st, c }
    })
  }

  // ---- 通道 ----

  flatten(o?: boolean | { background?: ColorInput }): this {
    if (o === false) return this
    return this.add((st) => {
      if (!hasA(st.ch)) return st
      const bg = { ...parseColor(typeof o === 'object' ? o.background : undefined), a: 1 }
      const c = fill(st.c.width, st.c.height, bg)
      ctxOf(c).drawImage(st.c, 0, 0)
      return { ...st, c, ch: noA(st.ch) }
    })
  }

  ensureAlpha(alpha?: number): this {
    return this.add((st) => {
      if (hasA(st.ch)) return st
      if (alpha != null && alpha < 1) pixels(st, (d) => { const v = Math.round(Math.max(0, alpha) * 255); for (let i = 3; i < d.length; i += 4) d[i] = v })
      return { ...st, ch: withA(st.ch) }
    })
  }

  removeAlpha(): this {
    return this.add((st) => {
      if (!hasA(st.ch)) return st
      pixels(st, (d) => { for (let i = 3; i < d.length; i += 4) d[i] = 255 })
      return { ...st, ch: noA(st.ch) }
    })
  }

  extractChannel(channel: number | 'red' | 'green' | 'blue' | 'alpha'): this {
    const idx = typeof channel === 'number' ? channel : ['red', 'green', 'blue', 'alpha'].indexOf(channel)
    return this.add((st) => {
      const k = st.ch <= 2 && idx === 1 ? 3 : idx
      if (!(k >= 0 && k <= 3)) throw err('Cannot extract invalid channel')
      pixels(st, (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + k]; d[i + 3] = 255 } })
      return { ...st, ch: 1 }
    })
  }

  // ---- 合成 ----

  composite(list: Array<{ input: any; top?: number; left?: number; gravity?: unknown; blend?: string; tile?: boolean; raw?: Raw; density?: number; premultiplied?: boolean }>): this {
    const items = [...list]
    return this.add(async (st) => {
      const W = st.c.width, H = st.c.height
      const ctx = ctxOf(st.c)
      for (const o of items) {
        const ov = (await this.load(toSource(o.input, { raw: o.raw, density: o.density }), false)).c
        if (!o.tile && (ov.width > W || ov.height > H)) throw err('Image to composite must have same dimensions or smaller')
        const mode = BLEND[o.blend ?? 'over']
        if (!mode) throw err(`Expected valid blend name for blend but received ${o.blend}`)
        if (mode === 'skip') continue
        if (mode === 'clear') { ctx.clearRect(0, 0, W, H); continue }
        // 先画到整幅透明图层：in / dest-in 等模式下覆盖层以外视为透明（和 libvips 一致）
        const layer = newCanvas(W, H), lc = ctxOf(layer)
        if (o.tile) { lc.fillStyle = lc.createPattern(ov, 'repeat')!; lc.fillRect(0, 0, W, H) }
        else {
          const [gx, gy] = gravity(o.gravity)
          const x = o.left != null && o.top != null ? o.left : Math.round((W - ov.width) * gx)
          const y = o.left != null && o.top != null ? o.top : Math.round((H - ov.height) * gy)
          lc.drawImage(ov, x, y)
        }
        ctx.save()
        ctx.globalCompositeOperation = mode
        ctx.drawImage(layer, 0, 0)
        ctx.restore()
      }
      return { ...st, ch: hasA(st.ch) || !allOpaque(st.c) ? 4 : st.ch <= 2 ? 3 : st.ch }
    })
  }

  // ---- 像素运算 ----

  blur(sigma?: number | boolean | { sigma?: number }): this {
    if (sigma === false) return this
    const s = typeof sigma === 'number' ? sigma : typeof sigma === 'object' ? sigma.sigma ?? 0.8 : 0.8
    return this.add((st) => (canFilter() ? { ...st, c: filterBlur(st.c, s) } : pixels(st, (d, w, h) => px.boxBlur(d, w, h, s))))
  }

  sharpen(o?: number | { sigma?: number; m1?: number; m2?: number }): this {
    const sigma = typeof o === 'number' ? o : o?.sigma
    return this.add((st) => pixels(st, (d, w, h) => px.sharpen(d, w, h, sigma ?? 1, sigma == null ? 0.5 : 1)))
  }

  median(size = 3): this { return this.add((st) => pixels(st, (d, w, h) => px.median(d, w, h, size))) }

  grayscale(on = true): this { return on ? this.add((st) => ({ ...pixels(st, px.grayscale), ch: hasA(st.ch) ? 2 : 1 })) : this }
  greyscale(on = true): this { return this.grayscale(on) }

  toColourspace(space?: string): this { return space === 'b-w' ? this.grayscale() : this }
  toColorspace(space?: string): this { return this.toColourspace(space) }
  pipelineColourspace(): this { return this }
  pipelineColorspace(): this { return this }

  negate(o?: boolean | { alpha?: boolean }): this {
    if (o === false) return this
    const alpha = typeof o === 'object' ? o.alpha !== false : true
    return this.add((st) => pixels(st, (d) => px.negate(d, alpha && hasA(st.ch))))
  }

  modulate(o: { brightness?: number; saturation?: number; hue?: number; lightness?: number } = {}): this {
    return this.add((st) => pixels(st, (d) => px.modulate(d, o)))
  }

  tint(color: ColorInput): this {
    const c = parseColor(color)
    return this.add((st) => ({ ...pixels(st, (d) => px.tint(d, c)), ch: hasA(st.ch) ? 4 : 3 }))
  }

  gamma(g = 2.2, gOut?: number): this {
    const exp = g / (gOut ?? g)
    return exp === 1 ? this : this.add((st) => pixels(st, (d) => px.gamma(d, exp)))
  }

  normalise(o?: boolean | { lower?: number; upper?: number }): this {
    if (o === false) return this
    const lo = typeof o === 'object' ? o.lower ?? 1 : 1, hi = typeof o === 'object' ? o.upper ?? 99 : 99
    return this.add((st) => pixels(st, (d) => px.normalise(d, lo, hi)))
  }
  normalize(o?: boolean | { lower?: number; upper?: number }): this { return this.normalise(o) }

  threshold(t = 128, o?: { greyscale?: boolean; grayscale?: boolean }): this {
    const grey = o?.greyscale ?? o?.grayscale ?? true
    return this.add((st) => ({ ...pixels(st, (d) => px.threshold(d, t, grey)), ch: grey ? (hasA(st.ch) ? 2 : 1) : st.ch }))
  }

  linear(a: number | number[] = 1, b: number | number[] = 0): this {
    const A = Array.isArray(a) ? a : [a], B = Array.isArray(b) ? b : [b]
    return this.add((st) => pixels(st, (d) => px.linear(d, A, B)))
  }

  // ---- 无操作 ----

  withMetadata(): this { return this }
  keepMetadata(): this { return this }
  keepExif(): this { return this }
  withExif(): this { return this }
  withExifMerge(): this { return this }
  keepIccProfile(): this { return this }
  withIccProfile(): this { return this }
  timeout(): this { return this }

  clone(): CanvasSharp {
    const c = new CanvasSharp(this.lib, this.src)
    c.ops = [...this.ops]
    c.out = { ...this.out }
    return c
  }

  // ---- 输出格式 ----

  toFormat(format: string | { id: string }, opts?: any): this {
    const f = fmtName(format)
    if (!OUT_FORMATS.includes(f)) throw err(`Unsupported output format ${f}`)
    this.out = { fmt: f, opts: opts ?? {} }
    return this
  }
  png(o?: any): this { return this.toFormat('png', o) }
  jpeg(o?: any): this { return this.toFormat('jpeg', o) }
  jpg(o?: any): this { return this.toFormat('jpeg', o) }
  webp(o?: any): this { return this.toFormat('webp', o) }
  avif(o?: any): this { return this.toFormat('avif', o) }
  heif(o?: any): this { return this.toFormat(o?.compression === 'av1' ? 'avif' : 'heif', o) }
  gif(o?: any): this { return this.toFormat('gif', o) }
  tiff(o?: any): this { return this.toFormat('tiff', o) }
  raw(o?: any): this { return this.toFormat('raw', o) }

  private async render(fmtHint?: string): Promise<{ data: Uint8Array; info: OutputInfo }> {
    const st = await this.run()
    const w = st.c.width, h = st.c.height
    const explicit = this.out.fmt ?? fmtHint
    let fmt = explicit ?? (['png', 'jpeg', 'webp', 'avif', 'raw'].includes(st.fmt) ? st.fmt : 'png')
    const trim = st.trimLeft != null ? { trimOffsetLeft: st.trimLeft, trimOffsetTop: st.trimTop } : {}
    if (fmt === 'raw') {
      const d = ctxOf(st.c).getImageData(0, 0, w, h).data, n = st.ch
      const idx = n === 1 ? [0] : n === 2 ? [0, 3] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]
      const data = new Uint8Array(w * h * n)
      for (let p = 0, j = 0; p < w * h; p++) for (const k of idx) data[j++] = d[p * 4 + k]
      return { data, info: { format: 'raw', width: w, height: h, channels: n, size: data.length, premultiplied: false, ...trim } }
    }
    const o = this.out.opts ?? {}
    const q = (dflt: number) => Math.min(1, Math.max(0, (o.quality ?? dflt) / 100))
    let blob: Blob | null = null
    for (;;) {
      const mime = mimeOf(fmt)
      const quality = fmt === 'jpeg' ? q(80) : fmt === 'webp' ? (o.lossless ? 1 : q(80)) : fmt === 'avif' || fmt === 'heif' ? q(50) : undefined
      blob = await encode(st.c, mime, quality)
      if (blob && blob.type === mime) break
      if (explicit) throw err(`浏览器不支持编码 ${fmt.toUpperCase()}，请改用 png / jpeg / webp`, 'EWTUNSUPPORTED')
      fmt = 'png'
    }
    const data = new Uint8Array(await blob.arrayBuffer())
    const channels = fmt === 'jpeg' ? noA(st.ch) : st.ch
    // sharp 输出 avif 时 info.format 报的就是 heif
    return { data, info: { format: fmt === 'avif' ? 'heif' : fmt, width: w, height: h, channels, size: data.length, premultiplied: false, ...trim } }
  }

  private wrap(u8: Uint8Array): Uint8Array { return this.lib.io.Buffer ? this.lib.io.Buffer.from(u8) : u8 }

  private settle<T>(p: Promise<T>, cb: ((...a: any[]) => void) | undefined, args: (v: T) => any[]): any {
    if (!cb) return p
    p.then((v) => cb(null, ...args(v)), (e) => cb(e))
    return this
  }

  toBuffer(opts?: { resolveWithObject?: boolean } | ((e: Error | null, data?: Uint8Array, info?: OutputInfo) => void), cb?: (e: Error | null, data?: Uint8Array, info?: OutputInfo) => void): Promise<any> {
    if (isFn(opts)) { cb = opts; opts = undefined }
    const p = this.render().then((r) => ({ data: this.wrap(r.data), info: r.info }))
    if (cb) return this.settle(p, cb, (r) => [r.data, r.info])
    return opts?.resolveWithObject ? p : p.then((r) => r.data)
  }

  toFile(path: string, cb?: (e: Error | null, info?: OutputInfo) => void): Promise<OutputInfo> {
    const p = (async () => {
      if (!path) throw err('Missing output file path')
      if (this.src.kind === 'path' && this.src.path === path) throw err('Cannot use same file for input and output')
      if (!this.lib.io.writeFile) throw err('sharp-canvas: toFile 需要 io.writeFile')
      const ext = fmtName(/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '')
      const r = await this.render(OUT_FORMATS.includes(ext) && ext !== 'raw' ? ext : undefined)
      await this.lib.io.writeFile!(path, this.wrap(r.data))
      return r.info
    })()
    return this.settle(p, cb, (i) => [i])
  }
}

interface Lib { io: CanvasSharpIO }

const fmtInfo = (id: string, input: boolean, output: boolean) => ({
  id, input: { file: input, buffer: input, stream: false }, output: { file: output, buffer: output, stream: false },
})

export type CanvasSharpFactory = ((input?: any, options?: any) => CanvasSharp) & {
  cache(o?: unknown): { memory: object; files: object; items: object }
  concurrency(n?: number): number
  simd(on?: boolean): boolean
  counters(): { queue: number; process: number }
  versions: Record<string, string>
  format: Record<string, ReturnType<typeof fmtInfo>>
  gravity: Record<string, number>
  strategy: Record<string, number>
  position: Record<string, number>
  fit: Record<string, string>
  kernel: Record<string, string>
}

export function createCanvasSharp(io: CanvasSharpIO = {}): CanvasSharpFactory {
  const lib: Lib = { io }
  const sharp = function sharp(input?: any, options?: any) { return new CanvasSharp(lib, toSource(input, options)) } as CanvasSharpFactory
  sharp.cache = () => ({ memory: { current: 0, high: 0, max: 0 }, files: { current: 0, max: 0 }, items: { current: 0, max: 0 } })
  sharp.concurrency = () => 1
  sharp.simd = () => false
  sharp.counters = () => ({ queue: 0, process: 0 })
  sharp.versions = { sharp: '0.34.0', vips: 'canvas', 'sharp-canvas': '0.1.1' }
  sharp.format = {
    jpeg: fmtInfo('jpeg', true, true), png: fmtInfo('png', true, true), webp: fmtInfo('webp', true, true),
    avif: fmtInfo('avif', true, true), gif: fmtInfo('gif', true, false), svg: fmtInfo('svg', true, false),
    heif: fmtInfo('heif', false, false), tiff: fmtInfo('tiff', false, false), raw: fmtInfo('raw', true, true),
  }
  sharp.gravity = { center: 0, centre: 0, north: 1, east: 2, south: 3, west: 4, northeast: 5, southeast: 6, southwest: 7, northwest: 8 }
  sharp.strategy = { entropy: 16, attention: 17 }
  sharp.position = { top: 1, right: 2, bottom: 3, left: 4, 'right top': 5, 'right bottom': 6, 'left bottom': 7, 'left top': 8 }
  sharp.fit = { contain: 'contain', cover: 'cover', fill: 'fill', inside: 'inside', outside: 'outside' }
  sharp.kernel = { nearest: 'nearest', linear: 'linear', cubic: 'cubic', mitchell: 'mitchell', lanczos2: 'lanczos2', lanczos3: 'lanczos3' }
  return sharp
}

export default createCanvasSharp
