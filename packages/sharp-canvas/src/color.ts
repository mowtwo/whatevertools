// 颜色解析和 sRGB <-> Lab 换算（modulate / tint 用）。
import { newCanvas, ctxOf } from './canvas'

export interface Rgba { r: number; g: number; b: number; a: number }
export type ColorInput = string | { r?: number; g?: number; b?: number; alpha?: number } | undefined | null

const cache = new Map<string, Rgba>()

/** CSS 字符串（'#fff'、'transparent'、'rgba(...)'）或 {r,g,b,alpha}（alpha 0..1） */
export function parseColor(c: ColorInput, fallback: Rgba = { r: 0, g: 0, b: 0, a: 1 }): Rgba {
  if (c == null) return fallback
  if (typeof c === 'object') {
    return { r: clamp255(c.r ?? 0), g: clamp255(c.g ?? 0), b: clamp255(c.b ?? 0), a: c.alpha == null ? 1 : Math.min(1, Math.max(0, +c.alpha)) }
  }
  const key = String(c).trim().toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit
  let out = fallback
  if (key === 'transparent') out = { r: 0, g: 0, b: 0, a: 0 }
  else {
    // 交给 canvas 解析，读回规范化后的 fillStyle
    const ctx = ctxOf(newCanvas(1, 1))
    ctx.fillStyle = '#010203'
    ctx.fillStyle = key
    const s = String(ctx.fillStyle)
    if (s !== '#010203' || key === '#010203') {
      const m = /^#([0-9a-f]{6})$/i.exec(s)
      if (m) {
        const n = parseInt(m[1], 16)
        out = { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }
      } else {
        const p = /rgba?\(([^)]+)\)/.exec(s)
        if (p) {
          const v = p[1].split(/[\s,/]+/).filter(Boolean).map(Number)
          out = { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }
        }
      }
    }
  }
  cache.set(key, out)
  return out
}

export const cssOf = (c: Rgba) => `rgba(${c.r},${c.g},${c.b},${c.a})`
export const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

const LIN = new Float64Array(256)
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
const toSrgb = (v: number) => clamp255(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055))
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
const finv = (t: number) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787 }

/** sRGB 0..255 -> Lab，结果写到 out[0..2] */
export function rgbToLab(r: number, g: number, b: number, out: number[]) {
  const R = LIN[r], G = LIN[g], B = LIN[b]
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047)
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B)
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883)
  out[0] = 116 * y - 16; out[1] = 500 * (x - y); out[2] = 200 * (y - z)
}

/** Lab -> sRGB 0..255，结果写到 out[0..2] */
export function labToRgb(L: number, a: number, b: number, out: number[]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200
  const X = 0.95047 * finv(fx), Y = finv(fy), Z = 1.08883 * finv(fz)
  out[0] = toSrgb(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z)
  out[1] = toSrgb(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z)
  out[2] = toSrgb(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z)
}
