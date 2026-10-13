// web 目标端到端测试：用夹具插件打 web 包，起静态服务器，在无界面 Chrome 里检查
import { spawnSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-web-'))
const fixture = path.join(root, 'packages', 'electron', 'test', 'fixtures', 'basic')
const r = spawnSync('node', [path.join(root, 'packages/cli/dist/index.js'), 'pack', fixture, '--target', 'web', '--out', out, '--name', 'acme'], { encoding: 'utf8' })
if (r.status !== 0) {
  console.log(r.stdout, r.stderr)
  process.exit(1)
}
const site = path.join(out, fs.readdirSync(out)[0])
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }
const server = http.createServer((req, res) => {
  const p = path.join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!p.startsWith(site) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }).end(fs.readFileSync(p))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const url = `http://127.0.0.1:${server.address().port}/index.html`
const checks = {
  '注入名 / 兼容层': "typeof acme + '/' + typeof utools",
  '身份': "acme.identity.runtime.name + '/' + acme.identity.plugin.id + '/' + acme.identity.plugin.version",
  '页面脚本收到进入事件': "JSON.stringify(window.__enters.map((a) => a.code + ':' + a.from))",
  'preload 在浏览器里执行（fs 垫片）': "typeof __t.fs.readFileSync + '/' + __t.fs.existsSync('/plugin/plugin.json')",
  '读插件自带文件': "JSON.parse(__t.fs.readFileSync('/plugin/plugin.json', 'utf8')).main",
  'dbStorage': "(utools.dbStorage.setItem('k', { a: 1 }), JSON.stringify(utools.dbStorage.getItem('k')))",
  'supports 反映实际': "[acme.supports('sharp'), acme.supports('ubrowser'), acme.supports('db.put')].join('/')",
}
// 必须异步启动：同步等待会阻塞事件循环，静态服务器就响应不了页面请求
await new Promise((ok) => {
  const child = spawn('node', [path.join(root, 'scripts/cdp.mjs'), url, out, ...Object.values(checks)], { stdio: 'inherit' })
  const timer = setTimeout(() => child.kill(), 60000)
  child.on('exit', () => (clearTimeout(timer), ok()))
})
server.close()
const data = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
const expect = {
  '注入名 / 兼容层': 'object/object',
  '身份': 'acme/fixture-basic/1.2.3',
  '页面脚本收到进入事件': '["main:main"]',
  'preload 在浏览器里执行（fs 垫片）': 'function/true',
  '读插件自带文件': 'index.html',
  'dbStorage': '{"a":1}',
  'supports 反映实际': 'false/false/emulated',
}
let failed = 0
for (const [name, expr] of Object.entries(checks)) {
  const got = data.results[expr]
  const ok = got === expect[name]
  if (!ok) failed++
  console.log(`${ok ? '✔' : '✖'} [web] ${name}${ok ? '' : ` — 期望 ${expect[name]}，实际 ${JSON.stringify(got)}`}`)
}
const errs = data.logs.filter((l) => /^(exception|error)/.test(l))
for (const e of errs) {
  failed++
  console.log(`✖ [web] 控制台：${e}`)
}
fs.rmSync(out, { recursive: true, force: true })
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
