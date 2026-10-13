// Vite 插件端到端：vite build 写描述文件并打包三个目标；vite dev 在无界面 Chrome 里模拟插件环境
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const require = createRequire(import.meta.url)
const whatevertools = require('../dist/index.js')
const { build, createServer } = await import(require.resolve('vite', { paths: [path.resolve(here, '..')] }))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-vite-'))
const fixture = path.join(tmp, 'fixture')
fs.cpSync(path.join(here, 'fixture'), fixture, { recursive: true })

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✗'} [vite] ${name}${ok ? '' : `\n  ${detail}`}`)
  if (!ok) failed++
}

try {
  // ---------- build ----------
  await build({
    root: fixture, logLevel: 'silent', configFile: false,
    plugins: [whatevertools({ targets: ['utools', 'web'], name: 'acme', manifest: { id: 'vite-fixture', name: 'Vite 示例', targets: ['utools', 'web', 'electron'] } })],
  })
  const wt = JSON.parse(fs.readFileSync(path.join(fixture, 'dist/whatevertools.json'), 'utf8'))
  check('build：whatevertools.json 写进产物，版本取 package.json', wt.id === 'vite-fixture' && wt.version === '0.3.0', JSON.stringify(wt))
  check('build：utools 目标', fs.existsSync(path.join(fixture, 'release/utools/plugin.json')))
  const web = path.join(fixture, 'release/web/acme-vite-fixture')
  check('build：web 目标', fs.existsSync(path.join(web, 'acme-runtime.js')) && fs.existsSync(path.join(web, 'acme-preload/preload.js')), fs.readdirSync(path.join(fixture, 'release/web')).join(','))

  // ---------- dev ----------
  const server = await createServer({ root: fixture, logLevel: 'silent', configFile: false, server: { port: 0, host: '127.0.0.1' }, plugins: [whatevertools({ name: 'acme' })] })
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  const out = path.join(tmp, 'cdp')
  fs.mkdirSync(out)
  const exprs = {
    inject: "typeof acme + '/' + typeof utools",
    page: "document.getElementById('app').textContent",
    enter: 'JSON.stringify(window.__enters)',
  }
  await new Promise((ok) => {
    const child = spawn('node', [path.join(root, 'scripts/cdp.mjs'), url, out, ...Object.values(exprs)], { stdio: 'inherit' })
    const t = setTimeout(() => child.kill(), 60000)
    child.on('exit', () => (clearTimeout(t), ok()))
  })
  await server.close()
  const r = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
  check('dev：注入原生 API 和 window.utools', r.results[exprs.inject] === 'object/object', JSON.stringify(r))
  check('dev：preload 在浏览器里执行（node:path 垫片）', r.results[exprs.page] === 'hello a/b', JSON.stringify(r.results))
  check('dev：页面收到进入事件', r.results[exprs.enter] === '["hello:main"]', JSON.stringify(r.results))
  const errs = r.logs.filter((l) => /^(exception|error)/.test(l))
  check('dev：控制台没有错误', errs.length === 0, errs.join('\n'))
} catch (e) {
  check('运行', false, e.stack)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
