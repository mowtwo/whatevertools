// 由 API 规格表生成 docs/support.md（API 名、旧名、权限、各平台支持程度）
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { APIS, PERMISSIONS, RUNTIME_VERSION } = require('../packages/core/dist/index.js')

const label = { native: '原生', emulated: '模拟', partial: '部分', mock: '占位', none: '—' }
const groups = new Map()
for (const a of APIS) {
  if (!groups.has(a.group)) groups.set(a.group, [])
  groups.get(a.group).push(a)
}
let md = `# API 支持程度（底座 v${RUNTIME_VERSION}）\n\n由 \`packages/core/src/apis.ts\` 自动生成（\`node scripts/gen-support.mjs\`），不要手改。\n\n`
md += '支持程度：原生 = 行为一致；模拟 = 换了实现但语义一致；部分 = 只支持一部分参数或场景；占位 = 不报错但没有真实效果；— = 不支持（按宿主策略抛错或警告）。\n\n'
md += '运行时可以用 `whatevertools.supports(name)` 查询（会结合当前宿主实际配置，比如没有配置 AI 提供者时 `ai.chat` 返回 false）。\n\n'
for (const [g, list] of groups) {
  md += `## ${g}\n\n| API | uTools 旧名 | 权限 | Electron | Web | 说明 |\n|---|---|---|---|---|---|\n`
  for (const a of list) md += `| \`${a.name}\` | ${a.legacy ? `\`${a.legacy}\`` : ''} | ${a.permission ? `\`${[].concat(a.permission).join('`, `')}\`` : ''} | ${label[a.support.electron]} | ${label[a.support.web]} | ${(a.note ?? '').replace(/\|/g, '\\|')}${a.since !== '0.1.0' ? `（${a.since} 起）` : ''} |\n`
  md += '\n'
}
md += `## 权限\n\n默认询问；只有插件自己的沙盒（数据库、私有目录）默认放行。每一项都可以按插件单独设置。\n\n| 权限 | 名称 | 说明 | 风险 | 默认 |\n|---|---|---|---|---|\n`
for (const p of PERMISSIONS) md += `| \`${p.id}\` | ${p.title} | ${p.description} | ${p.risk} | ${p.default === 'grant' ? '允许' : p.default === 'deny' ? '禁止' : '询问'} |\n`
fs.writeFileSync(new URL('../docs/support.md', import.meta.url), md)
console.log('docs/support.md', APIS.length, 'APIs')
// 同步给 Agent skill（随 @whatevertools/cli 分发）和官网用
const skillRefs = new URL('../packages/cli/skills/whatevertools/references/', import.meta.url)
fs.writeFileSync(new URL('api-support.md', skillRefs), md)
fs.writeFileSync(new URL('packaging.md', skillRefs), fs.readFileSync(new URL('../docs/packaging.md', import.meta.url), 'utf8').replace('](../packages/vite/README.md)', '](https://github.com/mowtwo/whatevertools/tree/main/packages/vite)'))
console.log('skill references synced')
