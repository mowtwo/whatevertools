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
const pack = (target, inputs = [fixture], extra = []) => {
  const out = path.join(tmp, target + (extra.length ? '-multi' : ''))
  const r = spawnSync('node', [cli, 'pack', ...inputs, '--target', target, '--out', out, '--name', 'acme', ...extra], { encoding: 'utf8' })
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
  // 启动打包出的应用，等到日志里出现所有期望的插件
  const launch = async (appDir, ids) => {
    const child = spawn(electron, [appDir, `--user-data-dir=${path.join(tmp, 'user-data-' + path.basename(appDir))}`], { env: { ...process.env, WHATEVERTOOLS_HEADLESS: '1' } })
    let log = ''
    child.stdout.on('data', (d) => (log += d))
    child.stderr.on('data', (d) => (log += d))
    const ok = await new Promise((done) => {
      const timer = setTimeout(() => done(false), 20000)
      const tick = setInterval(() => {
        if (ids.every((id) => log.includes(`loaded plugin ${id}`))) done(true)
        else if (child.exitCode !== null || /App threw an error|Cannot find module/.test(log)) done(false)
        else return
        clearTimeout(timer)
        clearInterval(tick)
      }, 200)
    })
    child.kill()
    return { ok, log }
  }
  const single = await launch(app, ['fixture-basic'])
  check('electron 目标：独立应用能启动并加载插件', single.ok, single.log.slice(-800))

  // 插件包输入 + 多个插件：先把夹具打成 upx，再复制一份改 id
  const { packDirectory } = createRequire(path.join(root, 'packages/upx/package.json'))('./dist/node.js')
  const upx = path.join(tmp, 'fixture.upx')
  fs.writeFileSync(upx, await packDirectory(fixture))
  const second = path.join(tmp, 'second')
  fs.cpSync(fixture, second, { recursive: true })
  const wtFile = path.join(second, 'whatevertools.json')
  fs.writeFileSync(wtFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(wtFile, 'utf8')), id: 'fixture-second' }))
  const me = pack('electron', [upx, second], ['--product', '工具箱', '--package', 'toolbox'])
  const multi = await launch(path.join(me, 'toolbox'), ['fixture-basic', 'fixture-second'])
  check('electron 目标：upx + 目录打成一个启动器，两个插件都加载', multi.ok, multi.log.slice(-800))
  const mw = pack('web', [upx, second], ['--product', '工具箱', '--package', 'toolbox'])
  const site = path.join(mw, 'toolbox')
  check('web 目标：多个插件打成带入口页的站点', ['index.html', 'fixture-basic/acme-runtime.js', 'fixture-second/acme-runtime.js'].every((f) => fs.existsSync(path.join(site, f))))
  const refuse = spawnSync('node', [cli, 'pack', upx, second, '--target', 'utools', '--out', path.join(tmp, 'x')], { encoding: 'utf8' })
  check('utools 目标：多个插件会被拒绝', refuse.status !== 0 && /一个包只能有一个插件/.test(refuse.stderr + refuse.stdout))
} catch (e) {
  check('打包', false, e.message)
} finally {
  await new Promise((ok) => setTimeout(ok, 500))
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
