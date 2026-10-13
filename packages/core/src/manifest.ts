// 插件描述（中立格式）。具体的描述文件格式由加载器（ManifestLoader）负责：
//   - 原生格式：whatevertools.json（含 main 字段）
//   - uTools 格式：plugin.json（加载器在 @whatevertools/compat-utools）
// 宿主按顺序尝试已登记的加载器，第一个认得这个目录的加载器给出 PluginManifest。
import { satisfies } from './version'
import { RUNTIME_VERSION } from './apis'

export type Platform = 'win32' | 'darwin' | 'linux'

/** cmd：字符串（功能指令）或带 type 的对象；type 的含义由注册的入口类型决定（见 entries.ts） */
export type Cmd = string | { type: string; label: string; [k: string]: unknown }

export interface Feature {
  code: string
  description?: string
  icon?: string
  platform?: Platform | Platform[]
  /** 不是从主面板进入时不显示面板（uTools 的 mainHide） */
  hidePanel?: boolean
  /** 搜索时可以推送动态结果（对应 uTools 的 mainPush） */
  searchPush?: boolean
  cmds: Cmd[]
}

export interface ToolDeclaration {
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export interface PermissionRequest {
  /** 用途说明，显示在问询弹窗里 */
  reason?: string
  /** 作用域：路径前缀、域名等 */
  scopes?: string[]
}

/** 独立打包相关配置 */
export interface StandaloneConfig {
  appId?: string
  productName?: string
  tray?: boolean
  /** 功能 code → 全局快捷键 */
  shortcuts?: Record<string, string>
  /** 启动时进入的功能 code */
  startFeature?: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  dir: string
  main: string
  logo: string
  preload?: string
  features: Feature[]
  tools: Record<string, ToolDeclaration>
  /** 面板：是否单实例、初始高度 */
  panel: { single: boolean; height: number }
  engines: { whatevertools?: string }
  permissions: Record<string, PermissionRequest>
  standalone: StandaloneConfig
  /** 插件能在哪些目标上运行（utools / electron / web / 自定义平台名）；不写表示不限制 */
  targets?: string[]
  /** 由哪个加载器读出来（native / utools / ...） */
  format: string
  /** 开发模式：main 可以是开发服务器网址 */
  dev?: { main?: string; preload?: string }
}

/** 原生描述文件 whatevertools.json（也可以只写身份/权限等补充字段，配合其他格式使用） */
export interface WhateverToolsJson {
  id?: string
  name?: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  main?: string
  logo?: string
  preload?: string
  features?: Feature[]
  tools?: Record<string, ToolDeclaration>
  panel?: { single?: boolean; height?: number }
  engines?: { whatevertools?: string }
  permissions?: Record<string, true | string[] | PermissionRequest>
  standalone?: StandaloneConfig
  /** 插件能在哪些目标上运行，比如只在桌面上有意义的插件写 ["utools", "electron"] */
  targets?: string[]
  dev?: { main?: string; preload?: string }
}

export class ManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(`plugin manifest invalid:\n- ${problems.join('\n- ')}`)
  }
}

/** 加载器看到的输入：目录 + 目录里已经读好的 JSON 文件（文件名 → 内容） */
export interface ManifestSources {
  dir: string
  files: Record<string, any>
}

export interface ManifestLoader {
  /** 格式 id */
  id: string
  /** 需要读取的文件名（宿主读好后传进来） */
  files: string[]
  /** 认得这个目录就返回描述，否则返回 null；描述有错抛 ManifestError */
  load(src: ManifestSources): PluginManifest | null
}

/** 加载器用的草稿：字段都可选，由 finalizeManifest 统一校验和补默认值 */
export interface ManifestDraft {
  id?: string
  name?: string
  version?: string
  description?: string
  main?: unknown
  logo?: unknown
  preload?: unknown
  features?: unknown
  tools?: unknown
  panel?: { single?: boolean; height?: number }
  engines?: { whatevertools?: string }
  permissions?: Record<string, true | string[] | PermissionRequest>
  standalone?: StandaloneConfig
  targets?: string[]
  dev?: { main?: string; preload?: string }
}

const SAFE_ID = /[^a-z0-9._-]+/g

function relSafe(p: unknown, field: string, problems: string[], required = true): string | undefined {
  if (p === undefined || p === null || p === '') {
    if (required) problems.push(`${field} 不能为空`)
    return undefined
  }
  if (typeof p !== 'string') {
    problems.push(`${field} 必须是字符串`)
    return undefined
  }
  const norm = p.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').includes('..')) {
    problems.push(`${field} 必须是插件目录内的相对路径：${p}`)
    return undefined
  }
  return norm.replace(/^\.\//, '')
}

/** 校验并补默认值（所有加载器共用） */
export function finalizeManifest(dir: string, d: ManifestDraft, format: string, problems: string[] = []): PluginManifest {
  const main = relSafe(d.main, 'main', problems)
  if (main && !/\.html?([?#]|$)/i.test(main)) problems.push('main 必须是 .html 文件')
  const logo = relSafe(d.logo, 'logo', problems) ?? ''
  const preload = relSafe(d.preload, 'preload', problems, false)
  if (preload && !/\.(c?js|mjs)$/i.test(preload)) problems.push('preload 必须是 .js 文件')
  if (!Array.isArray(d.features) || !d.features.length) problems.push('features 至少要有一个功能')
  const features: Feature[] = (Array.isArray(d.features) ? d.features : []).filter((f: any, i: number) => {
    if (!f || typeof f.code !== 'string' || !f.code) return problems.push(`features[${i}].code 不能为空`), false
    if (!Array.isArray(f.cmds) || !f.cmds.length) return problems.push(`features[${i}].cmds 不能为空`), false
    return true
  })
  if (features.length && !features.some((f) => f.cmds.some((c) => typeof c === 'string'))) problems.push('至少要有一个功能指令（cmds 里的字符串）')
  const codes = new Set<string>()
  for (const f of features) {
    if (codes.has(f.code)) problems.push(`功能 code 重复：${f.code}`)
    codes.add(f.code)
  }
  const tools: Record<string, ToolDeclaration> = {}
  if (d.tools && typeof d.tools === 'object') {
    for (const [name, t] of Object.entries<any>(d.tools)) {
      if (!t || typeof t.description !== 'string' || !t.inputSchema || typeof t.inputSchema !== 'object') {
        problems.push(`tools.${name} 需要 description 和 inputSchema`)
        continue
      }
      tools[name] = { description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema }
    }
  }
  const engines = { ...(d.engines ?? {}) }
  if (engines.whatevertools && !satisfies(RUNTIME_VERSION, engines.whatevertools)) problems.push(`插件要求底座版本 ${engines.whatevertools}，当前是 ${RUNTIME_VERSION}`)
  const permissions: Record<string, PermissionRequest> = {}
  for (const [id, v] of Object.entries(d.permissions ?? {})) permissions[id] = v === true ? {} : Array.isArray(v) ? { scopes: v } : v
  if (d.targets !== undefined && (!Array.isArray(d.targets) || !d.targets.length || d.targets.some((t) => typeof t !== 'string' || !t))) problems.push('targets 必须是非空的字符串数组')
  const rawId = d.id || 'plugin'
  const id = String(rawId).toLowerCase().replace(/^@/, '').replace(/\//g, '.').replace(SAFE_ID, '-').replace(/^[.-]+/, '')
  // id 会用作目录名：只允许字母数字开头，禁止 . / ..
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id) || id.includes('..')) problems.push(`插件 id 不合法：${rawId}（只能用小写字母、数字、. _ -，且以字母或数字开头）`)
  if (problems.length) throw new ManifestError(problems)
  return {
    id,
    name: d.name || String(rawId),
    version: d.version || '0.0.0',
    description: d.description || '',
    dir,
    main: main!,
    logo,
    preload,
    features,
    tools,
    panel: { single: d.panel?.single ?? true, height: d.panel?.height ?? 544 },
    engines,
    permissions,
    standalone: d.standalone ?? {},
    targets: d.targets,
    format,
    dev: d.dev,
  }
}

/** 目录名推断插件 id（dist 目录取上一级的名字） */
export function idFromDir(dir: string) {
  const parts = dir.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const last = parts.pop() || 'plugin'
  return last === 'dist' || last === 'build' ? parts.pop() || last : last
}

/** 原生格式：whatevertools.json 里有 main 字段 */
export const nativeManifestLoader: ManifestLoader = {
  id: 'native',
  files: ['whatevertools.json', 'package.json'],
  load({ dir, files }) {
    const j = files['whatevertools.json'] as WhateverToolsJson | undefined
    if (!j || !j.main) return null
    const pkg = files['package.json'] ?? {}
    return finalizeManifest(dir, { ...j, id: j.id || pkg.name || idFromDir(dir), name: j.name || pkg.productName || pkg.name, version: j.version || pkg.version, description: j.description || pkg.description }, 'native')
  },
}

/** 按顺序尝试加载器 */
export function loadManifest(loaders: ManifestLoader[], src: ManifestSources): PluginManifest {
  for (const l of loaders) {
    const m = l.load(src)
    if (m) return m
  }
  throw new ManifestError([`${src.dir} 不是可识别的插件（支持的格式：${loaders.map((l) => l.id).join(' / ')}）`])
}

/** 插件是否声明支持这个目标（没写 targets 表示都支持） */
export function supportsTarget(m: Pick<PluginManifest, 'targets'>, target: string): boolean {
  return !m.targets || m.targets.includes(target)
}

/** 功能是否适用于当前平台 */
export function featureOnPlatform(f: Feature, platform: string): boolean {
  if (!f.platform) return true
  return (Array.isArray(f.platform) ? f.platform : [f.platform]).includes(platform as Platform)
}
