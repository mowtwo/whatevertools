// web-host 端到端：起一个演示宿主页（127.0.0.1 是安全上下文，Service Worker 可用），无界面 Chrome 里安装 / 打开 / 拒绝 / 卸载插件
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { packDirectory } = require('@whatevertools/upx/node')
const here = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.dirname(here)
const root = path.resolve(pkgDir, '..', '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-webhost-'))
const profile = path.join(tmp, 'chrome-profile')
let chrome = null
let server = null
const cleanup = () => {
  try { chrome?.kill('SIGKILL') } catch {}
  try { server?.close() } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130) })

const bundle = async (entry, globalName) => (await build({ entryPoints: [entry], bundle: true, format: 'iife', globalName, platform: 'browser', target: 'es2020', write: false, logLevel: 'error' })).outputFiles[0].text

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '✔' : '✖'} [web-host] ${name}${ok ? '' : ` — 期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`}`)
}

try {
  // ---------- Node 侧：运行时、宿主库、插件包 ----------
  const runtime = await bundle(path.join(root, 'packages/web/dist/full.js'), '__whatevertoolsRuntime')
  const hostLib = await bundle(path.join(pkgDir, 'dist/index.js'), 'WtHost')
  const sw = fs.readFileSync(path.join(pkgDir, 'dist/sw.js'), 'utf8')
  const basicDir = path.join(root, 'packages/electron/test/fixtures/basic')
  const electronOnly = path.join(tmp, 'electron-only')
  fs.cpSync(basicDir, electronOnly, { recursive: true })
  fs.writeFileSync(path.join(electronOnly, 'whatevertools.json'), JSON.stringify({ id: 'fixture-electron-only', name: '只给桌面', version: '1.0.0', targets: ['electron'] }))
  const packages = {
    'basic.upx': await packDirectory(basicDir),
    'cjs.upx': await packDirectory(path.join(root, 'packages/web/test/fixtures/cjs')),
    'electron-only.upx': await packDirectory(electronOnly),
    'secret.upxs': new Uint8Array(crypto.randomBytes(8192)),
  }
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>web-host demo</title><script src="/host.js"></script></head>
<body><h1>演示宿主</h1><div id="plugins"></div>
<script>
window.__prompts = []
window.host = WtHost.createWebHost({
  swUrl: '/__wt/sw.js', runtimeUrl: '/runtime.js', container: document.getElementById('plugins'),
  policy: { max: 1 },
  prompt: function (c) { window.__prompts.push(c); return true },
  hooks: function (h) { h.on('plugin:install', { apply: function (ctx, next) { window.__hooked = (window.__hooked || 0) + 1; return next() } }) },
})
window.fetchPkg = async function (name) { return new File([await (await fetch('/pkg/' + name)).arrayBuffer()], name) }
window.tryInstall = async function (name) { try { var r = await host.install(await fetchPkg(name)); return 'ok:' + r.id } catch (e) { return (e.code || 'ERR') + ':' + e.message } }
window.waitFor = async function (fn, ms) { for (var t = 0; t < (ms || 15000); t += 100) { try { var v = fn(); if (v) return v } catch (e) {} await new Promise(function (r) { setTimeout(r, 100) }) } return null }
window.fileKeys = function (prefix) {
  return new Promise(function (ok, bad) {
    var r = indexedDB.open('whatevertools-host:/__wt/')
    r.onsuccess = function () { var q = r.result.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = function () { r.result.close(); ok(q.result.filter(function (k) { return k.indexOf(prefix) === 0 })) }; q.onerror = bad }
    r.onerror = bad
  })
}
</script></body></html>`
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (u === '/' || u === '/index.html') return res.writeHead(200, { 'content-type': types['.html'] }).end(page)
    if (u === '/host.js') return res.writeHead(200, { 'content-type': types['.js'] }).end(hostLib)
    if (u === '/runtime.js') return res.writeHead(200, { 'content-type': types['.js'] }).end(runtime)
    if (u === '/__wt/sw.js') return res.writeHead(200, { 'content-type': types['.js'] }).end(sw)
    if (u.startsWith('/pkg/') && packages[u.slice(5)]) return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from(packages[u.slice(5)]))
    // 插件 URL 应该全部由 Service Worker 处理，走到服务器说明没拦截住
    if (u.startsWith('/__wt/plugins/')) {
      failed++
      console.log(`✖ [web-host] 服务器收到了插件请求 ${u}（应该由 Service Worker 处理）`)
    }
    res.writeHead(404).end()
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const origin = `http://127.0.0.1:${server.address().port}`

  // ---------- 无界面 Chrome ----------
  const port = 9400 + Math.floor(Math.random() * 500)
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let ws
  for (let i = 0; i < 150 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl)
    } catch {}
    if (!ws) await sleep(200)
  }
  if (!ws) throw new Error('无界面 Chrome 没有启动')
  await new Promise((r) => ws.addEventListener('open', r))
  let seq = 0
  const pending = new Map()
  const logs = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 600))
    if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`.slice(0, 600))
    if (m.method === 'Page.javascriptDialogOpening') {
      logs.push(`dialog: ${m.params.message}`.slice(0, 300))
      ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: false } }))
    }
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true, timeout: 60000 })
    if (r.result?.exceptionDetails) return `exception: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`
    return r.result?.result?.value
  }
  await send('Runtime.enable')
  await send('Page.enable')
  // 等宿主页加载完（导航期间的 evaluate 会落在旧页面上）
  const waitHostPage = async () => {
    for (let i = 0; i < 150; i++) {
      if ((await evaluate(`return typeof window.host + '/' + typeof window.waitFor`)) === 'object/function') return
      await sleep(100)
    }
    throw new Error('宿主页没有加载')
  }
  await send('Page.navigate', { url: `${origin}/index.html` })
  await waitHostPage()

  // ---------- 测试 ----------
  check('ready（Service Worker 注册并激活）', await evaluate(`await host.ready; return !!(await navigator.serviceWorker.getRegistration('/__wt/'))?.active`), true)
  check('安装 basic.upx', await evaluate(`return tryInstall('basic.upx')`), 'ok:fixture-basic')
  check('确认界面拿到候选信息 + plugin:install hook', await evaluate(`var c = __prompts[0]; return [c.id, c.name, c.version, c.format, c.source, window.__hooked].join('|')`), 'fixture-basic|夹具插件|1.2.3|upx|basic.upx|1')
  check('list()', await evaluate(`return host.list().map((r) => r.id + '@' + r.version + ':' + r.main)`), ['fixture-basic@1.2.3:index.html'])
  check('open() 在 iframe 里运行：utools / preload / 进入事件', await evaluate(`
    var h = host.open('fixture-basic')
    var w = await waitFor(() => h.iframe.contentWindow.__enters && h.iframe.contentWindow.__enters.length && h.iframe.contentWindow, 30000)
    if (!w) return 'timeout: ' + (h.iframe.contentDocument && h.iframe.contentDocument.body && h.iframe.contentDocument.body.innerText)
    return [typeof w.utools, typeof w.__t, typeof w.__t.fs.readFileSync, w.__t.fs.existsSync('/plugin/plugin.json'), Array.isArray(w.__events), w.__enters[0].code, w.utools.getPath ? 'getPath' : '', h.iframe.parentNode.id, new URL(h.iframe.src).pathname].join('|')`),
    'object|object|function|true|true|main|getPath|plugins|/__wt/plugins/fixture-basic/index.html')
  check('iframe 里读插件文件（Service Worker 提供）', await evaluate(`var w = document.querySelector('iframe').contentWindow; return JSON.parse(w.__t.fs.readFileSync('/plugin/plugin.json', 'utf8')).main + '/' + (await (await w.fetch('logo.png')).headers.get('content-type'))`), 'index.html/image/png')
  check('max:1 拒绝第二个插件', await evaluate(`return tryInstall('cjs.upx')`), 'EWTINSTALL:最多只能安装 1 个插件')
  check('targets 不含 web 的插件被拒绝', await evaluate(`return tryInstall('electron-only.upx')`), 'EWTINSTALL:插件「只给桌面」声明只支持 electron，不能在网页里运行')
  check('upxs 被拒绝', await evaluate(`return (await tryInstall('secret.upxs')).split(':')[0]`), 'EWTENCRYPTED')
  check('同一个插件再装一次是升级（不受数量上限限制，旧一代文件被替换）', await evaluate(`
    var before = (await fileKeys('fixture-basic/')).map((k) => k.split('/')[1])
    var r = await tryInstall('basic.upx')
    var after = (await fileKeys('fixture-basic/')).map((k) => k.split('/')[1])
    return [r, __prompts[__prompts.length - 1].previousVersion, new Set(before).size, new Set(after).size, before[0] !== after[0], host.get('fixture-basic').gen === after[0]].join('|')`), 'ok:fixture-basic|1.2.3|1|1|true|true')
  check('upgrade 后已打开的 iframe 重新加载', await evaluate(`var f = document.querySelector('iframe'); var w = await waitFor(() => f.contentWindow.__enters && f.contentWindow.__enters.length && f.contentWindow, 30000); return !!w && typeof w.utools`), 'object')
  await evaluate(`window.__beforeReload = true`)
  await send('Page.reload')
  for (let i = 0; i < 100 && (await evaluate(`return !!window.__beforeReload`)) !== false; i++) await sleep(100)
  await waitHostPage()
  check('刷新页面后安装记录还在', await evaluate(`await host.ready; return host.list().map((r) => r.id)`), ['fixture-basic'])
  check('刷新后重新打开', await evaluate(`var h = host.open('fixture-basic'); var w = await waitFor(() => h.iframe.contentWindow.__enters && h.iframe.contentWindow.__enters.length && h.iframe.contentWindow, 30000); return !!w && typeof w.__t`), 'object')
  check('uninstall 删除记录、文件和 iframe', await evaluate(`
    await host.uninstall('fixture-basic')
    var n = document.querySelectorAll('iframe').length
    // 宿主页不在作用域里，它自己的 fetch 不经过 Service Worker：用一个作用域内的 iframe 看 Service Worker 的回应
    var probe = document.createElement('iframe')
    probe.src = '/__wt/plugins/fixture-basic/index.html'
    document.body.appendChild(probe)
    var text = await waitFor(() => probe.contentDocument && probe.contentDocument.readyState === 'complete' && probe.contentDocument.body && probe.contentDocument.body.innerText)
    probe.remove()
    return [host.list().length, (await fileKeys('fixture-basic/')).length, n, text].join('|')`), '0|0|0|[whatevertools] 没有安装插件 fixture-basic')
  check('卸载后可以装别的插件；cjs preload（相对文件 / JSON / node_modules）经 Service Worker 运行', await evaluate(`
    var r = await tryInstall('cjs.upx')
    if (r !== 'ok:fixture-cjs') return r
    var h = host.open('fixture-cjs')
    var w = await waitFor(() => h.iframe.contentWindow.__cjs && h.iframe.contentWindow.__enters && h.iframe.contentWindow.__enters.length && h.iframe.contentWindow, 30000)
    if (!w) return 'timeout'
    var c = w.__cjs
    return [c.helper, c.circular, c.data, c.pkg, c.other, c.resolved, typeof w.utools].join('|')`), 'hello web|function/undefined|42|somepkg@1.0.0|other-cjs|/plugin/node_modules/somepkg/lib/main.js|object')
  check('插件存储按 id 隔离（各自的 IndexedDB）', await evaluate(`var names = (await indexedDB.databases()).map((d) => d.name).filter((n) => /^whatevertools-(fs|db):/.test(n)).sort(); return names`), ['whatevertools-db:fixture-basic', 'whatevertools-db:fixture-cjs', 'whatevertools-fs:fixture-basic', 'whatevertools-fs:fixture-cjs'])
  check('uninstall purgeData 清掉插件数据', await evaluate(`await host.uninstall('fixture-cjs', { purgeData: true }); await new Promise((r) => setTimeout(r, 300)); return (await indexedDB.databases()).map((d) => d.name).filter((n) => n.endsWith(':fixture-cjs'))`), [])

  const errs = logs.filter((l) => /^(exception|error|dialog)/.test(l))
  for (const e of errs) {
    failed++
    console.log(`✖ [web-host] 控制台：${e}`)
  }
  ws.close()
} catch (e) {
  failed++
  console.error('✖ [web-host]', e)
} finally {
  cleanup()
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
