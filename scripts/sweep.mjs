// 逐页巡检：在无界面 Chrome 里打开页面，按步骤点击（每步一段页面里执行的表达式），
// 记录每一步新出现的控制台错误、未捕获异常、未处理的 Promise 拒绝和 4xx / 5xx 请求；有问题时退出码 1。
//   node scripts/sweep.mjs <网址> <步骤文件.mjs> [--width 1280] [--dark]
// 步骤文件：export default [{ name, run: '页面里的表达式（可以 async）', wait?: 毫秒, expect?: '返回 true 才算通过的表达式' }]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const [url, stepsFile] = args
const width = Number(args[args.indexOf('--width') + 1]) || 1280
const dark = args.includes('--dark')
const steps = (await import(pathToFileURL(path.resolve(stepsFile)).href)).default

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-sweep-'))
const port = 9900 + Math.floor(Math.random() * 90)
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
let exiting = false
const quit = (code) => {
  if (exiting) return
  exiting = true
  try { chrome.kill() } catch {}
  // Chrome 有时不理 SIGTERM：等一下还在就强制结束
  setTimeout(() => {
    if (chrome.exitCode === null) try { chrome.kill('SIGKILL') } catch {}
    setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(code) }, 200)
  }, 600)
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => quit(1))
const watchdog = setTimeout(() => { console.error('✗ 超时'); quit(1) }, 180000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ws
for (let i = 0; i < 150 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl)
      ws.opened = new Promise((r) => ws.addEventListener('open', r))
    }
  } catch {}
  if (!ws) await sleep(100)
}
if (!ws) { console.error('✗ Chrome 没有启动'); quit(1) }
await ws.opened

let id = 0
const pending = new Map()
let events = []
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  const p = m.params
  if (m.method === 'Runtime.exceptionThrown') events.push(`异常：${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`.slice(0, 500))
  if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) events.push(`console.error：${p.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 500))
  if (m.method === 'Network.responseReceived' && p.response.status >= 400) events.push(`HTTP ${p.response.status}：${p.response.url}`)
  if (m.method === 'Network.loadingFailed' && !p.canceled) events.push(`请求失败：${p.errorText} ${p.type}`)
  if (m.method === 'Page.javascriptDialogOpening') {
    events.push(`弹出了浏览器对话框（${p.type}）：${p.message}`)
    ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: false } }))
  }
})
await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: 1, mobile: width < 600 })
if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
// 页面里未处理的 Promise 拒绝也算问题
await send('Page.addScriptToEvaluateOnNewDocument', { source: "addEventListener('unhandledrejection', (e) => console.error('未处理的 Promise 拒绝：' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)))" })

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
  return r.result?.result?.value
}

let failed = 0
await send('Page.navigate', { url })
// 等页面渲染出来（可能先经过一次跳转）：最多 20 秒
const readyExpr = steps.ready ?? "document.readyState === 'complete' && document.querySelectorAll('button, a, input').length > 0"
for (let i = 0; i < 80; i++) {
  await sleep(250)
  try { if (await evaluate(readyExpr)) break } catch {}
}
await sleep(800)
const report = (name, extra = []) => {
  const all = [...events, ...extra]
  events = []
  if (all.length) failed++
  console.log(`${all.length ? '✗' : '✔'} ${name}${all.map((x) => `\n    ${x}`).join('')}`)
}
report('打开页面')
for (const s of steps) {
  const extra = []
  try {
    await evaluate(`(async () => { ${s.run} })()`)
    await sleep(s.wait ?? 1200)
    if (s.expect) {
      const ok = await evaluate(`(async () => (${s.expect}))()`)
      if (ok !== true) extra.push(`检查没通过：${s.expect}（得到 ${JSON.stringify(ok)}）`)
    }
  } catch (e) {
    extra.push(`步骤执行出错：${e.message}`)
  }
  report(s.name, extra)
}
clearTimeout(watchdog)
console.log(failed ? `\n${failed} 步有问题` : '\n全部通过')
ws.close()
quit(failed ? 1 : 0)
