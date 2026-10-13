// 无界面 Chrome 驱动：打开页面，收集控制台和异常，执行表达式，截图（测试用）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const [url, out, ...exprs] = process.argv.slice(2)
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9333 + Math.floor(Math.random() * 500)
// 每次一个全新的配置目录：复用目录时，如果有残留的 Chrome 占着它，新进程会把请求转交过去然后退出
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cdp-'))
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' })
const cleanup = () => {
  try { proc.kill() } catch {}
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300)
}
process.on('exit', () => { try { proc.kill() } catch {} })
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { cleanup(); setTimeout(() => process.exit(1), 400) })
process.on('uncaughtException', (e) => { console.error(e); cleanup(); setTimeout(() => process.exit(1), 400) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
for (let i = 0; i < 150; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break }
  } catch {}
  await sleep(200)
}
if (!ws) throw new Error('无界面 Chrome 没有启动')
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const logs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 400))
  // alert / confirm / prompt 会卡住页面：自动关掉并记下来（测试里出现对话框本身就值得注意）
  if (m.method === 'Page.javascriptDialogOpening') {
    logs.push(`dialog: ${m.params.type}: ${m.params.message}`.slice(0, 400))
    ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: false } }))
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`.slice(0, 600))
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable')
await send('Page.navigate', { url })
await sleep(4000)
const results = {}
for (const ex of exprs) {
  const r = await send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true })
  results[ex] = r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result
}
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(`${out}/shot.png`, Buffer.from(shot.result.data, 'base64'))
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, logs }, null, 2))
ws.close(); cleanup()
setTimeout(() => process.exit(0), 400)
