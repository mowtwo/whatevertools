// 浏览器运行时入口：页面最先加载这个脚本，boot() 完成后再加载插件的 preload 和页面脚本。
import { buildIdentity, callProvider, FeatureStore, HookRegistry, loadManifest, MemoryHostStore, nativeManifestLoader, PermissionManager, Scheduler, type CompatLayerDescriptor, type PermissionPrompter, type PromptRequest, type Providers, type SyncAdapter, Replicator, RUNTIME_VERSION, DocDb, type IdentityOptions, type PermissionPolicy } from '@whatevertools/core'
import { createApi, exposeApi } from '@whatevertools/api'
import { IndexedDbBackend } from '@whatevertools/db-indexeddb'
import { VirtualFs, indexedDbPersist } from '@whatevertools/fs-virtual'
import { createNodeModules, createProcess, Buffer } from '@whatevertools/shim-node'
import { createElectronModule } from '@whatevertools/shim-electron'
import { createWebCaps } from './caps'
import { createWebFiles } from '@whatevertools/web-files'
import { createBridgeCaps } from '@whatevertools/bridge'
import type { FsCapability } from '@whatevertools/core'

export interface WebBootConfig {
  /** 插件目录里的描述文件（文件名 → 内容），如 { 'plugin.json': {...}, 'whatevertools.json': {...} } */
  manifestFiles: Record<string, unknown>
  /** 原生 API 注入名（默认 whatevertools） */
  apiName?: string
  /** 兼容层（由打包入口传入描述对象），name 是注入名 */
  compat?: Array<{ layer: CompatLayerDescriptor; name?: string }>
  identity?: IdentityOptions
  policy?: PermissionPolicy
  /** 插件资源 URL 目录（以 / 结尾，默认当前页面所在目录） */
  base?: string
  /** 插件目录里的文件清单（相对路径 → 字节数），启动时挂进虚拟文件系统 /plugin，小文件预取 */
  files?: Record<string, number>
  /** preload 相对路径 → 打包后的脚本 URL */
  preloads?: Record<string, string>
  /** 启动时进入的功能 code（默认 URL 参数 feature，再默认第一个有功能指令的功能） */
  startFeature?: string
  /** 现成的 sharp 函数（比如 wasm 版）；优先于 createSharp */
  sharp?: (...a: unknown[]) => unknown
  /** 用插件的虚拟文件系统创建 sharp（full 入口默认用 @whatevertools/sharp-canvas） */
  createSharp?: (io: { readFile(path: string): Promise<Uint8Array>; writeFile(path: string, data: Uint8Array): Promise<void>; Buffer: { from(u8: Uint8Array): Uint8Array } }) => (...a: unknown[]) => unknown
  /**
   * 文件对话框和下载（@whatevertools/web-files）。false 关闭。
   * openDialog：同步的 showOpenDialog 在浏览器里只能异步选文件，选完怎么交给插件——
   *   'enter'（默认）当作一次 files 进入（onPluginEnter 收到 type: 'files'、from: 'dialog'）；'ignore' 丢弃
   */
  fileDialogs?: false | { openDialog?: 'enter' | 'ignore' }
  /** 用户信息、AI、付费、设备 id 等提供者（调用经过 provider:<名字>.<方法> hook） */
  providers?: Providers
  /** 数据同步适配器（如 @whatevertools/sync-http） */
  sync?: SyncAdapter
  /** 本地 bridge 守护进程：真实文件系统、子进程、系统剪贴板、shell（/plugin /data /temp /drop 仍走虚拟文件系统） */
  bridge?: { url: string; token: string }
  /** 自定义权限问询界面（默认浏览器 confirm） */
  prompter?: PermissionPrompter
  /** 渲染进程 hook：(hooks) => void */
  hooks?: (hooks: HookRegistry) => void
  unsupported?: 'throw' | 'warn'
}

const PREFETCH_LIMIT = 2 * 1024 * 1024

/** localStorage 版宿主状态存储（按插件加前缀） */
class LocalStorageHostStore extends MemoryHostStore {
  constructor(private prefix: string) {
    super()
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) {
        try {
          this.data.set(k.slice(prefix.length), JSON.parse(localStorage.getItem(k)!))
        } catch {}
      }
    }
  }
  protected changed() {
    for (const [k, v] of this.data) localStorage.setItem(this.prefix + k, JSON.stringify(v))
  }
  delete(key: string) {
    super.delete(key)
    localStorage.removeItem(this.prefix + key)
  }
}

/** 浏览器默认问询：confirm 只有两个按钮，确定 = 始终允许，取消 = 以后再说 */
const confirmPrompter: PermissionPrompter = {
  promptSync: (r: PromptRequest) => (confirm(`「${r.pluginName}」想要使用：${r.info?.title ?? r.permission}${r.scope ? `\n范围：${r.scope}` : ''}${r.reason ? `\n说明：${r.reason}` : ''}\n\n确定 = 始终允许，取消 = 这次不允许`) ? 'always' : 'dismiss'),
  prompt: async (r: PromptRequest) => confirmPrompter.promptSync!(r),
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = false
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`脚本加载失败：${src}`))
    document.head.appendChild(s)
  })
}

export async function boot(cfg: WebBootConfig) {
  const base = cfg.base ?? new URL('.', location.href).href
  const layers = cfg.compat ?? []
  const loaders = [nativeManifestLoader, ...layers.map((c) => c.layer.manifestLoader).filter((l): l is NonNullable<typeof l> => !!l)]
  const manifest = loadManifest(loaders, { dir: '/plugin', files: cfg.manifestFiles ?? {} })
  const q = new URLSearchParams(location.search)
  const winId = Number(q.get('__whatevertoolsWin') ?? 1)
  const kind = q.has('__whatevertoolsWin') ? 'custom' : 'main'
  const hooks = new HookRegistry()
  cfg.hooks?.(hooks)

  const vfs = new VirtualFs({
    persist: indexedDbPersist(`whatevertools-fs:${manifest.id}`),
    dirs: ['/data', '/temp', '/home', '/tmp', '/plugin', '/drop'],
    // 插件自带文件每次从网络挂载；拖入、选中、待下载的文件只在本次页面有效
    ephemeral: ['/plugin', '/drop', '/picked', '/downloads', '/tmp'],
  })
  await vfs.load()
  // 插件自带文件：挂到 /plugin，小文件先下载好，保证同步读取可用
  const prefetch: Promise<unknown>[] = []
  for (const [rel, size] of Object.entries(cfg.files ?? {})) {
    const p = vfs.mountLazy(`/plugin/${rel}`, async () => new Uint8Array(await (await fetch(new URL(rel, base))).arrayBuffer()), size)
    if (size <= PREFETCH_LIMIT) prefetch.push(vfs.readFile(p).catch(() => {}))
  }
  const db = new DocDb(new IndexedDbBackend({ name: `whatevertools-db:${manifest.id}` }))
  await Promise.all([db.load(), ...prefetch])

  // 权限：core 的权限管理器 + localStorage 存储 + 同步 confirm 问询
  const store = new LocalStorageHostStore(`whatevertools:${manifest.id}:`)
  const permissions = new PermissionManager({
    // 浏览器端的文件系统是虚拟的沙盒：读写默认放行；sharp 是页面内的纯计算；文件对话框本身就是用户的选择
    policy: { ...cfg.policy, defaults: { 'fs.read': 'grant', 'fs.write': 'grant', 'image.sharp': 'grant', dialog: 'grant', ...cfg.policy?.defaults } },
    store,
    hooks,
    prompter: cfg.prompter ?? confirmPrompter,
  })
  const perms = permissions.register(manifest.id, manifest.name, manifest.permissions)
  const providers = cfg.providers ?? {}
  const pctx = { pluginId: manifest.id, pluginName: manifest.name }
  const call = <T>(name: keyof Providers, method: string, args: unknown[], fallback: () => T) => callProvider(hooks, providers, name, method, pctx, args, fallback)
  // 同步 API 需要的提供者结果在启动时取好
  const [user, purchased] = await Promise.all([
    Promise.resolve(call('user', 'get', [], () => null)).catch(() => null),
    Promise.resolve(call<boolean | string>('billing', 'isPurchased', [], () => true)).catch(() => true),
  ])
  // 定时任务：触发时调用插件的回调（页面开着才有效）
  let capsRef: ReturnType<typeof createWebCaps> | null = null
  // 最近一次进入的功能：同步打开对话框的选择结果作为这个功能的 files 进入
  let lastEnterCode = ''
  const webFiles = cfg.fileDialogs === false ? null : createWebFiles({
    fs: vfs,
    onDeferredPick: cfg.fileDialogs?.openDialog === 'ignore' ? undefined : (paths) => {
      if (!lastEnterCode) return
      const payload = paths.map((p) => ({ path: p, name: p.slice(p.lastIndexOf('/') + 1), isFile: !!vfs.statSync(p)?.isFile, isDirectory: !!vfs.statSync(p)?.isDirectory }))
      capsRef?.emit('enter', { code: lastEnterCode, type: 'files', payload, from: 'dialog' })
    },
  })
  const scheduler = new Scheduler({ store, hooks, run: async (_pid, code) => void (await capsRef!.request('schedule.trigger', { code })) })
  if (kind === 'main') scheduler.load(manifest.id)
  const caps = createWebCaps({
    pluginId: manifest.id, pluginName: manifest.name, base, windowKind: kind, windowId: winId, vfs, db,
    scheduler, features: new FeatureStore(store), staticFeatureCodes: manifest.features.map((f) => f.code),
    permissions,
    preloads: cfg.preloads ?? {},
    dialog: webFiles?.dialog,
    shell: webFiles?.shell,
    downloadsDir: webFiles?.downloadsDir,
    sharp: providers.image?.sharp
      ? call('image', 'sharp', [], () => undefined)
      : cfg.sharp ?? cfg.createSharp?.({ readFile: (p) => vfs.readFile(p), writeFile: (p, d) => vfs.writeFile(p, d), Buffer: Buffer as unknown as { from(u8: Uint8Array): Uint8Array } }),
    ai: providers.ai ? {
      models: () => Promise.resolve(call('ai', 'models', [], () => [])),
      complete: (req, io) => call('ai', 'complete', [req, io], () => Promise.reject(new Error('[whatevertools] 没有配置 AI 模型'))),
    } : undefined,
  })
  if (cfg.bridge) {
    const b = createBridgeCaps({ ...cfg.bridge, plugin: manifest.id })
    const virtual = (p: string) => /^\/(plugin|data|temp|drop|tmp|picked|downloads)(\/|$)/.test(String(p))
    const vfsCap = caps.fs!
    // 组合文件系统：沙盒目录走虚拟文件系统，其他路径交给 bridge
    caps.fs = new Proxy(vfsCap, {
      get(target, key) {
        const v = (target as any)[key]
        const bv = (b.fs as any)[key]
        if (typeof v !== 'function' || typeof bv !== 'function') return v ?? bv
        return (...args: unknown[]) => (virtual(String(args[0])) ? v.apply(target, args) : bv.apply(b.fs, args))
      },
    }) as FsCapability
    caps.process = b.process
    Object.assign(caps.clipboard!, { readTextSync: b.clipboard!.readTextSync, writeTextSync: b.clipboard!.writeTextSync })
    Object.assign(caps.shell!, b.shell)
  }
  caps.system.userSync = () => user as any
  caps.system.purchasedSync = () => purchased as boolean | string
  if (providers.device?.id) caps.system.deviceIdSync = () => call('device', 'id', [], () => '')
  if (providers.billing?.purchase) caps.system.openPurchase = (o) => call('billing', 'purchase', [o], () => Promise.resolve(false))
  if (providers.context?.activeBrowserUrl) caps.system.activeBrowserUrl = () => call('context', 'activeBrowserUrl', [], () => Promise.reject(new Error('unsupported')))
  let replicator: Replicator | null = null
  if (cfg.sync) {
    replicator = new Replicator(db, cfg.sync, { namespace: manifest.id, device: caps.system.deviceIdSync!(), onPull: (docs) => caps.emit('db.pull', docs.filter((d) => !d._id.startsWith('\u0000storage/'))) }).start()
    caps.db!.syncStateSync = () => replicator!.state
  }
  capsRef = caps
  const emit = caps.emit.bind(caps)
  caps.emit = (name: string, ...args: unknown[]) => {
    if (name === 'enter') lastEnterCode = (args[0] as { code?: string })?.code ?? lastEnterCode
    emit(name, ...args)
  }
  const mock = layers.find((c) => c.layer.identityMock)?.layer.identityMock
  const idOpts = { ...(cfg.identity ?? {}) }
  if (!idOpts.mock?.platform && mock) idOpts.mock = { ...idOpts.mock, platform: mock.platform }
  const identity = buildIdentity(idOpts, { id: manifest.id, name: manifest.name, version: manifest.version }, { platform: caps.system.os, arch: 'unknown' })
  const inst = createApi(caps, { identity, manifest, isDev: false, hooks, unsupported: cfg.unsupported })
  const g = globalThis as any
  const expose = (name: string, v: unknown) => Object.defineProperty(g, name, { value: v, configurable: false, writable: false })
  exposeApi(cfg.apiName ?? 'whatevertools', inst.api)
  for (const c of layers) {
    const name = c.name ?? c.layer.defaultName
    expose(name, c.layer.createApi(inst.raw, { name, hooks }))
  }

  // Node / Electron 模块垫片：打包后的 preload 里 require(x) 会变成 __whatevertoolsRequire(x)
  const modules = createNodeModules(caps, { platform: caps.system.os, cwd: '/plugin', home: '/home', tmp: '/tmp' })
  const electron = createElectronModule(caps)
  const cache = new Map<string, unknown>()
  g.__whatevertoolsRequire = (name: string) => {
    const id = name.replace(/^node:/, '')
    if (cache.has(id)) return cache.get(id)
    let mod: unknown
    if (id === 'electron') mod = hooks.wrap(electron, 'electron:', { plugin: manifest.id })
    else if (id in modules) mod = hooks.wrap(modules[id], `node:${id}`, { plugin: manifest.id })
    else throw Object.assign(new Error(`[whatevertools] 浏览器端没有模块 ${name}`), { code: 'MODULE_NOT_FOUND' })
    cache.set(id, mod)
    return mod
  }
  if (!g.process) g.process = createProcess(caps, { platform: caps.system.os, cwd: '/plugin' })
  if (!g.Buffer) g.Buffer = Buffer
  if (!g.global) g.global = g

  // 加载插件 preload（主窗口用 plugin.json 的 preload，自定义窗口用 webPreferences.preload）
  const preloadName = kind === 'main' ? manifest.preload : q.get('__whatevertoolsPreload') ?? undefined
  const preloadUrl = preloadName ? cfg.preloads?.[preloadName.replace(/^\.\//, '')] : undefined
  if (preloadUrl) await loadScript(new URL(preloadUrl, base).href)

  // 页面关闭：数据落盘，通知插件退出
  addEventListener('pagehide', () => {
    void db.flush().catch(() => {})
    if (kind === 'main') caps.emit('leave', true)
  })

  /** 页面脚本都执行完之后调用：等 onReady 回调，再进入启动功能（打包产物的加载器会调用它） */
  const start = async () => {
    if (kind !== 'main') return
    await inst.start()
    const want = cfg.startFeature ?? q.get('feature') ?? manifest.standalone.startFeature
    const f = (want && manifest.features.find((x) => x.code === want)) || manifest.features.find((x) => x.cmds.some((c) => typeof c === 'string'))
    const label = f?.cmds.find((c) => typeof c === 'string') as string | undefined
    if (f && label) caps.emit('enter', { code: f.code, type: 'text', payload: label, from: 'main' })
  }
  return { api: inst.api, hooks, caps, start, version: RUNTIME_VERSION }
}
