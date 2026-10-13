// 逐像素运算。数据都是 canvas 的非预乘 RGBA（Uint8ClampedArray）。
import { clamp255, labToRgb, rgbToLab, type Rgba } from './color'

type Px = Uint8ClampedArray

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

export function grayscale(d: Px) {
  for (let i = 0; i < d.length; i += 4) { const y = luma(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = y }
}

export function negate(d: Px, alpha: boolean) {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]
    if (alpha) d[i + 3] = 255 - d[i + 3]
  }
}

export function linear(d: Px, a: number[], b: number[]) {
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (a[c] ?? a[0]) + (b[c] ?? b[0])
}

export function gamma(d: Px, exp: number) {
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(i / 255, exp)
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]] }
}

export function threshold(d: Px, t: number, grey: boolean) {
  for (let i = 0; i < d.length; i += 4) {
    if (grey) { const v = luma(d[i], d[i + 1], d[i + 2]) >= t ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v }
    else for (let c = 0; c < 3; c++) d[i + c] = d[i + c] >= t ? 255 : 0
  }
}

/** 按百分位拉伸每个颜色通道 */
export function normalise(d: Px, lower: number, upper: number) {
  const n = d.length / 4
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256)
    for (let i = c; i < d.length; i += 4) hist[d[i]]++
    const pick = (p: number) => { let acc = 0; const target = (n * p) / 100; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > target) return v } return 255 }
    const lo = lower <= 0 ? hist.findIndex((x) => x > 0) : pick(lower)
    let hi = 255
    if (upper >= 100) { while (hi > 0 && !hist[hi]) hi-- } else hi = pick(upper)
    if (hi <= lo) continue
    const k = 255 / (hi - lo)
    for (let i = c; i < d.length; i += 4) d[i] = (d[i] - lo) * k
  }
}

/** 在 LCh 空间：亮度乘、饱和度乘、色相转、明度加（和 sharp 一样） */
export function modulate(d: Px, o: { brightness?: number; saturation?: number; hue?: number; lightness?: number }) {
  const br = o.brightness ?? 1, sat = o.saturation ?? 1, hue = ((o.hue ?? 0) * Math.PI) / 180, li = o.lightness ?? 0
  const cos = Math.cos(hue), sin = Math.sin(hue)
  const lab = [0, 0, 0], rgb = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) {
    rgbToLab(d[i], d[i + 1], d[i + 2], lab)
    const a = lab[1] * sat, b = lab[2] * sat
    labToRgb(lab[0] * br + li, a * cos - b * sin, a * sin + b * cos, rgb)
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]
  }
}

/** 保留明度，色度换成 tint 颜色的 a/b */
export function tint(d: Px, c: Rgba) {
  const t = [0, 0, 0], lab = [0, 0, 0], rgb = [0, 0, 0]
  rgbToLab(c.r, c.g, c.b, t)
  for (let i = 0; i < d.length; i += 4) {
    rgbToLab(d[i], d[i + 1], d[i + 2], lab)
    labToRgb(lab[0], t[1], t[2], rgb)
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]
  }
}

/** 预乘后做三遍可分离盒式模糊（近似高斯），边缘取最近像素 */
export function boxBlur(d: Px, w: number, h: number, sigma: number) {
  // 三遍盒式模糊逼近高斯的半径
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1)
  const r = Math.max(1, Math.round((ideal - 1) / 2))
  const f = new Float32Array(d.length)
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3] }
  const tmp = new Float32Array(d.length)
  for (let pass = 0; pass < 3; pass++) { blur1d(f, tmp, w, h, r, true); blur1d(tmp, f, w, h, r, false) }
  for (let i = 0; i < d.length; i += 4) {
    const a = f[i + 3]
    d[i + 3] = a
    if (a > 0) { const k = 255 / a; d[i] = f[i] * k; d[i + 1] = f[i + 1] * k; d[i + 2] = f[i + 2] * k }
  }
}

function blur1d(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horiz: boolean) {
  const len = horiz ? w : h, lines = horiz ? h : w
  const step = horiz ? 4 : w * 4
  const norm = 1 / (2 * r + 1)
  for (let l = 0; l < lines; l++) {
    const base = horiz ? l * w * 4 : l * 4
    for (let c = 0; c < 4; c++) {
      const at = (k: number) => src[base + Math.min(len - 1, Math.max(0, k)) * step + c]
      let acc = 0
      for (let k = -r; k <= r; k++) acc += at(k)
      for (let k = 0; k < len; k++) {
        dst[base + k * step + c] = acc * norm
        acc += at(k + r + 1) - at(k - r)
      }
    }
  }
}

/** 反锐化掩模：orig + amount * (orig - blurred) */
export function sharpen(d: Px, w: number, h: number, sigma: number, amount: number) {
  const blurred = new Uint8ClampedArray(d)
  boxBlur(blurred, w, h, sigma)
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + amount * (d[i + c] - blurred[i + c])
}

export function median(d: Px, w: number, h: number, size: number) {
  const r = Math.max(1, Math.floor(size / 2))
  const src = new Uint8ClampedArray(d)
  const win: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      win.length = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy))
        for (let dx = -r; dx <= r; dx++) win.push(src[(yy * w + Math.min(w - 1, Math.max(0, x + dx))) * 4 + c])
      }
      win.sort((a, b) => a - b)
      d[(y * w + x) * 4 + c] = win[win.length >> 1]
    }
  }
}

/** trim 的保留区域；全图都是背景时返回 undefined */
export function trimBox(d: Px, w: number, h: number, bg: Rgba, thr: number) {
  const br = bg.r, bgc = bg.g, bb = bg.b, ba = clamp255(bg.a * 255)
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const diff = Math.max(Math.abs(d[i] - br), Math.abs(d[i + 1] - bgc), Math.abs(d[i + 2] - bb), Math.abs(d[i + 3] - ba))
    if (diff > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  return x1 < 0 ? undefined : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

export interface ChannelStats { min: number; max: number; sum: number; squaresSum: number; mean: number; stdev: number; minX: number; minY: number; maxX: number; maxY: number }

export function stats(d: Px, w: number, channels: number) {
  const n = d.length / 4
  // 1/2 通道只看 R(灰度) 和 A
  const idx = channels === 1 ? [0] : channels === 2 ? [0, 3] : channels === 3 ? [0, 1, 2] : [0, 1, 2, 3]
  const out: ChannelStats[] = idx.map((c) => {
    let min = 255, max = 0, sum = 0, sq = 0, minI = 0, maxI = 0
    for (let p = 0, i = c; p < n; p++, i += 4) {
      const v = d[i]
      if (v < min) { min = v; minI = p }
      if (v > max) { max = v; maxI = p }
      sum += v; sq += v * v
    }
    const mean = sum / n
    const stdev = n > 1 ? Math.sqrt(Math.max(0, (sq - n * mean * mean) / (n - 1))) : 0
    return { min, max, sum, squaresSum: sq, mean, stdev, minX: minI % w, minY: Math.floor(minI / w), maxX: maxI % w, maxY: Math.floor(maxI / w) }
  })
  let isOpaque = true
  const grey = new Uint32Array(256)
  const bins = new Uint32Array(4096)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 255) isOpaque = false
    grey[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++
    bins[((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)]++
  }
  let entropy = 0
  for (const c of grey) if (c) { const p = c / n; entropy -= p * Math.log2(p) }
  let best = 0
  for (let i = 1; i < 4096; i++) if (bins[i] > bins[best]) best = i
  const dominant = { r: ((best >> 8) << 4) + 8, g: (((best >> 4) & 15) << 4) + 8, b: ((best & 15) << 4) + 8 }
  return { channels: out, isOpaque: channels === 1 || channels === 3 ? true : isOpaque, entropy, sharpness: 0, dominant }
}
