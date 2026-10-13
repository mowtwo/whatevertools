// 网页版逐页巡检：把插件打成网页，用模拟线上托管（干净地址、目录补斜杠）的静态服务器打开，跑 scripts/sweeps 里的步骤
//   node scripts/sweep-web.mjs [插件 dist 目录] [步骤文件名]，默认快拼图
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dir = path.resolve(process.argv[2] ?? path.join(root, '../utools-quick-union-image/dist'))
const steps = process.argv[3] ?? 'quick-union-image.mjs'
if (!fs.existsSync(dir)) {
  console.log(`跳过：没有 ${dir}`)
  process.exit(0)
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-sweep-web-'))
const r = spawnSync('node', [path.join(root, 'packages/cli/dist/index.js'), 'pack', dir, '--target', 'web', '--out', tmp], { encoding: 'utf8' })
if (r.status !== 0) {
  console.log(r.stdout, r.stderr)
  process.exit(1)
}
const site = path.join(tmp, fs.readdirSync(tmp)[0])
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/app') return res.writeHead(307, { location: '/app/' }).end()
  let f = path.join(site, p.replace(/^\/app/, ''))
  if (!f.startsWith(site)) return res.writeHead(403).end()
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html')
  if (!fs.existsSync(f)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }).end(fs.readFileSync(f))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const code = await new Promise((ok) => {
  const child = spawn('node', [path.join(root, 'scripts/sweep.mjs'), `http://127.0.0.1:${server.address().port}/app`, path.join(root, 'scripts/sweeps', steps)], { stdio: 'inherit' })
  child.on('exit', (c) => ok(c ?? 1))
})
server.close()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(code)
