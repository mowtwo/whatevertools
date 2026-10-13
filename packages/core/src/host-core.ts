// 宿主核心引擎（所有平台共用）：插件表、描述文件加载、生命周期、请求记账、权限、入口与来源、
// 定时任务、动态功能、快捷键、提供者、面板操作、身份、同步。
// 平台（electron / web / tauri）继承它，只实现几个抽象方法：建视图、销毁视图、发事件、发请求、读描述文件。
//
// 生命周期 hook（apply）：
//   lifecycle:start  [pluginId]            插件开始启动（可拦截：返回 false 不启动）
//   lifecycle:enter  [pluginId, action]    进入功能（可改写 action，返回 null 拦截）
//   lifecycle:exit   [pluginId, kill]      退出（返回 false 拦截）
//   lifecycle:idle   [pluginId]            后台超时要结束插件（返回 false 保留）
//   lifecycle:crash  [pluginId, reason]    插件视图崩溃（返回值忽略）
import { buildIdentity, RUNTIME_VERSION, type Identity, type IdentityOptions } from './apis'
import type { CompatLayerDescriptor, CompatLayerConfig } from './compat'
import { EntryRegistry, type EmitMeta, type EntryInput, type EntryType, type MatchResult } from './entries'
import { FeatureStore, HotkeyTable } from './features'
import { HookRegistry } from './hooks'
import { loadManifest, nativeManifestLoader, type Feature, type ManifestLoader, type PluginManifest } from './manifest'
import type { PanelAdapter, PanelOp } from './panel'
import { PermissionManager, type PermissionPrompter } from './permission-manager'
import { normalizeScopePath, type PermissionPolicy, type PermissionSet } from './permissions'
import { callProvider, type Providers } from './providers'
import { Scheduler } from './scheduler'
import { SourceRegistry, type EntrySource, type SourcePlatform } from './sources'
import type { HostStore } from './store'
import type { SyncAdapter } from './adapters'
import { Replicator } from './sync'
import { STORAGE_PREFIX, type DocDb } from './db'

/** 进入插件的动作 */
export interface EnterAction {
  code: string
  type: string
  payload: unknown
  /** 唤起来源（入口来源 id） */
  from: string
  option?: Record<string, unknown>
}

/** 引擎里的插件状态；平台在此基础上加自己的字段（视图、数据库、目录……） */
export class CorePlugin {
  /** 页面和 lifecycle.onReady 都完成 */
  ready = false
  private readyWaiters: Array<() => void> = []
  starting: Promise<void> | null = null
  /** 平台的视图是否存在 */
  alive = false
  tools = new Set<string>()
  private toolWaiters = new Map<string, Array<() => void>>()
  listening = new Set<string>()
  /** 插件借用的面板输入框 */
  panelInput: { placeholder: string; value: string } | null = null
  /** 后台超时定时器 */
  idleTimer: ReturnType<typeof setTimeout> | null = null
  replicator: Replicator | null = null

  constructor(
    readonly manifest: PluginManifest,
    readonly perms: PermissionSet,
    readonly isDev: boolean,
    private featureStore: FeatureStore,
  ) {}

  get id() {
    return this.manifest.id
  }

  allFeatures(): Feature[] {
    return [...this.manifest.features, ...this.featureStore.list(this.id)]
  }

  dynamicFeatures(): Feature[] {
    return this.featureStore.list(this.id)
  }

  markReady() {
    this.ready = true
    this.readyWaiters.splice(0).forEach((f) => f())
  }

  whenReady(): Promise<void> {
    return this.ready ? Promise.resolve() : new Promise((r) => this.readyWaiters.push(r))
  }

  /** 视图没了：状态复位 */
  resetView() {
    this.alive = false
    this.ready = false
    this.listening.clear()
    this.tools.clear()
  }

  addTool(name: string) {
    this.tools.add(name)
    const w = this.toolWaiters.get(name)
    if (w) {
      this.toolWaiters.delete(name)
      w.forEach((f) => f())
    }
  }

  whenTool(name: string, timeoutMs: number): Promise<void> {
    if (this.tools.has(name)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const waiter = () => (clearTimeout(t), resolve())
      const t = setTimeout(() => {
        const list = this.toolWaiters.get(name)
        if (list) this.toolWaiters.set(name, list.filter((f) => f !== waiter))
        reject(new Error(`插件「${this.id}」没有注册工具 ${name}`))
      }, timeoutMs)
      const list = this.toolWaiters.get(name) ?? []
      list.push(waiter)
      this.toolWaiters.set(name, list)
    })
  }
}

export interface HostTimeouts {
  /** 等插件页面就绪（默认 15s） */
  ready?: number
  /** 插件退到后台多久后结束（默认 0 = 不自动结束；uTools 默认是 3 分钟） */
  idleExit?: number
  /** 定时任务回调（默认 10 分钟） */
  schedule?: number
}

export interface HostCoreOptions {
  identity?: IdentityOptions
  policy?: PermissionPolicy
  providers?: Providers
  /** 兼容层（平台负责把配置解析成描述对象） */
  compat?: CompatLayerConfig[]
  entryTypes?: false | EntryType[]
  entrySources?: false | EntrySource[]
  sourceOptions?: Record<string, Record<string, unknown>>
  textScorer?: (query: string, label: string) => number
  sync?: { adapter: (pluginId: string) => SyncAdapter | null | undefined; interval?: number }
  devPlugins?: string[] | 'all'
  timeouts?: HostTimeouts
  log?: (level: 'info' | 'warn' | 'error', msg: string, data?: unknown) => void
}

/** 解析后的兼容层 */
export interface ResolvedCompat {
  layer: CompatLayerDescriptor
  /** 插件进程按这个模块路径加载兼容层（没有则只用宿主侧部分） */
  module?: string
  name: string
  use: NonNullable<CompatLayerConfig['use']>
}

/** 用户主动给出的输入来源：只有这些来源带来的文件才临时授予读取 */
export const USER_INTENT_SOURCES = new Set(['main', 'panel', 'hotkey', 'tray', 'standalone', 'notification', 'url-scheme', 'drop', 'paste'])

export abstract class HostCore<P extends CorePlugin = CorePlugin> {
  readonly plugins = new Map<string, P>()
  readonly hooks: HookRegistry
  readonly store: HostStore
  readonly permissions: PermissionManager
  readonly entries: EntryRegistry
  readonly sources: SourceRegistry
  readonly scheduler: Scheduler
  readonly features: FeatureStore
  readonly hotkeys: HotkeyTable
  readonly compatLayers: ResolvedCompat[]
  readonly manifestLoaders: ManifestLoader[]
  panelAdapter?: PanelAdapter<P, unknown, unknown>
  private pending = new Map<string, { plugin: string; viewKey: unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

  constructor(
    readonly core: HostCoreOptions,
    deps: { store: HostStore; hooks?: HookRegistry; prompter: PermissionPrompter; sourcePlatform: SourcePlatform; compat: ResolvedCompat[]; scopeRoot?: (permission: string, scope: string) => string },
  ) {
    this.hooks = deps.hooks ?? new HookRegistry()
    this.store = deps.store
    this.compatLayers = deps.compat
    this.permissions = new PermissionManager({ policy: core.policy, store: this.store, hooks: this.hooks, prompter: deps.prompter, scopeRoot: deps.scopeRoot })
    this.permissions.onChange((pluginId) => {
      const p = this.plugins.get(pluginId)
      if (p) this.onGrantsChanged(p)
    })
    this.features = new FeatureStore(this.store)
    this.hotkeys = new HotkeyTable(this.store)
    this.manifestLoaders = [nativeManifestLoader, ...this.compatLayers.filter((c) => c.use.manifest !== false && c.layer.manifestLoader).map((c) => c.layer.manifestLoader!)]
    this.entries = new EntryRegistry(this.hooks, () => [...this.plugins.values()].map((p) => ({ pluginId: p.id, features: p.allFeatures() })), { platform: this.platformName(), textScorer: core.textScorer })
    if (core.entryTypes !== false) {
      for (const c of this.compatLayers) if (c.use.entryTypes !== false) for (const t of c.layer.entryTypes ?? []) this.entries.register(t)
      for (const t of core.entryTypes ?? []) this.entries.register(t)
    }
    this.sources = new SourceRegistry(
      this.hooks,
      {
        emit: (input, meta) => this.entries.emit(input, meta),
        enter: (req) => this.enter(req.pluginId, { code: req.code, type: req.type, payload: req.payload, from: req.from, option: req.option }),
        hotkeys: () => this.hotkeys.list().filter((h) => this.plugins.has(h.pluginId)),
        onHotkeysChange: (fn) => this.hotkeys.onChange(fn),
      },
      deps.sourcePlatform,
      core.sourceOptions,
    )
    this.scheduler = new Scheduler({
      store: this.store,
      hooks: this.hooks,
      log: (m) => this.log('warn', m),
      run: async (pluginId, code) => {
        const p = this.get(pluginId)
        await this.start(p)
        await this.request(p, 'schedule.trigger', [{ code }], this.core.timeouts?.schedule ?? 10 * 60 * 1000)
      },
    })
  }

  // ---------- 平台实现 ----------

  /** 平台名（入口匹配的 platform 过滤） */
  protected abstract platformName(): string
  /** 读插件目录里的描述文件：文件名 → JSON（不存在的不放） */
  protected abstract readManifestFiles(dir: string, names: string[]): Record<string, unknown>
  /** 为插件建主视图并开始加载页面；页面就绪后平台调用 plugin.markReady() */
  protected abstract createView(plugin: P): void
  /** 结束插件：销毁主视图和它的窗口 */
  protected abstract destroyView(plugin: P): void
  /** 推送事件给插件主视图 */
  protected abstract sendEvent(plugin: P, name: string, args: unknown[]): void
  /** 发请求给插件主视图（插件处理完用 resolveReply 回复）；返回本次请求的视图标识，用于校验回复者 */
  protected abstract sendRequest(plugin: P, id: string, name: string, args: unknown[]): unknown
  /** 用描述创建平台的插件对象 */
  protected abstract createPlugin(manifest: PluginManifest, perms: PermissionSet, isDev: boolean): P
  /** 插件的数据库（同步用；没有就不同步） */
  protected pluginDb(_plugin: P): { db: DocDb; ready: Promise<void> } | null {
    return null
  }
  /** 插件当前有没有平台窗口开着（有就不做后台超时退出） */
  protected hasOpenWindows(_plugin: P): boolean {
    return false
  }
  /** 权限变化：平台刷新插件进程里的缓存 */
  protected onGrantsChanged(_plugin: P): void {}

  // ---------- 通用 ----------

  log(level: 'info' | 'warn' | 'error', msg: string, data?: unknown) {
    if (this.core.log) return this.core.log(level, msg, data)
    const line = `[whatevertools] ${msg}`
    if (level === 'error') console.error(line, data ?? '')
    else if (level === 'warn') console.warn(line, data ?? '')
    else console.log(line, data ?? '')
  }

  get(pluginId: string): P {
    const p = this.plugins.get(pluginId)
    if (!p) throw new Error(`没有插件：${pluginId}`)
    return p
  }

  /** 加载插件目录 */
  loadPlugin(dir: string): P {
    const files = this.readManifestFiles(dir, [...new Set(this.manifestLoaders.flatMap((l) => l.files))])
    const manifest = loadManifest(this.manifestLoaders, { dir, files })
    if (this.plugins.has(manifest.id)) throw new Error(`插件 id 重复：${manifest.id}`)
    const dev = this.core.devPlugins === 'all' || !!this.core.devPlugins?.includes(manifest.id)
    const perms = this.permissions.register(manifest.id, manifest.name, manifest.permissions)
    const plugin = this.createPlugin(manifest, perms, dev)
    this.plugins.set(manifest.id, plugin)
    this.startSync(plugin)
    this.scheduler.load(plugin.id)
    this.log('info', `loaded plugin ${manifest.id}@${manifest.version}`, { dir, format: manifest.format })
    return plugin
  }

  /** 卸载插件（结束进程、停掉定时任务和同步，数据保留） */
  unloadPlugin(pluginId: string) {
    const p = this.plugins.get(pluginId)
    if (!p) return
    if (p.alive) this.destroyView(p)
    this.scheduler.unload(pluginId)
    p.replicator?.stop()
    this.permissions.unregister(pluginId)
    this.plugins.delete(pluginId)
  }

  identityFor(plugin: P): Identity {
    const opts = { ...(this.core.identity ?? {}) }
    // 没指定伪装平台时用兼容层提供的默认身份（如 uTools 7.0.0），旧插件按版本分支时不会走错
    const mock = this.compatLayers.find((c) => c.layer.identityMock)?.layer.identityMock
    if (!opts.mock?.platform && mock) opts.mock = { ...opts.mock, platform: mock.platform, runtime: opts.mock?.runtime ?? mock.runtime }
    return buildIdentity(opts, { id: plugin.id, name: plugin.manifest.name, version: plugin.manifest.version }, this.envInfo())
  }

  protected envInfo(): Identity['env'] {
    return { platform: this.platformName(), arch: 'unknown' }
  }

  /** 设备 id（存储在宿主状态里） */
  machineId(): string {
    let id = this.store.get<string>('device/machine-id')
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`) as string
      this.store.set('device/machine-id', id)
    }
    return id
  }

  // ---------- 生命周期 ----------

  /** 启动插件（建视图并等待就绪），不显示 */
  start(plugin: P): Promise<void> {
    if (plugin.alive) return plugin.whenReady()
    if (plugin.starting) return plugin.starting
    if (this.hooks.runApply('lifecycle:start', { plugin: plugin.id }, null, [plugin.id], () => true) === false) return Promise.reject(new Error(`宿主拦截了插件启动：${plugin.id}`))
    plugin.ready = false
    plugin.starting = (async () => {
      plugin.alive = true
      this.createView(plugin)
      const limit = this.core.timeouts?.ready ?? 15000
      await Promise.race([plugin.whenReady(), new Promise((r) => setTimeout(r, limit))])
      if (!plugin.ready) {
        this.log('warn', `plugin ${plugin.id} did not report ready in ${limit}ms`)
        plugin.markReady()
      }
    })().finally(() => (plugin.starting = null))
    return plugin.starting
  }

  /** 进入插件功能 */
  async enter(pluginId: string, action: EnterAction) {
    const plugin = this.get(pluginId)
    const feature = plugin.allFeatures().find((f) => f.code === action.code)
    if (!feature) throw new Error(`插件「${pluginId}」没有功能 ${action.code}`)
    // 只为用户主动给出的文件授权（插件通过 launch.open 传来的路径不授权）
    if (action.type === 'files' && Array.isArray(action.payload) && USER_INTENT_SOURCES.has(action.from)) {
      for (const f of action.payload as Array<{ path: string }>) if (typeof f?.path === 'string') plugin.perms.grantPath('fs.read', normalizeScopePath(f.path))
    }
    const act = (await this.hooks.runApply('lifecycle:enter', { plugin: plugin.id }, null, [plugin.id, action], async (a) => a[1])) as EnterAction | null
    if (!act) return
    // 兼容旧的 event:enter hook 名
    const act2 = (await this.hooks.runApply('event:enter', { plugin: plugin.id }, null, [act], async (a) => a[0])) as EnterAction | null
    if (!act2) return
    this.cancelIdle(plugin)
    await this.start(plugin)
    if (!(feature.hidePanel && act2.from !== 'main')) this.panel('show', plugin, [], () => this.showWithoutPanel(plugin))
    this.emit(plugin, 'enter', act2)
  }

  /** 没有面板适配器时如何显示 / 隐藏（平台覆盖） */
  protected showWithoutPanel(_plugin: P) {}
  protected hideWithoutPanel(_plugin: P, _kill: boolean) {}

  /** 退出插件：kill = false 退到后台，true 结束进程 */
  out(plugin: P, kill = false) {
    if (this.hooks.runApply('lifecycle:exit', { plugin: plugin.id }, null, [plugin.id, kill], () => true) === false) return
    this.emit(plugin, 'leave', kill)
    this.panel('detachPlugin', plugin, [kill], () => this.hideWithoutPanel(plugin, kill))
    if (kill) setTimeout(() => this.kill(plugin), 50)
    else this.scheduleIdle(plugin)
  }

  /** 立即结束插件 */
  kill(plugin: P) {
    this.cancelIdle(plugin)
    if (plugin.alive) this.destroyView(plugin)
  }

  private scheduleIdle(plugin: P) {
    const ms = this.core.timeouts?.idleExit ?? 0
    if (!ms) return
    this.cancelIdle(plugin)
    plugin.idleTimer = setTimeout(() => {
      plugin.idleTimer = null
      // 有窗口开着（如桌面挂件的悬浮层）就不结束
      if (!plugin.alive || this.hasOpenWindows(plugin)) return
      if (this.hooks.runApply('lifecycle:idle', { plugin: plugin.id }, null, [plugin.id], () => true) === false) return
      this.emit(plugin, 'leave', true)
      this.kill(plugin)
    }, ms)
  }

  private cancelIdle(plugin: P) {
    if (plugin.idleTimer) clearTimeout(plugin.idleTimer)
    plugin.idleTimer = null
  }

  /** 平台报告视图崩溃 / 卡死 */
  viewGone(plugin: P, reason: string) {
    this.log('warn', `plugin ${plugin.id} view gone: ${reason}`)
    this.hooks.runApply('lifecycle:crash', { plugin: plugin.id }, null, [plugin.id, reason], () => undefined)
    for (const [id, p] of this.pending) {
      if (p.plugin === plugin.id) {
        this.pending.delete(id)
        p.reject(new Error(`插件视图已经结束（${reason}）`))
      }
    }
    plugin.resetView()
  }

  // ---------- 事件与请求 ----------

  /** 推送事件给插件（经过 event:<name> hook，返回 null 不推送） */
  emit(plugin: P, name: string, ...args: unknown[]) {
    if (!plugin.alive) return
    const a = this.hooks.runApply(`event:${name}`, { plugin: plugin.id }, null, args, (x) => x) as unknown[] | null
    if (a === null) return
    this.sendEvent(plugin, name, a ?? args)
  }

  /** 向插件发请求并等待回复 */
  request<T = unknown>(plugin: P, name: string, args: unknown[], timeoutMs = 0): Promise<T> {
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`) as string
    return new Promise<T>((resolve, reject) => {
      if (!plugin.alive) return reject(new Error(`${name}：插件没有运行`))
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (f: () => void) => {
        if (!this.pending.delete(id)) return
        if (timer) clearTimeout(timer)
        f()
      }
      if (timeoutMs) timer = setTimeout(() => done(() => reject(new Error(`${name} 超时`))), timeoutMs)
      const entry = { plugin: plugin.id, viewKey: undefined as unknown, resolve: (v: unknown) => done(() => resolve(v as T)), reject: (e: unknown) => done(() => reject(e)) }
      this.pending.set(id, entry)
      entry.viewKey = this.sendRequest(plugin, id, name, args)
    })
  }

  /** 平台收到插件的回复：只接受发出请求的那个视图的回复 */
  resolveReply(viewKey: unknown, id: string, ok: boolean, value: unknown) {
    const p = this.pending.get(id)
    if (!p || p.viewKey !== viewKey) return
    if (ok) p.resolve(value)
    else p.reject(Object.assign(new Error((value as { message?: string })?.message ?? 'error'), value))
  }

  // ---------- 入口 / 来源 / 面板 / 提供者 / 权限 ----------

  match(input: EntryInput, meta: EmitMeta = { from: 'main' }): MatchResult[] {
    return this.entries.emit(input, meta)
  }

  emitFrom(sourceId: string, input: EntryInput): MatchResult[] {
    return this.sources.context(sourceId).emit(input)
  }

  /** 启动入口来源（插件加载完、面板就绪后调用一次） */
  startSources() {
    for (const [id, title] of [['notification', '通知'], ['tray', '托盘'], ['standalone', '独立应用启动']]) {
      if (!this.sources.list().some((s) => s.id === id)) this.sources.register({ id, title, setup() {} })
    }
    if (this.core.entrySources !== false) for (const c of this.compatLayers) if (c.use.sources !== false) for (const s of c.layer.sources ?? []) this.sources.register(s)
    for (const s of this.core.entrySources || []) this.sources.register(s)
  }

  /** 面板操作：经过 panel:<op> hook，再交给面板适配器；没有适配器时调用 fallback */
  panel<T = unknown>(op: PanelOp, plugin: P | null, args: unknown[] = [], fallback?: () => T): T {
    const adapter = this.panelAdapter as any
    const [group, name] = op.includes('.') ? (op.split('.') as [string, string]) : [null, op]
    const target = group === 'input' ? adapter?.input : adapter
    const fn = target?.[name]
    return this.hooks.runApply(`panel:${op}`, { plugin: plugin?.id }, null, args, (a) => {
      if (typeof fn === 'function') return plugin ? fn.call(target, plugin, ...a) : fn.call(target, ...a)
      return fallback ? fallback() : undefined
    }) as T
  }

  provider<T>(plugin: P, name: keyof Providers, method: string, args: unknown[], fallback: () => T): T {
    return callProvider(this.hooks, this.core.providers ?? {}, name, method, { pluginId: plugin.id, pluginName: plugin.manifest.name }, args, fallback)
  }

  async permit(plugin: P, permission: string, scope?: string): Promise<void> {
    try {
      await this.permissions.permit(plugin.id, permission, scope)
    } catch (e) {
      if (plugin.perms.mode === 'warn') return this.log('warn', (e as Error).message)
      throw e
    }
  }

  setPermission(plugin: P, permission: string, decision: 'grant' | 'deny' | 'ask', scopes?: string[]) {
    this.permissions.set(plugin.id, permission, decision, scopes)
  }

  resetPermissions(plugin: P) {
    this.permissions.reset(plugin.id)
  }

  // ---------- 同步 ----------

  private startSync(plugin: P) {
    const make = this.core.sync?.adapter
    const dbInfo = this.pluginDb(plugin)
    if (!make || !dbInfo) return
    dbInfo.ready.then(() => {
      const adapter = make(plugin.id)
      if (!adapter) return
      plugin.replicator = new Replicator(dbInfo.db, adapter, {
        namespace: plugin.id,
        device: this.machineId(),
        interval: this.core.sync?.interval,
        onPull: (docs) => {
          const visible = docs.filter((d) => !d._id.startsWith(STORAGE_PREFIX))
          if (visible.length) this.emit(plugin, 'db.pull', visible)
        },
        onError: (e) => this.log('warn', `sync ${plugin.id} failed: ${(e as Error).message}`),
      }).start()
    }, () => {})
  }

  get version() {
    return RUNTIME_VERSION
  }
}
