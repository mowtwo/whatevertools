// 生成官网的案例素材（在本机跑，产物提交进仓库；Vercel 构建时拿不到插件仓库）：
//   - 快拼图打成网页，放进 public/demo/quick-union-image（在线试用）
//   - 两个插件的截图压缩后放进 public/cases/<插件>/
// 插件仓库默认在 ../../utools-quick-union-image 和 ../../utools-desktop-widgets（和 whatevertools 同级）
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repo = path.dirname(site)
const plugins = path.dirname(repo)
const cli = path.join(repo, 'packages/cli/dist/index.js')
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`)
  return r.stdout
}

// 在线试用：快拼图网页版
const demoOut = path.join(site, 'public/demo')
fs.rmSync(demoOut, { recursive: true, force: true })
run('node', [cli, 'pack', path.join(plugins, 'utools-quick-union-image/dist'), '--target', 'web', '--out', demoOut, '--host-name', 'whatevertools 官网', '--host-version', 'demo'])
console.log('demo → public/demo/quick-union-image')

// 截图：缩到 1600 宽、转 jpeg（macOS 自带 sips）
for (const [id, dir] of [['quick-union-image', 'utools-quick-union-image'], ['desktop-widgets', 'utools-desktop-widgets']]) {
  const src = path.join(plugins, dir, 'release/screenshots')
  const dst = path.join(site, 'public/cases', id)
  fs.rmSync(dst, { recursive: true, force: true })
  fs.mkdirSync(dst, { recursive: true })
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.png')).sort()) {
    const out = path.join(dst, f.replace(/^(\d+)-.*$/, '$1') + '.jpg')
    run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '--resampleWidth', '1600', path.join(src, f), '--out', out])
  }
  run('sips', ['-s', 'format', 'png', '--resampleWidth', '256', path.join(plugins, dir, 'release/logo/logo-1024.png'), '--out', path.join(dst, 'logo.png')])
  console.log(`screenshots → public/cases/${id}`)
}
