// uTools preload 桥接层（CommonJS）
// 图片处理统一使用 uTools 内置的 utools.sharp（Sharp v0.35.3）
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

// 加载状态，供前端诊断：undefined = preload 未执行；loading = 执行中途出错；ok = 正常
window.__quickUnionPreload = 'loading'

// Electron 渲染进程 API 用到时再加载，避免单个模块异常导致整个桥接层不可用
function electron() {
  return require('electron')
}

const IMAGE_EXTS = [
  'png', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff',
  'avif', 'heic', 'heif', 'svg', 'ico',
]

let seq = 0
let workDirCache = null

// uTools 环境下 mkdirSync(recursive) 遇到已存在的目录也可能抛 EEXIST，
// 并发导入时尤其明显，所以先判断、再忽略 EEXIST，并缓存结果
function ensureDir(dir) {
  if (fs.existsSync(dir)) return
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    if (!(err && err.code === 'EEXIST')) throw err
  }
}

// utools.getPluginTempPath() 内部会创建目录，并发调用时可能抛 EEXIST：
// 只取一次并缓存；出错时目录其实已存在，重试或直接用错误中的路径
let tempRootCache = null
function tempRoot() {
  if (tempRootCache) return tempRootCache
  for (let i = 0; i < 3 && !tempRootCache; i++) {
    try {
      tempRootCache = utools.getPluginTempPath()
    } catch (err) {
      if (!(err && err.code === 'EEXIST')) throw err
      if (err.path && fs.existsSync(err.path)) tempRootCache = err.path
    }
  }
  if (!tempRootCache) throw new Error('无法获取插件临时目录')
  return tempRootCache
}

function workDir() {
  const dir = path.join(tempRoot(), 'work')
  if (workDirCache !== dir || !fs.existsSync(dir)) {
    ensureDir(dir)
    workDirCache = dir
  }
  return dir
}

function safeName(name) {
  return String(name || 'image').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || 'image'
}

function tempFile(name, ext) {
  seq += 1
  return path.join(workDir(), `${Date.now().toString(36)}-${seq}-${safeName(name)}.${ext}`)
}

function isImagePath(p) {
  const ext = path.extname(p).slice(1).toLowerCase()
  return IMAGE_EXTS.includes(ext)
}

function sharp(input, options) {
  // { create } 这类对象输入不能再额外传入选项
  if (input && typeof input === 'object' && !ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer) && !Array.isArray(input)) {
    return utools.sharp(input)
  }
  return utools.sharp(input, { failOn: 'none', limitInputPixels: false, ...options })
}

function autoOrient(s) {
  return typeof s.autoOrient === 'function' ? s.autoOrient() : s.rotate()
}

async function thumbnail(filePath, size) {
  const buf = await sharp(filePath)
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92, smartSubsample: true })
    .toBuffer()
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

async function describe(pngPath, srcPath, name, thumbSize) {
  const meta = await sharp(pngPath).metadata()
  return {
    path: pngPath,
    srcPath: srcPath || '',
    name,
    width: meta.width,
    height: meta.height,
    thumb: await thumbnail(pngPath, thumbSize || 512),
  }
}

// 将任意输入（路径 / Buffer）规范化为 PNG 工作副本
async function normalizeToPng(input, name) {
  const out = tempFile(name, 'png')
  await autoOrient(sharp(input)).png({ compressionLevel: 3 }).toFile(out)
  return out
}

// ---------- 像素管线：所有编辑操作都在 RGBA raw 上逐步执行，保证顺序确定 ----------

async function toRaw(s) {
  const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, info: { width: info.width, height: info.height, channels: info.channels } }
}

function fromRaw(state) {
  return sharp(state.data, { raw: state.info })
}

function parseColor(c, fallback) {
  if (!c) return fallback
  if (typeof c === 'object') return c
  if (c === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 }
  return c
}

const POS_FACTOR = {
  center: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5],
  'left top': [0, 0], 'right top': [1, 0], 'left bottom': [0, 1], 'right bottom': [1, 1],
}

function clampInt(v, min, max) {
  return Math.max(min, Math.min(max, Math.round(v)))
}

async function applyOp(state, op) {
  const { width: W, height: H } = state.info
  switch (op.type) {
    case 'rotate': {
      const angle = Number(op.angle) || 0
      if (angle % 360 === 0) return state
      return toRaw(fromRaw(state).rotate(angle, { background: parseColor(op.background, { r: 0, g: 0, b: 0, alpha: 0 }) }))
    }
    case 'flip': {
      if (!op.horizontal && !op.vertical) return state
      let s = fromRaw(state)
      if (op.vertical) s = s.flip()
      if (op.horizontal) s = s.flop()
      return toRaw(s)
    }
    case 'crop': {
      // 归一化坐标（0~1）
      const left = clampInt(op.x * W, 0, W - 1)
      const top = clampInt(op.y * H, 0, H - 1)
      const width = clampInt(op.w * W, 1, W - left)
      const height = clampInt(op.h * H, 1, H - top)
      if (left === 0 && top === 0 && width === W && height === H) return state
      return toRaw(fromRaw(state).extract({ left, top, width, height }))
    }
    case 'cropRatio': {
      const ratio = op.ratioW / op.ratioH
      if (!(ratio > 0)) return state
      let width = W
      let height = Math.round(W / ratio)
      if (height > H) {
        height = H
        width = Math.round(H * ratio)
      }
      const [fx, fy] = POS_FACTOR[op.position] || POS_FACTOR.center
      const left = Math.round((W - width) * fx)
      const top = Math.round((H - height) * fy)
      return toRaw(fromRaw(state).extract({ left, top, width: Math.max(1, width), height: Math.max(1, height) }))
    }
    case 'trim': {
      try {
        return await toRaw(fromRaw(state).trim({ threshold: Number(op.threshold) || 10 }))
      } catch {
        return state // 整张图同色时 trim 会报错，保持原图
      }
    }
    case 'resize': {
      let w = null
      let h = null
      const opts = { fit: 'fill' }
      if (op.mode === 'scale') {
        const k = Number(op.scale) || 1
        if (k === 1) return state
        w = Math.max(1, Math.round(W * k))
        h = Math.max(1, Math.round(H * k))
      } else if (op.mode === 'width') {
        w = Math.max(1, Math.round(op.width))
        h = Math.max(1, Math.round((H * w) / W))
      } else if (op.mode === 'height') {
        h = Math.max(1, Math.round(op.height))
        w = Math.max(1, Math.round((W * h) / H))
      } else if (op.mode === 'maxSide') {
        const k = op.size / Math.max(W, H)
        if (k >= 1 && op.onlyShrink) return state
        w = Math.max(1, Math.round(W * k))
        h = Math.max(1, Math.round(H * k))
      } else if (op.mode === 'box') {
        w = Math.max(1, Math.round(op.width))
        h = Math.max(1, Math.round(op.height))
        opts.fit = op.fit || 'cover'
        opts.position = op.position || 'center'
        opts.background = parseColor(op.background, { r: 0, g: 0, b: 0, alpha: 0 })
      } else {
        return state
      }
      if (w === W && h === H && opts.fit === 'fill') return state
      return toRaw(fromRaw(state).resize(w, h, opts))
    }
    default:
      throw new Error(`未知的编辑操作: ${op.type}`)
  }
}

async function runOps(inputPath, ops) {
  let state = await toRaw(sharp(inputPath))
  for (const op of ops || []) state = await applyOp(state, op)
  return state
}

// ---------- 拼接 ----------

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

// 单个格子：背景色 + 按适配方式放置的图片 + 圆角遮罩
async function renderCell(cell) {
  const w = Math.max(1, Math.round(cell.width))
  const h = Math.max(1, Math.round(cell.height))
  const bg = parseColor(cell.background, TRANSPARENT)
  const layers = []
  if (cell.image) {
    if (cell.fit === 'none') {
      // 原始尺寸，按对齐方式放置，超出部分裁掉
      const meta = await sharp(cell.image).metadata()
      const [fx, fy] = POS_FACTOR[cell.position] || POS_FACTOR.center
      const cw = Math.min(meta.width, w)
      const ch = Math.min(meta.height, h)
      const region = await sharp(cell.image)
        .extract({ left: Math.round((meta.width - cw) * fx), top: Math.round((meta.height - ch) * fy), width: cw, height: ch })
        .ensureAlpha()
        .png()
        .toBuffer()
      layers.push({ input: region, left: Math.round((w - cw) * fx), top: Math.round((h - ch) * fy) })
    } else {
      const resized = await sharp(cell.image)
        .ensureAlpha()
        .resize(w, h, { fit: cell.fit || 'cover', position: cell.position || 'center', background: TRANSPARENT })
        .png()
        .toBuffer()
      layers.push({ input: resized, left: 0, top: 0 })
    }
  }
  if (cell.radius > 0) {
    const r = Math.min(cell.radius, w / 2, h / 2)
    layers.push({
      input: Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`),
      blend: 'dest-in',
    })
  }
  const buf = await sharp({ create: { width: w, height: h, channels: 4, background: bg } })
    .composite(layers)
    .png()
    .toBuffer()
  return { input: buf, left: Math.round(cell.left), top: Math.round(cell.top) }
}

async function stitch(job) {
  const width = Math.max(1, Math.round(job.width))
  const height = Math.max(1, Math.round(job.height))
  const overlays = []
  for (const cell of job.cells) {
    const hasBg = cell.background && cell.background !== 'transparent'
    if (cell.image || hasBg) overlays.push(await renderCell(cell))
  }
  const out = tempFile(job.name || 'stitch', 'png')
  await sharp({ create: { width, height, channels: 4, background: parseColor(job.background, '#ffffff') } })
    .composite(overlays)
    .png({ compressionLevel: 6 })
    .toFile(out)
  return describe(out, '', job.name || 'stitch', job.thumbSize)
}

// ---------- 导出 ----------

function uniquePath(p) {
  if (!fs.existsSync(p)) return p
  const dir = path.dirname(p)
  const ext = path.extname(p)
  const base = path.basename(p, ext)
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`)
}

function formatFromExt(p) {
  const ext = path.extname(p).slice(1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  if (ext === 'webp') return 'webp'
  if (ext === 'avif') return 'avif'
  return 'png'
}

async function writeFormat(srcPath, target, format, quality, background) {
  let s = sharp(srcPath)
  const q = Math.max(1, Math.min(100, Number(quality) || 90))
  if (format === 'jpeg') s = s.flatten({ background: background || '#ffffff' }).jpeg({ quality: q, mozjpeg: true })
  else if (format === 'webp') s = s.webp({ quality: q })
  else if (format === 'avif') s = s.avif({ quality: q })
  else s = s.png({ compressionLevel: 9 })
  await s.toFile(target)
  return target
}

const EXT_OF = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif' }

// ---------- 图片信息（供 AI 编排上下文使用） ----------

const infoCache = new Map()

function hex(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
}

// 原始文件读 metadata（格式、透明、帧数、大小），工作副本读 stats（主色、清晰度）
async function imageInfo(workPath, srcPath, withStats) {
  const key = `${workPath}|${withStats ? 1 : 0}`
  if (infoCache.has(key)) return infoCache.get(key)
  const origin = srcPath && fs.existsSync(srcPath) ? srcPath : workPath
  const meta = await sharp(origin).metadata()
  const info = {
    format: meta.format || path.extname(origin).slice(1).toLowerCase(),
    fileSize: fs.statSync(origin).size,
    hasAlpha: !!meta.hasAlpha,
    frames: meta.pages || 1,
    generated: origin === workPath,
  }
  if (withStats) {
    const st = await sharp(workPath).stats()
    info.isOpaque = st.isOpaque
    info.dominantColor = `#${hex(st.dominant.r)}${hex(st.dominant.g)}${hex(st.dominant.b)}`
    info.sharpness = Math.round(st.sharpness * 100) / 100
    info.brightness = Math.round(st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / Math.min(3, st.channels.length))
  }
  infoCache.set(key, info)
  return info
}

window.services = {
  imageExtensions: IMAGE_EXTS,

  // 界面缩放（整页缩放，坐标与布局保持一致）
  getZoomFactor() {
    return electron().webFrame.getZoomFactor()
  },

  setZoomFactor(factor) {
    electron().webFrame.setZoomFactor(Math.max(0.8, Math.min(2, Number(factor) || 1)))
  },

  isImagePath,

  getPathForFile(file) {
    return electron().webUtils.getPathForFile(file)
  },

  // 展开文件 / 文件夹为图片路径列表（文件夹按文件名自然排序）
  expandPaths(paths, recursive) {
    const result = []
    const walk = (dir, depth) => {
      let entries = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (recursive && depth < 8) walk(full, depth + 1)
        } else if (isImagePath(full)) {
          result.push(full)
        }
      }
    }
    for (const p of paths) {
      let stat
      try {
        stat = fs.statSync(p)
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(p, 0)
      else if (isImagePath(p)) result.push(p)
    }
    return result
  },

  // 导入单张图片：sharp 解码 → 失败时用 Electron nativeImage → 仍失败则交给前端用浏览器解码
  async importFile(filePath, thumbSize) {
    const name = path.basename(filePath, path.extname(filePath))
    let pngPath = null
    try {
      pngPath = await normalizeToPng(filePath, name)
    } catch (err) {
      const img = electron().nativeImage.createFromPath(filePath)
      if (!img.isEmpty()) {
        pngPath = await normalizeToPng(img.toPNG(), name)
      } else {
        return { needsBrowserDecode: true, srcPath: filePath, name, error: String(err && err.message) }
      }
    }
    return describe(pngPath, filePath, name, thumbSize)
  },

  async importBytes(bytes, name, thumbSize) {
    const pngPath = await normalizeToPng(Buffer.from(bytes), name)
    return describe(pngPath, '', name, thumbSize)
  },

  async importDataUrl(dataUrl, name, thumbSize) {
    const base64 = String(dataUrl).replace(/^data:[^,]*,/, '')
    const pngPath = await normalizeToPng(Buffer.from(base64, 'base64'), name || 'pasted')
    return describe(pngPath, '', name || 'pasted', thumbSize)
  },

  // 能否读取（macOS 沙盒应用的私有目录会 EPERM）；目录视为可读
  canRead(p) {
    try {
      if (fs.statSync(p).isDirectory()) return true
      fs.closeSync(fs.openSync(p, 'r'))
      return true
    } catch {
      return false
    }
  },

  // 剪贴板中的位图（截图、微信等沙盒应用复制的图片）；没有时返回 null
  readClipboardImage() {
    const img = electron().clipboard.readImage()
    if (!img || img.isEmpty()) return null
    const buf = img.toPNG()
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  },

  async readFileBytes(filePath) {
    const buf = await fsp.readFile(filePath)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  },

  async thumbnail(filePath, size) {
    return thumbnail(filePath, size)
  },

  // 编辑预览：返回限制尺寸的结果图
  async previewOps(filePath, ops, maxSize) {
    const state = await runOps(filePath, ops)
    const buf = await fromRaw(state)
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 92, smartSubsample: true })
      .toBuffer()
    return {
      width: state.info.width,
      height: state.info.height,
      bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    }
  },

  async applyOps(filePath, ops, name, thumbSize) {
    const state = await runOps(filePath, ops)
    const out = tempFile(name, 'png')
    await fromRaw(state).png({ compressionLevel: 3 }).toFile(out)
    return describe(out, '', name, thumbSize)
  },

  stitch,

  imageInfo,

  // 导出到指定完整路径（格式由扩展名决定）
  async exportTo(srcPath, targetPath, quality) {
    const target = targetPath
    ensureDir(path.dirname(target))
    return writeFormat(srcPath, target, formatFromExt(target), quality)
  },

  // 导出到目录，自动避免重名
  async exportToDir(srcPath, dir, baseName, format, quality) {
    ensureDir(dir)
    const fmt = EXT_OF[format] ? format : 'png'
    const target = uniquePath(path.join(dir, `${safeName(baseName)}.${EXT_OF[fmt]}`))
    return writeFormat(srcPath, target, fmt, quality)
  },

  dirname(p) {
    return path.dirname(p)
  },

  basename(p, withExt) {
    return withExt ? path.basename(p) : path.basename(p, path.extname(p))
  },

  join(...parts) {
    return path.join(...parts)
  },

  exists(p) {
    return fs.existsSync(p)
  },
}

// MCP 工具（声明见 plugin.json 的 tools）：在插件初始化时注册，AI Agent 调用时不依赖主界面。
// 模块由 src/mcp 构建而来；单独 try，注册失败不影响插件本身
try {
  if (typeof utools.registerTool === 'function') require('./mcp-tools.js').registerMcpTools(utools)
} catch (err) {
  console.error('[快拼图] MCP 工具注册失败', err)
}

window.__quickUnionPreload = 'ok'
