// 兼容报告：扫描插件代码里用到的旧 API（utools.xxx / window.utools.xxx）、原生 API（whatevertools.a.b）和 require 的模块，
// 按目标平台列出支持程度。
import fs from 'node:fs'
import path from 'node:path'
import { APIS, findApi, type Support } from '@whatevertools/core'
import { UTOOLS_NAMES } from '@whatevertools/compat-utools'

export interface UsageReport {
  apis: Array<{ name: string; native: string; electron: Support; web: Support; files: string[] }>
  modules: Array<{ name: string; files: string[] }>
  unknown: string[]
}

const NODE_OK_WEB = new Set(['fs', 'fs/promises', 'path', 'os', 'url', 'util', 'events', 'buffer', 'crypto', 'string_decoder', 'assert', 'timers', 'querystring', 'electron'])

export function walk(dir: string, filter: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, filter, out)
    else if (filter(p)) out.push(p)
  }
  return out
}

export function scanUsage(dir: string, apiName = 'whatevertools'): UsageReport {
  const files = walk(dir, (f) => /\.(m?js|cjs|html)$/.test(f) && fs.statSync(f).size < 20 * 1024 * 1024)
  const apiHits = new Map<string, Set<string>>()
  const modHits = new Map<string, Set<string>>()
  const legacy = new Set(UTOOLS_NAMES)
  const nativeRe = new RegExp(`\\b${apiName}\\.([a-zA-Z]+(?:\\.[a-zA-Z]+)?)`, 'g')
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    const rel = path.relative(dir, f)
    for (const m of src.matchAll(/\butools\??\.([a-zA-Z]+)(?:\??\.([a-zA-Z]+))?/g)) {
      if (!legacy.has(m[1])) continue
      if ((m[1] === 'db' || m[1] === 'dbStorage') && !m[2]) continue
      const name = m[1] === 'db' || m[1] === 'dbStorage' ? `${m[1]}.${m[2]}` : m[1]
      ;(apiHits.get(name) ?? apiHits.set(name, new Set()).get(name)!).add(rel)
    }
    for (const m of src.matchAll(nativeRe)) {
      if (findApi(m[1])) (apiHits.get(m[1]) ?? apiHits.set(m[1], new Set()).get(m[1])!).add(rel)
    }
    for (const m of src.matchAll(/\brequire\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g)) {
      const name = m[1].replace(/^node:/, '')
      ;(modHits.get(name) ?? modHits.set(name, new Set()).get(name)!).add(rel)
    }
  }
  const apis: UsageReport['apis'] = []
  const unknown: string[] = []
  for (const [name, fs_] of apiHits) {
    const spec = findApi(name) ?? APIS.find((a) => a.legacy === name)
    if (!spec) {
      unknown.push(name)
      continue
    }
    apis.push({ name, native: spec.name, electron: spec.support.electron, web: spec.support.web, files: [...fs_] })
  }
  return { apis: apis.sort((a, b) => a.name.localeCompare(b.name)), modules: [...modHits].map(([name, f]) => ({ name, files: [...f] })), unknown }
}

const RANK: Record<Support, number> = { native: 0, emulated: 1, partial: 2, mock: 3, none: 4 }

export function printReport(r: UsageReport, target: 'utools' | 'electron' | 'web') {
  const lines: string[] = []
  if (target === 'utools') {
    lines.push(`用到 ${r.apis.length} 个 API、${r.modules.length} 个模块（uTools 本体全部原生支持）`)
    return lines.join('\n')
  }
  const weak = r.apis.filter((a) => RANK[a[target]] >= 2)
  lines.push(`用到 ${r.apis.length} 个 API：${r.apis.length - weak.length} 个完整支持，${weak.length} 个部分支持或不支持`)
  for (const a of weak.sort((x, y) => RANK[y[target]] - RANK[x[target]])) lines.push(`  ${a[target].padEnd(8)} ${a.name}${a.name !== a.native ? `（${a.native}）` : ''}  ← ${a.files.slice(0, 2).join(', ')}`)
  if (target === 'web') {
    const bad = r.modules.filter((m) => !NODE_OK_WEB.has(m.name))
    if (bad.length) {
      lines.push(`浏览器端没有的模块（会在调用时报错，或需要 bridge）：`)
      for (const m of bad) lines.push(`  ${m.name}  ← ${m.files.slice(0, 2).join(', ')}`)
    }
  }
  if (r.unknown.length) lines.push(`规格表里没有的名字：${r.unknown.join(', ')}`)
  return lines.join('\n')
}
