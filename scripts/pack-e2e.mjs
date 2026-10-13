// 打包目标端到端测试：utools 目标原样输出；electron 目标打出的独立应用能在无界面模式下启动并加载插件
import { spawnSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pack-'))
const fixture = path.join(root, 'packages', 'electron', 'test', 'fixtures', 'basic')
const cli = path.join(root, 'packages/cli/dist/index.js')
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✗'} [pack] ${name}${ok ? '' : `\n  ${detail}`}`)
  if (!ok) failed++
}
const pack = (target) => {
  const out = path.join(tmp, target)
  const r = spawnSync('node', [cli, 'pack', fixture, '--target', target, '--out', out, '--name', 'acme'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${target} 打包失败\n${r.stdout}${r.stderr}`)
  return out
}

try {
  const u = pack('utools')
  check('utools 目标：plugin.json 原样输出，不带 whatevertools.json', fs.existsSync(path.join(u, 'plugin.json')) && !fs.existsSync(path.join(u, 'whatevertools.json')))

  const e = pack('electron')
  const app = path.join(e, fs.readdirSync(e)[0])
  const missing = ['main.js', 'node_modules/@whatevertools/electron/dist/main/index.js', 'node_modules/@whatevertools/electron/assets', 'node_modules/pinyin-pro/package.json']
    .filter((f) => !fs.existsSync(path.join(app, f)))
  check('electron 目标：运行时和第三方依赖都在', missing.length === 0, `缺少 ${missing.join(', ')}`)

  const electron = createRequire(path.join(root, 'package.json'))('electron')
  const child = spawn(electron, [app, `--user-data-dir=${path.join(tmp, 'user-data')}`], { env: { ...process.env, WHATEVERTOOLS_HEADLESS: '1' } })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const loaded = await new Promise((ok) => {
    const timer = setTimeout(() => ok(false), 20000)
    const tick = setInterval(() => {
      if (/loaded plugin fixture-basic/.test(log)) ok(true)
      else if (child.exitCode !== null || /App threw an error|Cannot find module/.test(log)) ok(false)
      else return
      clearTimeout(timer)
      clearInterval(tick)
    }, 200)
  })
  child.kill()
  check('electron 目标：独立应用能启动并加载插件', loaded, log.slice(-800))
} catch (e) {
  check('打包', false, e.message)
} finally {
  await new Promise((ok) => setTimeout(ok, 500))
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
