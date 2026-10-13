// 用两个真实插件做验收（需要它们的 dist 在兄弟目录里，或用 PLUGIN_DIR 指定）
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const electron = path.join(root, 'node_modules', '.bin', 'electron')
const dir = path.join(root, "scripts", "plugins")
const runner = path.join(root, 'packages', 'electron', 'test', 'e2e', 'run.js')
let failed = 0
for (const f of readdirSync(dir).filter((x) => x.endsWith('.test.js'))) {
  const r = spawnSync(electron, [runner, path.join(dir, f)], { encoding: 'utf8', timeout: 120000 })
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('{'))
  if (!line) {
    failed++
    console.log(`✖ ${f}: 没有输出\n${(r.stderr || '').slice(-800)}`)
    continue
  }
  const d = JSON.parse(line)
  for (const t of d.results) {
    if (!t.ok) failed++
    console.log(`${t.ok ? '✔' : '✖'} [${f}] ${t.name}${t.ok ? '' : ` — ${t.error}`}`)
  }
  for (const e of d.errors) {
    failed++
    console.log(`✖ [${f}] ${e.slice(0, 500)}`)
  }
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
