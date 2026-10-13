// 网页上的动态插件安装：任何网站嵌入后，用户可以在浏览器里装 upx / asar / zip / 文件夹形式的插件并运行。
// 插件文件解包后存进 IndexedDB，由 Service Worker（dist/sw.js）在 <scope>plugins/<id>/ 下提供；每个插件跑在自己的 iframe 里。
// 安装语义跟 Electron 的 PluginInstaller 一致：读描述文件 → 安装策略（core 的 checkInstall）→ plugin:install hook / 用户确认 → 存储 → 记录。
import { checkInstall, HookRegistry, loadManifest, ManifestError, nativeManifestLoader, supportsTarget, type IdentityOptions, type InstallCandidate, type InstalledRecord, type InstallPolicy, type PluginManifest } from '@whatevertools/core'
import { utoolsManifestLoader } from '@whatevertools/compat-utools'
import { normalizeEntryPath, openPackage } from '@whatevertools/upx'
import { dbName, done, openHostDb, prefixRange, req } from './idb'

export type { InstallCandidate, InstalledRecord, InstallPolicy } from '@whatevertools/core'

export interface WebHostOptions {
  /** 插件的 URL 路径前缀（Service Worker 的作用域），以 / 结尾，默认 /__wt/ */
  scope?: string
  /** Service Worker 脚本地址（部署 @whatevertools/web-host/sw.js），必须能覆盖 scope */
  swUrl: string
  /** 浏览器运行时脚本地址（@whatevertools/web/full 打成 iife，全局名 __<runtimeName>Runtime） */
  runtimeUrl: string
  /** 运行时全局名前缀，默认 whatevertools（即 window.__whatevertoolsRuntime） */
  runtimeName?: string
  /** 安装策略：数量上限、允许 / 禁止名单、包格式、是否确认 */
  policy?: InstallPolicy
  /** open() 默认把 iframe 放进哪里（默认 document.body） */
  container?: HTMLElement
  /** 宿主侧 hook：(hooks) => void，比如 plugin:install */
  hooks?: (hooks: HookRegistry) => void
  /** 安装确认界面（policy.confirm 不为 false 时调用），默认浏览器 confirm() */
  prompt?: (candidate: InstallCandidate) => Promise<boolean> | boolean
  /** 原生 API 注入名（默认 whatevertools） */
  apiName?: string
  /** 兼容层，默认 [{ type: 'utools' }]；false 关闭 */
  compat?: Array<{ type: 'utools'; name?: string }> | false
  identity?: IdentityOptions
  /** 其他启动配置（会原样写进每个插件的 WebBootConfig，必须能 JSON 序列化），如 { policy, unsupported } */
  boot?: Record<string, unknown>
  /** iframe 属性：sandbox（默认不设）、allow（默认剪贴板 + 全屏） */
  iframe?: { sandbox?: string; allow?: string }
}

/** 网页端的安装记录：InstalledRecord 加上打开插件需要的信息 */
export interface WebInstalledRecord extends InstalledRecord {
  name: string
  description: string
  logo: string
  main: string
  preload?: string
  /** 文件这一代的标记：升级时先写新一代，再切换记录 */
  gen: string
  /** 插件文件清单（相对路径 → 字节数） */
  files: Record<string, number>
  /** 描述文件（plugin.json / whatevertools.json / package.json 的精简版） */
  manifestFiles: Record<string, unknown>
  panelHeight: number
}

export type InstallInput = File | Blob | Uint8Array | ArrayBuffer | FileList | File[]

export interface OpenedPlugin {
  iframe: HTMLIFrameElement
  close(): void
}

export interface WebHost {
  /** Service Worker 就绪、安装记录读好后 resolve */
  ready: Promise<void>
  hooks: HookRegistry
  /** 作用域的完整 URL */
  scope: string
  /** 安装或升级；策略不允许、用户取消、描述文件有误时抛错（code: EWTINSTALL；加密的 upxs 是 EWTENCRYPTED） */
  install(input: InstallInput, opts?: { source?: string; confirm?: boolean }): Promise<WebInstalledRecord>
  /** 卸载（删除文件和记录）；purgeData 同时清掉插件自己的数据（虚拟文件系统、数据库、localStorage） */
  uninstall(id: string, opts?: { purgeData?: boolean }): Promise<void>
  list(): WebInstalledRecord[]
  get(id: string): WebInstalledRecord | undefined
  /** 在 iframe 里打开插件 */
  open(id: string, opts?: { feature?: string; container?: HTMLElement }): OpenedPlugin
  /** 关掉这个插件所有打开的 iframe */
  close(id: string): void
}

const MANIFEST_FILES = [...new Set([...nativeManifestLoader.files, ...utoolsManifestLoader.files])]

const fail = (msg: string): never => {
  throw Object.assign(new Error(msg), { code: 'EWTINSTALL' })
}

/** 文件夹（<input webkitdirectory> 选中的文件）→ 文件表；只有一个顶层目录时去掉这层 */
async function readFolder(list: ArrayLike<File>): Promise<Map<string, Uint8Array>> {
  const entries: Array<[string, File]> = []
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    const rel = normalizeEntryPath((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)
    if (rel.endsWith('.map') || rel.split('/').pop() === '.DS_Store') continue
    entries.push([rel, f])
  }
  const tops = new Set(entries.map(([p]) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '')))
  const strip = tops.size === 1 && !tops.has('') && !entries.some(([p]) => MANIFEST_FILES.includes(p))
  const out = new Map<string, Uint8Array>()
  for (const [p, f] of entries) out.set(strip ? p.slice(p.indexOf('/') + 1) : p, new Uint8Array(await f.arrayBuffer()))
  return out
}

function parseJson(files: Map<string, Uint8Array>, name: string) {
  const b = files.get(name)
  if (!b) return undefined
  try {
    return JSON.parse(new TextDecoder().decode(b).replace(/^﻿/, ''))
  } catch (e: any) {
    return fail(`${name} 不是合法 JSON：${e?.message ?? e}`)
  }
}

/** 默认确认：浏览器 confirm，列出名字、版本、插件说明的权限用途 */
function confirmInstall(c: InstallCandidate): boolean {
  const perms = Object.entries(c.permissions)
  const text = [
    `${c.previousVersion ? '升级' : '安装'}插件「${c.name}」？`,
    c.previousVersion ? `从 ${c.previousVersion} 升级到 ${c.version}` : `版本 ${c.version}`,
    c.description,
    perms.length ? `\n插件说明的用途（使用时仍会逐项询问）：\n${perms.map(([k, v]) => `· ${k}${v.reason ? `：${v.reason}` : ''}`).join('\n')}` : '',
    c.source ? `\n来源：${c.source}` : '',
  ].filter(Boolean).join('\n')
  return confirm(text)
}

export function createWebHost(o: WebHostOptions): WebHost {
  const scope = new URL(o.scope ?? '/__wt/', location.href).href
  if (!scope.endsWith('/')) throw new Error('[whatevertools] scope 必须以 / 结尾')
  const scopePath = new URL(scope).pathname
  const policy = o.policy ?? {}
  const hooks = new HookRegistry()
  o.hooks?.(hooks)
  const records = new Map<string, WebInstalledRecord>()
  const frames = new Map<string, Set<OpenedPlugin>>()
  let db: IDBDatabase | null = null
  let loaded = false

  async function registerSw() {
    if (!('serviceWorker' in navigator)) throw new Error('[whatevertools] 当前浏览器不支持 Service Worker（页面需要 https 或 localhost）')
    const reg = await navigator.serviceWorker.register(o.swUrl, { scope })
    if (reg.active) return
    const w = reg.installing ?? reg.waiting
    if (!w) return
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (w.state === 'activated' || reg.active) resolve()
        else if (w.state === 'redundant') reject(new Error('[whatevertools] Service Worker 安装失败'))
      }
      w.addEventListener('statechange', check)
      check()
    })
  }

  async function load() {
    await registerSw()
    db = await openHostDb(dbName(scopePath))
    // 宿主配置给 Service Worker 合成插件的启动配置
    const config = {
      runtimeUrl: new URL(o.runtimeUrl, location.href).href,
      runtimeName: o.runtimeName ?? 'whatevertools',
      apiName: o.apiName,
      compat: o.compat === false ? [] : o.compat ?? [{ type: 'utools' }],
      identity: o.identity,
      boot: o.boot ?? {},
    }
    const tx = db.transaction(['meta', 'records', 'files'], 'readwrite')
    tx.objectStore('meta').put(config, 'config')
    const list = (await req(tx.objectStore('records').getAll())) as WebInstalledRecord[]
    for (const r of list) records.set(r.id, r)
    // 清理没切换成功（写完文件就崩溃）或已被替换的旧一代文件
    const keys = (await req(tx.objectStore('files').getAllKeys())) as string[]
    const live = new Set(list.map((r) => `${r.id}/${r.gen}/`))
    for (const k of keys) {
      const p = k.split('/', 2).join('/') + '/'
      if (!live.has(p)) tx.objectStore('files').delete(k)
    }
    await done(tx)
    loaded = true
  }
  const ready = load()
  ready.catch(() => {})

  const need = () => {
    if (!loaded || !db) throw new Error('[whatevertools] 宿主还没准备好，先 await host.ready')
    return db
  }

  async function doInstall(input: InstallInput, opts: { source?: string; confirm?: boolean }): Promise<WebInstalledRecord> {
    await ready
    const idb = need()
    let format: string
    let files: Map<string, Uint8Array>
    let name: string | undefined
    if (typeof FileList !== 'undefined' && input instanceof FileList || Array.isArray(input)) {
      format = 'dir'
      files = await readFolder(input as ArrayLike<File>)
      const first = (input as ArrayLike<File>)[0] as (File & { webkitRelativePath?: string }) | undefined
      name = first?.webkitRelativePath?.split('/')[0] || undefined
    } else {
      const blob = input as Blob
      name = typeof File !== 'undefined' && input instanceof File ? input.name : undefined
      const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(await blob.arrayBuffer())
      // 加密的 upxs 会抛 EncryptedPackageError（code: EWTENCRYPTED），原样交给调用方
      const pkg = await openPackage(bytes, { name })
      format = pkg.format
      files = pkg.files
    }
    // 跟其他平台一样读描述文件：原生 whatevertools.json 优先，再 uTools plugin.json（id 规则一致）
    const manifestFiles: Record<string, unknown> = {}
    for (const f of MANIFEST_FILES) {
      const j = parseJson(files, f)
      if (j !== undefined) manifestFiles[f] = j
    }
    const pkgJson = manifestFiles['package.json'] as Record<string, unknown> | undefined
    if (pkgJson) manifestFiles['package.json'] = { name: pkgJson.name, version: pkgJson.version, productName: pkgJson.productName, description: pkgJson.description }
    const stem = (name ?? '').replace(/\.(upxs?|asar|zip)$/i, '') || 'plugin'
    let manifest: PluginManifest
    try {
      manifest = loadManifest([nativeManifestLoader, utoolsManifestLoader], { dir: `/${stem}`, files: manifestFiles })
    } catch (e) {
      if (e instanceof ManifestError) fail(`插件描述文件有误：\n${e.problems.join('\n')}`)
      throw e
    }
    if (!supportsTarget(manifest, 'web')) fail(`插件「${manifest.name}」声明只支持 ${manifest.targets!.join(' / ')}，不能在网页里运行`)
    const mainFile = manifest.main.replace(/[?#].*$/, '')
    if (!files.has(mainFile)) fail(`包里缺少入口页面 ${mainFile}`)
    if (manifest.preload && !files.has(manifest.preload)) fail(`包里缺少 preload 脚本 ${manifest.preload}`)

    const installed = list()
    const prev = records.get(manifest.id)
    const cand: InstallCandidate = {
      id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description,
      format, permissions: manifest.permissions, previousVersion: prev?.version, source: opts.source ?? name,
    }
    const reason = checkInstall(policy, cand, installed)
    if (reason) fail(reason)
    const ask = opts.confirm ?? policy.confirm ?? true
    const allowed = await hooks.runApply('plugin:install', { plugin: manifest.id }, host, [cand], async (a) => {
      if (!ask) return true
      const c = a[0] as InstallCandidate
      return o.prompt ? o.prompt(c) : confirmInstall(c)
    })
    if (allowed === false) fail('已取消安装')

    // 先写新一代文件，再在一个事务里切换记录并删掉旧一代：任何时候 Service Worker 看到的都是完整的一代
    const gen = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const id = manifest.id
    const sizes: Record<string, number> = {}
    const wtx = idb.transaction('files', 'readwrite')
    for (const [rel, data] of files) {
      sizes[rel] = data.byteLength
      wtx.objectStore('files').put({ data }, `${id}/${gen}/${rel}`)
    }
    await done(wtx)
    const rec: WebInstalledRecord = {
      id, version: manifest.version, dir: new URL(`plugins/${encodeURIComponent(id)}/`, scope).href, format, source: cand.source, installedAt: Date.now(),
      name: manifest.name, description: manifest.description, logo: manifest.logo, main: manifest.main, preload: manifest.preload,
      gen, files: sizes, manifestFiles, panelHeight: manifest.panel.height,
    }
    const stx = idb.transaction(['records', 'files'], 'readwrite')
    stx.objectStore('records').put(rec, id)
    if (prev) stx.objectStore('files').delete(prefixRange(`${id}/${prev.gen}/`))
    await done(stx)
    records.set(id, rec)
    // 升级：已打开的 iframe 重新加载新版本
    for (const f of frames.get(id) ?? []) f.iframe.src = f.iframe.src
    return rec
  }

  let queue: Promise<unknown> = Promise.resolve()
  /** 安装串行执行，保证数量上限等检查不被并发绕过 */
  function install(input: InstallInput, opts: { source?: string; confirm?: boolean } = {}) {
    const p = queue.then(() => doInstall(input, opts))
    queue = p.catch(() => {})
    return p
  }

  async function uninstall(id: string, opts: { purgeData?: boolean } = {}) {
    await ready
    const idb = need()
    if (!records.has(id)) fail(`${id} 不是动态安装的插件`)
    close(id)
    const tx = idb.transaction(['records', 'files'], 'readwrite')
    tx.objectStore('records').delete(id)
    tx.objectStore('files').delete(prefixRange(`${id}/`))
    await done(tx)
    records.delete(id)
    if (opts.purgeData) {
      // 运行时按插件 id 命名的存储（见 @whatevertools/web 的 boot）
      for (const n of [`whatevertools-fs:${id}`, `whatevertools-db:${id}`]) indexedDB.deleteDatabase(n)
      const prefix = `whatevertools:${id}:`
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k?.startsWith(prefix)) localStorage.removeItem(k)
      }
    }
  }

  function list() {
    return [...records.values()].sort((a, b) => a.installedAt - b.installedAt)
  }

  function open(id: string, opts: { feature?: string; container?: HTMLElement } = {}): OpenedPlugin {
    need()
    const rec = records.get(id)
    if (!rec) throw Object.assign(new Error(`[whatevertools] 没有安装插件 ${id}`), { code: 'EWTINSTALL' })
    const u = new URL(rec.main, rec.dir)
    if (opts.feature) u.searchParams.set('feature', opts.feature)
    const iframe = document.createElement('iframe')
    iframe.src = u.href
    iframe.title = rec.name
    iframe.dataset.whatevertoolsPlugin = id
    iframe.allow = o.iframe?.allow ?? 'clipboard-read; clipboard-write; fullscreen'
    if (o.iframe?.sandbox !== undefined) iframe.setAttribute('sandbox', o.iframe.sandbox)
    iframe.style.cssText = `display:block;border:0;width:100%;height:${rec.panelHeight}px`
    const set = frames.get(id) ?? new Set()
    frames.set(id, set)
    const handle: OpenedPlugin = {
      iframe,
      close() {
        iframe.remove()
        set.delete(handle)
      },
    }
    set.add(handle)
    ;(opts.container ?? o.container ?? document.body).appendChild(iframe)
    return handle
  }

  function close(id: string) {
    for (const f of [...(frames.get(id) ?? [])]) f.close()
  }

  const host: WebHost = { ready, hooks, scope, install, uninstall, list, get: (id) => records.get(id), open, close }
  return host
}
