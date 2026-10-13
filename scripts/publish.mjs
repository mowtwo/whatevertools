// 发布所有公开包（CI 里用，OIDC 可信发布）：
//   - npm 上已有的版本跳过
//   - 刚发过但 npm 还没同步、或者还在安全扫描（暂存）里的版本，报 403 / 409 时当作已发布
//   - 其他错误让流程失败
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dirs = fs.readdirSync(path.join(root, 'packages')).map((d) => path.join(root, 'packages', d)).filter((d) => fs.existsSync(path.join(d, 'package.json')))
// 按依赖顺序：先发被依赖的包
const pkgs = dirs.map((dir) => ({ dir, json: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) })).filter((p) => !p.json.private)
const names = new Set(pkgs.map((p) => p.json.name))
const ordered = []
const visit = (p, seen = new Set()) => {
  if (ordered.includes(p) || seen.has(p)) return
  seen.add(p)
  for (const d of Object.keys({ ...p.json.dependencies, ...p.json.peerDependencies })) if (names.has(d)) visit(pkgs.find((x) => x.json.name === d), seen)
  ordered.push(p)
}
pkgs.forEach((p) => visit(p))

const exists = (name, version) => spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' }).stdout.trim() === version
let failed = 0
for (const { dir, json } of ordered) {
  const id = `${json.name}@${json.version}`
  if (exists(json.name, json.version)) {
    console.log(`跳过 ${id}（已发布）`)
    continue
  }
  const r = spawnSync('pnpm', ['publish', '--access', 'public', '--no-git-checks'], { cwd: dir, encoding: 'utf8' })
  const out = r.stdout + r.stderr
  if (r.status === 0) console.log(`发布 ${id}`)
  else if (/previously (published|staged)|cannot publish over/i.test(out)) console.log(`跳过 ${id}（npm 上已有，还没同步完）`)
  else {
    failed++
    console.error(`失败 ${id}\n${out.slice(-2000)}`)
  }
}
process.exit(failed ? 1 : 0)
