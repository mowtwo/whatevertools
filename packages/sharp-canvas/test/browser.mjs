// 真浏览器测试：esbuild 打包成 IIFE，本地起 http 页面，无界面 Chrome 通过 DevTools 协议跑断言。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const here = path.dirname(fileURLToPath(import.meta.url))
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 页面里执行的用例（整段 toString 后送进浏览器） ----
async function cases() {
  const files = new Map()
  const io = {
    readFile: (p) => { if (!files.has(p)) throw new Error('ENOENT ' + p); return files.get(p) },
    writeFile: (p, d) => { files.set(p, d) },
    Buffer: { from: (u8) => { const b = new Uint8Array(u8); b.isShimBuffer = true; return b } },
  }
  const sharp = window.SharpCanvas.createCanvasSharp(io)
  const results = []
  const t = async (name, fn) => {
    try { const r = await fn(); results.push({ name, ok: r === true, detail: r === true ? '' : JSON.stringify(r) }) }
    catch (e) { results.push({ name, ok: false, detail: String(e && e.stack || e) }) }
  }
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) || { got: a, want: b }
  const near = (a, b, tol = 3) => (a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol)) || { got: a, want: b }
  const hex = (u, n) => Array.from(u.slice(0, n), (x) => x.toString(16).padStart(2, '0')).join('')
  const at = (r, x, y) => { const n = r.info.channels, i = (y * r.info.width + x) * n; return Array.from(r.data.slice(i, i + n)) }
  const rawOf = (s) => s.raw().toBuffer({ resolveWithObject: true })
  const create = (width, height, background, channels = 4) => sharp({ create: { width, height, channels, background } })
  const svgMask = (w, h, rx) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="#000"/></svg>`)
  // 2x2：左上红、右上绿、左下蓝、右下白
  const quad = () => sharp(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), { raw: { width: 2, height: 2, channels: 3 } })

  await t('create + png 往返 + metadata', async () => {
    const png = await create(40, 30, '#ff0000').png().toBuffer()
    const m = await sharp(png).metadata()
    return eq([hex(png, 4), m.format, m.width, m.height, m.hasAlpha, m.channels, m.space, m.size === png.length], ['89504e47', 'png', 40, 30, true, 4, 'srgb', true])
  })
  await t('输出经过 io.Buffer.from 包装', async () => (await create(4, 4, 'red').png().toBuffer()).isShimBuffer === true)
  await t('toBuffer 可重复调用，callback 风格可用', async () => {
    const s = create(10, 10, 'blue').resize(5, 5).png()
    const a = await s.toBuffer(), b = await s.toBuffer()
    const viaCb = await new Promise((res, rej) => s.toBuffer((e, d, info) => (e ? rej(e) : res([d.length, info.width]))))
    return eq([a.length === b.length, viaCb], [true, [a.length, 5]])
  })
  await t('resize cover / contain / inside / outside / 只给宽', async () => {
    const base = () => create(200, 100, '#ff0000', 3)
    const dims = async (s) => { const { info } = await s.png().toBuffer({ resolveWithObject: true }); return [info.width, info.height] }
    return eq([
      await dims(base().resize(50, 50)),
      await dims(base().resize(50, 50, { fit: 'contain' })),
      await dims(base().resize({ width: 50, height: 50, fit: 'inside' })),
      await dims(base().resize(50, 50, { fit: 'outside' })),
      await dims(base().resize(100)),
      await dims(base().resize(400, 400, { fit: 'inside', withoutEnlargement: true })),
      await dims(create(2000, 1000, 'red', 3).resize(30, 30, { position: 'right top' })),
    ], [[50, 50], [50, 50], [50, 25], [100, 50], [100, 50], [200, 100], [30, 30]])
  })
  await t('resize contain 用背景填充', async () => {
    const r = await rawOf(create(200, 100, '#ff0000', 3).resize(50, 50, { fit: 'contain', background: { r: 0, g: 0, b: 255, alpha: 1 } }))
    return near([...at(r, 0, 0), ...at(r, 25, 25)], [0, 0, 255, 255, 0, 0])
  })
  await t('extend', async () => {
    const a = await create(20, 10, 'red', 3).extend(5).png().toBuffer({ resolveWithObject: true })
    const b = await rawOf(create(20, 10, 'red', 3).extend({ top: 1, left: 2, background: 'transparent' }))
    return eq([a.info.width, a.info.height, a.info.channels, b.info.width, b.info.height, b.info.channels, at(b, 0, 0)[3], at(b, 2, 1)], [30, 20, 3, 22, 11, 4, 0, [255, 0, 0, 255]])
  })
  await t('extract + 越界报错', async () => {
    const { info } = await create(50, 40, 'red').extract({ left: 10, top: 10, width: 20, height: 5 }).png().toBuffer({ resolveWithObject: true })
    let msg = ''
    try { await create(50, 40, 'red').extract({ left: 40, top: 0, width: 20, height: 5 }).png().toBuffer() } catch (e) { msg = e.message }
    return eq([info.width, info.height, msg], [20, 5, 'extract_area: bad extract area'])
  })
  await t('rotate 90 / 45 尺寸', async () => {
    const a = await create(200, 100, 'red', 3).rotate(90).png().toBuffer({ resolveWithObject: true })
    const b = await rawOf(create(200, 100, 'red', 3).rotate(45))
    return eq([a.info.width, a.info.height, b.info.width, b.info.height, b.info.channels, at(b, 0, 0)], [100, 200, 212, 212, 3, [0, 0, 0]])
  })
  await t('flip / flop / rotate 像素位置', async () => {
    const flop = await rawOf(quad().flop()), flip = await rawOf(quad().flip()), rot = await rawOf(quad().rotate(90))
    return eq([at(flop, 0, 0), at(flip, 0, 0), at(rot, 0, 0), at(rot, 1, 0)], [[0, 255, 0], [0, 0, 255], [0, 0, 255], [255, 0, 0]])
  })
  await t('composite over', async () => {
    const r = await rawOf(create(100, 100, '#ffffff', 3).composite([{ input: { create: { width: 20, height: 20, channels: 4, background: 'red' } }, top: 0, left: 0 }]))
    const g = await rawOf(create(100, 100, '#ffffff', 3).composite([{ input: { create: { width: 20, height: 20, channels: 3, background: 'blue' } }, gravity: 'southeast' }]))
    return eq([at(r, 5, 5), at(r, 50, 50), r.info.channels, at(g, 95, 95), at(g, 50, 50)], [[255, 0, 0], [255, 255, 255], 3, [0, 0, 255], [255, 255, 255]])
  })
  await t('composite dest-in + SVG 圆角遮罩：角变透明', async () => {
    const r = await rawOf(create(100, 100, '#ffffff', 3).composite([{ input: svgMask(100, 100, 30), blend: 'dest-in' }]))
    return eq([r.info.channels, at(r, 0, 0)[3], at(r, 50, 50), at(r, 99, 99)[3]], [4, 0, [255, 255, 255, 255], 0])
  })
  await t('没写 xmlns 的 svg 也能解码（librsvg 允许，浏览器不允许）', async () => {
    const bare = new TextEncoder().encode('<svg width="40" height="20"><rect x="0" y="0" width="40" height="20" rx="10" ry="10" fill="#fff"/></svg>')
    const m = await sharp(bare).metadata()
    const r = await rawOf(create(40, 20, '#ff0000', 3).composite([{ input: bare, blend: 'dest-in' }]))
    return eq([m.format, m.width, m.height, at(r, 0, 0)[3], at(r, 20, 10)], ['svg', 40, 20, 0, [255, 0, 0, 255]])
  })
  await t('composite in：覆盖层外视为透明', async () => {
    const r = await rawOf(create(100, 100, '#ffffff').composite([{ input: { create: { width: 10, height: 10, channels: 4, background: 'red' } }, top: 0, left: 0, blend: 'in' }]))
    return eq([at(r, 5, 5), at(r, 50, 50)[3]], [[255, 0, 0, 255], 0])
  })
  await t('trim 偏移', async () => {
    const png = await create(50, 50, '#ffffff', 3).composite([{ input: { create: { width: 10, height: 10, channels: 3, background: 'red' } }, left: 20, top: 15 }]).png().toBuffer()
    const { info } = await sharp(png).trim().png().toBuffer({ resolveWithObject: true })
    return eq([info.width, info.height, info.trimOffsetLeft, info.trimOffsetTop], [10, 10, -20, -15])
  })
  await t('flatten 去掉 alpha', async () => {
    const r = await rawOf(create(10, 10, { r: 255, g: 0, b: 0, alpha: 0.5 }).flatten({ background: '#ffffff' }))
    return eq([r.info.channels, r.data.length, near(at(r, 3, 3), [255, 128, 128])], [3, 300, true])
  })
  await t('ensureAlpha().raw() 长度 = w*h*4；removeAlpha = w*h*3', async () => {
    const a = await create(7, 5, 'red', 3).ensureAlpha().raw().toBuffer()
    const b = await create(7, 5, 'red', 4).removeAlpha().raw().toBuffer()
    const c = await rawOf(create(7, 5, 'red', 3).ensureAlpha(0.5))
    return eq([a.length, b.length, at(c, 0, 0)[3]], [140, 105, 128])
  })
  await t('stats isOpaque / mean / dominant', async () => {
    const a = await create(10, 10, '#ff8000', 3).stats()
    const b = await create(10, 10, 'rgba(0,0,0,0.5)').stats()
    return eq([a.isOpaque, a.channels.length, a.channels[0].mean, a.channels[1].mean, a.dominant, b.isOpaque, b.channels.length], [true, 3, 255, 128, { r: 248, g: 136, b: 8 }, false, 4])
  })
  await t('jpeg / webp 编码魔数 + jpeg metadata', async () => {
    const j = await create(16, 16, 'red', 3).jpeg({ quality: 90 }).toBuffer()
    const w = await create(16, 16, 'red').webp({ quality: 80 }).toBuffer()
    const wl = await create(16, 16, 'red').toFormat('webp', { lossless: true }).toBuffer()
    const m = await sharp(j).metadata()
    return eq([hex(j, 3), hex(w, 4), String.fromCharCode(...w.slice(8, 12)), String.fromCharCode(...wl.slice(8, 12)), m.format, m.hasAlpha, m.channels], ['ffd8ff', '52494646', 'WEBP', 'WEBP', 'jpeg', false, 3])
  })
  await t('avif：能编码或抛 EWTUNSUPPORTED', async () => {
    try {
      const a = await create(16, 16, 'red').avif().toBuffer()
      return String.fromCharCode(...a.slice(4, 12)) === 'ftypavif' || { magic: String.fromCharCode(...a.slice(4, 12)) }
    } catch (e) {
      return (e.code === 'EWTUNSUPPORTED' && /AVIF/.test(e.message)) || { code: e.code, message: e.message }
    }
  })
  await t('jpeg EXIF 方向：metadata.orientation + rotate() 自动摆正', async () => {
    // 左半红、右半蓝；方向 6 摆正 = 顺时针转 90°，红色到上方
    const j = await create(40, 20, 'red', 3).composite([{ input: { create: { width: 20, height: 20, channels: 3, background: 'blue' } }, left: 20, top: 0 }]).jpeg({ quality: 95 }).toBuffer()
    // 在 SOI 后插一个只含 Orientation=6 的 APP1
    const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
    const buf = new Uint8Array([...j.slice(0, 2), ...app1, ...j.slice(2)])
    const m = await sharp(buf).metadata()
    const plain = await rawOf(sharp(buf)), auto = await rawOf(sharp(buf).rotate()), auto2 = await rawOf(sharp(buf).autoOrient())
    const red = (p) => p[0] > 200 && p[2] < 60
    return eq([m.orientation, m.width, m.height, m.autoOrient, [plain.info.width, plain.info.height], [auto.info.width, auto.info.height], red(at(plain, 2, 10)), red(at(auto, 10, 2)), red(at(auto, 10, 37)), red(at(auto2, 10, 2))],
      [6, 40, 20, { width: 20, height: 40 }, [40, 20], [20, 40], true, true, false, true])
  })
  await t('toFile 走 io.writeFile，再按路径读回', async () => {
    const info = await create(12, 8, 'green').toFile('/out/a.webp')
    const m = await sharp('/out/a.webp').metadata()
    let msg = ''
    try { await sharp('/nope.png').metadata() } catch (e) { msg = e.message }
    return eq([info.format, info.width, files.has('/out/a.webp'), m.format, m.width, m.height, msg], ['webp', 12, true, 'webp', 12, 8, 'Input file is missing: /nope.png'])
  })
  await t('raw 输入（3 通道 / 1 通道）', async () => {
    const png = await quad().png().toBuffer()
    const r = await rawOf(sharp(png))
    const g = await rawOf(sharp(new Uint8Array([0, 100, 200, 255]), { raw: { width: 2, height: 2, channels: 1 } }))
    return eq([r.info.channels, at(r, 0, 0), at(r, 1, 1), g.info.channels, Array.from(g.data)], [4, [255, 0, 0, 255], [255, 255, 255, 255], 1, [0, 100, 200, 255]])
  })
  await t('坏输入报错', async () => {
    let msg = ''
    try { await sharp(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).toBuffer() } catch (e) { msg = e.message }
    return eq(msg, 'Input buffer contains unsupported image format')
  })
  await t('SVG 输入 + density', async () => {
    const m = await sharp(svgMask(30, 20, 5)).metadata()
    const { info } = await sharp(svgMask(30, 20, 5), { density: 144 }).png().toBuffer({ resolveWithObject: true })
    return eq([m.format, m.width, m.height, m.density, info.width, info.height], ['svg', 30, 20, 72, 60, 40])
  })
  await t('grayscale / negate / modulate / tint / blur / threshold / normalise', async () => {
    const g = await rawOf(create(4, 4, '#ff0000', 3).grayscale())
    const n = await rawOf(create(4, 4, '#ff0000', 3).negate())
    const m = await rawOf(create(4, 4, '#808080', 3).modulate({ brightness: 2 }))
    const ti = await rawOf(create(4, 4, '#808080', 3).tint('#ff0000'))
    const b = await rawOf(quad().resize(20, 20, { kernel: 'nearest' }).blur(2))
    const th = await rawOf(create(4, 4, '#ffffff', 3).threshold(128))
    const no = await rawOf(sharp(new Uint8Array([50, 50, 50, 100, 100, 100]), { raw: { width: 2, height: 1, channels: 3 } }).normalise())
    return eq([g.info.channels, near(at(g, 0, 0), [54]), at(n, 0, 0), at(m, 0, 0)[0] > 200, ti.data[0] > ti.data[1], b.info.width, at(b, 10, 10).some((v, i) => v !== [255, 0, 0][i]), th.info.channels, at(th, 0, 0), at(no, 0, 0), at(no, 1, 0)],
      [1, true, [0, 255, 255], true, true, 20, true, 1, [255], [0, 0, 0], [255, 255, 255]])
  })
  await t('静态方法', async () => eq([typeof sharp.cache(), sharp.concurrency(), sharp.simd(), !!sharp.versions.sharp, sharp.format.png.output.buffer, sharp.gravity.northeast], ['object', 1, false, true, true, 5]))
  return results
}

// ---- 打包、起服务、驱动 Chrome ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sharp-canvas-'))
let chrome, server, ws
let failed = 0
try {
  const bundle = await esbuild.build({
    entryPoints: [path.join(here, '../src/index.ts')], bundle: true, format: 'iife', globalName: 'SharpCanvas',
    platform: 'browser', target: 'es2022', write: false, logLevel: 'silent',
  })
  const js = bundle.outputFiles[0].text
  const html = '<!doctype html><meta charset="utf-8"><title>sharp-canvas</title><script src="/bundle.js"></script>'
  server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(js) }
    else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html) }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/`

  const port = 9333 + Math.floor(Math.random() * 2000)
  chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(tmp, 'profile')}`, 'about:blank'], { stdio: 'ignore' })
  for (let i = 0; i < 75 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((x) => x.type === 'page')
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl)
    } catch {}
    if (!ws) await sleep(200)
  }
  if (!ws) throw new Error('Chrome DevTools 端口没起来')
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j) })
  let id = 0
  const pending = new Map(), waiters = new Map(), logs = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method && waiters.has(m.method)) { waiters.get(m.method)(m); waiters.delete(m.method) }
    if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const once = (method) => new Promise((r) => waiters.set(method, r))
  await send('Runtime.enable'); await send('Page.enable')
  const loaded = once('Page.loadEventFired')
  await send('Page.navigate', { url })
  await loaded
  const r = await send('Runtime.evaluate', { expression: `(${cases.toString()})()`, awaitPromise: true, returnByValue: true })
  const results = r.result?.result?.value
  if (!Array.isArray(results)) throw new Error('页面执行失败: ' + JSON.stringify(r.result?.exceptionDetails ?? r) + '\n' + logs.join('\n'))
  for (const x of results) {
    if (!x.ok) failed++
    console.log(`${x.ok ? '✔' : '✗'} ${x.name}${x.ok ? '' : '\n    ' + x.detail}`)
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`)
} catch (e) {
  failed++
  console.error('✗', e?.stack ?? e)
} finally {
  try { ws?.close() } catch {}
  server?.close()
  if (chrome) { chrome.kill(); await new Promise((r) => { chrome.once('exit', r); setTimeout(r, 2000) }) }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
process.exit(failed ? 1 : 0)
