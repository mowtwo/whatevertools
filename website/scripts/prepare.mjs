// 构建前准备（vitepress dev / build 之前跑）：
//   - Agent skill（packages/cli/skills/whatevertools）复制到 public/skills/whatevertools
//   - 生成 public/llms.txt（索引）和 public/llms-full.txt（全部文档合成一个文件）
// 站点地址取环境变量 SITE_URL（Vercel 上用 VERCEL_PROJECT_PRODUCTION_URL），没有就用相对路径
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repo = path.dirname(site)
const base = (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, '')

// ---------- skill ----------
const skillSrc = path.join(repo, 'packages/cli/skills/whatevertools')
const skillDst = path.join(site, 'public/skills/whatevertools')
fs.rmSync(skillDst, { recursive: true, force: true })
fs.cpSync(skillSrc, skillDst, { recursive: true })

// ---------- llms ----------
/** 展开 VitePress 的 <!--@include: 路径{起始行,结束行}#区域--> */
function expand(file, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  let text = fs.readFileSync(file, 'utf8')
  text = text.replace(/<!--@include:\s*([^\s#{]+)(?:\{(\d*),?(\d*)\})?(?:#([\w-]+))?\s*-->/g, (_m, rel, from, to, region) => {
    const target = path.resolve(path.dirname(file), rel)
    let inc = expand(target, seen)
    if (region) {
      const m = new RegExp(`<!-- #region ${region} -->([\\s\\S]*?)<!-- #endregion ${region} -->`).exec(inc)
      inc = m ? m[1] : ''
    }
    if (from || to) inc = inc.split('\n').slice(from ? Number(from) - 1 : 0, to ? Number(to) : undefined).join('\n')
    return inc
  })
  return text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '')
}

const pages = [
  ['guide/getting-started', '快速开始', '安装 CLI，运行、检查、打包已有的 uTools 插件；写新插件'],
  ['guide/concepts', '核心概念', '分层架构、插件描述文件、targets、身份与版本、支持程度'],
  ['guide/porting', '移植 uTools 插件', '让 uTools 插件同时兼容 Electron 和网页：差异表、改法、常见问题'],
  ['guide/vite', 'Vite 项目', '@whatevertools/vite：vite build 产出三端，vite dev 模拟插件环境'],
  ['guide/packaging', '打包与签名', '配置文件、wt build / doctor / init、安装包、macOS 公证、Windows 签名、CI'],
  ['guide/electron-host', '给 Electron 应用加插件', 'runApp / WhateverToolsHost：启动器、权限、安装插件包、提供者'],
  ['guide/web-host', '给网站加插件', '@whatevertools/web-host 动态安装插件包；在自己的页面里启动运行时'],
  ['guide/packages', '插件包（upx）', 'upx / asar / zip 格式，兼容安装模式和固定打包模式，upxs 不支持'],
  ['guide/hooks', 'hook 与权限', 'hook 命名空间和示例、入口与来源、权限 id、错误码'],
  ['guide/web-adapters', '网页适配器', '网页平台的可替换适配器包：虚拟文件系统、Canvas 版 sharp、文件对话框、bridge'],
  ['guide/api-support', 'API 支持程度', '109 个 API 在 Electron 和网页上的支持程度、uTools 旧名、所需权限'],
  ['guide/agents', '给 AI Agent', 'Agent skill 和 llms.txt'],
  ['cases/quick-union-image', '案例：快拼图（网页）', 'uTools 图片拼接插件打包成网页，在线试用'],
  ['cases/desktop-widgets', '案例：桌面晾衣绳（Electron）', '只在桌面成立的悬浮层插件打包成 Electron 独立应用'],
]
const url = (p) => `${base}/${p}`
let index = `# whatevertools

> 启动器类插件（uTools 风格）的通用运行时：一套插件跑在 uTools、Electron 和网页上；几行代码给 Electron 应用和网站加上插件生态（动态安装 upx 插件包、权限、hook）。开源，MIT，npm 包 @whatevertools/*。

- 仓库：https://github.com/mowtwo/whatevertools
- 命令行：\`npx whatevertools <build|doctor|init|skill|run|check|pack>\`，加 \`--json\` 输出机器可读结果
- Agent skill：\`npx whatevertools skill\`，或下载 ${url('skills/whatevertools/SKILL.md')}

## 文档

`
for (const [p, title, desc] of pages) index += `- [${title}](${url(p)}.md): ${desc}\n`
index += `
## Agent skill

- [SKILL.md](${url('skills/whatevertools/SKILL.md')}): 什么时候看哪份参考、核心概念、工作规则
- [porting.md](${url('skills/whatevertools/references/porting.md')}): 移植与多端兼容
- [hosts.md](${url('skills/whatevertools/references/hosts.md')}): 做宿主、hook、权限 id、错误码
- [packaging.md](${url('skills/whatevertools/references/packaging.md')}): 打包、签名、CI
- [api-support.md](${url('skills/whatevertools/references/api-support.md')}): API 支持表（自动生成）

## Optional

- [全部文档合成一个文件](${url('llms-full.txt')})
`
fs.writeFileSync(path.join(site, 'public/llms.txt'), index)

let full = `# whatevertools 文档全文\n\n> 由 website/scripts/prepare.mjs 生成。仓库：https://github.com/mowtwo/whatevertools\n`
const mdOut = path.join(site, 'public')
for (const [p, title] of pages) {
  const text = expand(path.join(site, `${p}.md`)).trim()
  full += `\n\n---\n\n<!-- ${title}：${url(p)} -->\n\n${text}\n`
  // 每篇文档也给一份纯 Markdown（llms.txt 约定：页面地址加 .md）
  fs.mkdirSync(path.dirname(path.join(mdOut, `${p}.md`)), { recursive: true })
  fs.writeFileSync(path.join(mdOut, `${p}.md`), text + '\n')
}
fs.writeFileSync(path.join(site, 'public/llms-full.txt'), full)
console.log(`skill → public/skills/whatevertools；llms.txt（${pages.length} 篇）、llms-full.txt ${(full.length / 1024).toFixed(0)}KB${base ? `，站点 ${base}` : '，相对路径'}`)
