// Electron 宿主：在 core 的 HostCore 上实现 Electron 专属的部分——插件视图（WebContents）、会话隔离、
// 导航防护、IPC 分发到各个服务、MCP、自定义窗口。生命周期、权限、入口、调度等编排都在 core。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session as Session, shell as eShell, webContents as WebContentsStatic, type WebContents } from 'electron'
import {
  API_MAP, HostCore, PERMISSION_MAP, type HookRegistry, type InstallPolicy, type CompatLayerConfig, type CompatLayerDescriptor, type HostCoreOptions, type PermissionSet, type PluginManifest,
  type ResolvedCompat, type Grant,
} from '@whatevertools/core'
import { CH, type BridgeContext, type CompatLayer, type PermResult, type WindowKind, type WireError } from '../shared/protocol'
import { PluginRuntime } from './plugin'
import type { CallCtx, Handler, PermissionPromptAnswer, PermissionPromptRequest, Shell } from './types'
import { services } from './services'
import { McpServer } from './services/mcp'
import { electronSourcePlatform } from './source-platform'
import { JsonFileHostStore } from './store'
import { UBrowsers } from './services/ubrowser'
import { PluginInstaller } from './installer'

export interface HostOptions extends Omit<HostCoreOptions, 'compat'> {
  /** 主题：跟随系统（默认）/ 固定浅色 / 固定深色；插件页的 prefers-color-scheme 跟着变 */
  theme?: 'system' | 'light' | 'dark'
  /** 宿主数据目录（默认 app.getPath('userData')/whatevertools） */
  dataDir?: string
  /** 原生 API 的注入名（默认 whatevertools） */
  apiName?: string
  /**
   * 兼容层：[{ module: '@whatevertools/compat-utools' }]，可以改注入名 [{ module, name: 'myhost' }]。
   * `{ type: 'utools' }` 是 uTools 兼容层的简写。兼容层提供兼容 API、默认入口类型和来源、描述文件格式、伪装身份
   */
  compat?: CompatLayer[]
  hooks?: HookRegistry
  /** 渲染进程 hook 模块（绝对路径），会在插件 preload 之前加载，导出 (hooks, ctx) => void */
  rendererHooks?: string[]
  shell?: Shell
  mcp?: { enabled?: boolean; port?: number; host?: string }
  ffmpegPath?: string
  /** 不支持的 API：throw（默认）或 warn */
  unsupported?: 'throw' | 'warn'
  /** 自定义权限问询界面；默认用系统对话框 */
  prompt?: (req: PermissionPromptRequest) => Promise<PermissionPromptAnswer>
  /** 动态安装插件包（upx / asar / zip）的策略；不写时不允许安装（runApp 的启动器模式默认允许） */
  install?: InstallPolicy
}

interface WcInfo {
  plugin: PluginRuntime
  kind: WindowKind
  parentWcId?: number
}

const BRIDGE = path.join(__dirname, '..', 'preload', 'index.js')

interface WcInfo {
  plugin: PluginRuntime
  kind: WindowKind
  parentWcId?: number
}

export class WhateverToolsHost extends HostCore<PluginRuntime> {
  readonly dataDir: string
  /** 插件包安装器（安装 / 升级 / 卸载 upx、asar、zip） */
  readonly installer: PluginInstaller
  /** 方法名 → 实现（无原型对象，避免 constructor 等继承属性被当成方法调用） */
  readonly handlers: Record<string, Handler> = Object.assign(Object.create(null), services)
  readonly mcp: McpServer
  readonly ubrowsers = new UBrowsers()
  declare readonly store: JsonFileHostStore
  shell?: Shell
  private wcIndex = new Map<number, WcInfo>()
  private streams = new Map<string, { wcId?: number; onData: (data: unknown) => void }>()
  /** 自定义窗口的插件 preload（webContents id → 绝对路径） */
  readonly customPreloads = new Map<number, string | undefined>()

  constructor(readonly options: HostOptions = {}) {
    const dataDir = options.dataDir ?? path.join(app.getPath('userData'), 'whatevertools')
    fs.mkdirSync(dataDir, { recursive: true })
    const store = new JsonFileHostStore(path.join(dataDir, 'host-store.json'))
    let self: WhateverToolsHost | null = null
    super(
      { ...options, compat: undefined, timeouts: options.timeouts },
      {
        store,
        hooks: options.hooks,
        compat: (options.compat ?? []).map((c) => resolveCompat(c)),
        scopeRoot: (permission, scope) => (permission.startsWith('fs.') ? path.resolve(scope) : scopeHost(scope)),
        prompter: {
          prompt: (req) => (options.prompt ?? defaultPrompt)({ plugin: self!.get(req.pluginId), permission: req.permission, scope: req.scope, reason: req.reason }),
        },
        sourcePlatform: electronSourcePlatform(() => self!),
      },
    )
    self = this
    this.dataDir = dataDir
    this.shell = options.shell
    this.panelAdapter = options.shell as any
    this.mcp = new McpServer(this)
    this.installer = new PluginInstaller(this, options.install ?? { enabled: false })
    this.installIpc()
    if (process.env.WHATEVERTOOLS_HEADLESS) this.installHeadlessGuards()
    if (options.theme) nativeTheme.themeSource = options.theme
    // 主题变化推给所有运行中的插件（经过 event:theme.change hook）
    nativeTheme.on('updated', () => {
      for (const p of this.plugins.values()) this.emit(p, 'theme.change', nativeTheme.shouldUseDarkColors)
    })
    app.on('before-quit', () => {
      for (const p of this.plugins.values()) {
        try {
          p.db.flushSync()
        } catch {}
      }
      try {
        this.store.flushSync()
      } catch {}
    })
  }

  /** 切换宿主主题 */
  setTheme(theme: 'system' | 'light' | 'dark') {
    nativeTheme.themeSource = this.hooks.runApply('theme:source', {}, null, [theme], (a) => a[0]) as typeof theme
  }

  get apiName() {
    return this.options.apiName ?? 'whatevertools'
  }

  // ---------- HostCore 的平台实现 ----------

  protected platformName() {
    return process.platform
  }

  protected envInfo() {
    return { platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }
  }

  protected readManifestFiles(dir: string, names: string[]) {
    const files: Record<string, unknown> = {}
    const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))
    for (const f of names) {
      try {
        files[f] = read(path.join(dir, f))
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw new Error(`${f} 解析失败：${e.message}`)
        // 补充文件（whatevertools.json / package.json）也可以放在上一级（比如插件目录是构建产物 dist）
        if (f !== 'plugin.json') {
          try {
            files[f] = read(path.join(dir, '..', f))
          } catch {}
        }
      }
    }
    return files
  }

  /** 打开插件主视图的开发者工具 */
  openDevTools(plugin: PluginRuntime) {
    if (plugin.mainWc && !plugin.mainWc.isDestroyed()) plugin.mainWc.openDevTools({ mode: 'detach' })
  }

  loadPlugin(dir: string): PluginRuntime {
    const p = super.loadPlugin(path.resolve(dir))
    // 多实例（panel.single = false）暂不支持：明确提示，按单实例运行
    if (!p.manifest.panel.single) this.log('warn', `插件 ${p.id} 声明了多实例（pluginSetting.single = false），当前按单实例运行`)
    this.mcp.refresh()
    return p
  }

  protected createPlugin(manifest: PluginManifest, perms: PermissionSet, isDev: boolean) {
    return new PluginRuntime(manifest, this.dataDir, perms, isDev, this.features)
  }

  protected pluginDb(plugin: PluginRuntime) {
    return { db: plugin.db, ready: plugin.dbReady }
  }

  protected hasOpenWindows(plugin: PluginRuntime) {
    return [...plugin.windows.values()].some((w) => !w.win.isDestroyed() && w.win.isVisible())
  }

  protected onGrantsChanged(plugin: PluginRuntime) {
    // 权限变化后通知插件的所有窗口刷新缓存
    for (const [id, info] of this.wcIndex) {
      if (info.plugin !== plugin) continue
      const wc = WebContentsStatic.fromId(id)
      if (wc && !wc.isDestroyed()) wc.send(CH.event, '__grants', this.permissions.cacheable(plugin.id))
    }
  }

  protected createView(plugin: PluginRuntime) {
    const prefs = this.webPreferences(plugin)
    let wc: WebContents
    if (this.shell) wc = this.shell.attach(plugin, prefs)
    else wc = new BrowserWindow({ show: false, width: 800, height: plugin.manifest.panel.height, title: plugin.manifest.name, webPreferences: prefs }).webContents
    plugin.mainWc = wc
    this.register(wc, plugin, 'main')
    wc.once('destroyed', () => {
      if (plugin.mainWc !== wc) return
      plugin.mainWc = null
      plugin.resetView()
      plugin.cleanupTemp()
      for (const w of plugin.windows.values()) if (!w.win.isDestroyed()) w.win.destroy()
    })
    // 崩溃 / 卡死：通知 core（拒绝挂起的请求、触发 lifecycle:crash），视图交给平台回收
    wc.on('render-process-gone', (_e, d) => {
      this.viewGone(plugin, d.reason)
      if (!wc.isDestroyed()) wc.close()
    })
    wc.on('unresponsive', () => this.log('warn', `plugin ${plugin.id} is not responding`))
    const dev = plugin.isDev ? plugin.manifest.dev?.main : undefined
    const url = dev && /^https?:/.test(dev) ? dev : this.pluginUrl(plugin, plugin.manifest.main)
    wc.loadURL(url).catch((e) => this.log('error', `load ${plugin.id} failed`, e.message))
  }

  protected destroyView(plugin: PluginRuntime) {
    for (const w of plugin.windows.values()) if (!w.win.isDestroyed()) w.win.destroy()
    const wc = plugin.mainWc
    if (wc && !wc.isDestroyed()) {
      const win = BrowserWindow.fromWebContents(wc)
      if (win && !this.shell) win.destroy()
      else wc.close()
    }
  }

  /**
   * 无界面模式（自动化测试）：插件建的窗口照常显示（插件的可见性逻辑不变），但固定在屏幕外，
   * 不能移回屏幕、置顶、全屏或抢焦点，绝不出现在用户屏幕上
   */
  private installHeadlessGuards() {
    this.hooks.on('window:create', {
      apply: async (_c, next) => {
        const r = (await next()) as { url: string; options: Record<string, unknown> } | null
        return r && { ...r, options: { ...r.options, x: -30000, y: -30000, center: false, alwaysOnTop: false, fullscreen: false, kiosk: false, focusable: false, enableLargerThanScreen: true } }
      },
    })
    for (const m of ['focus', 'setAlwaysOnTop', 'setFullScreen', 'setSimpleFullScreen', 'setKiosk', 'setBounds', 'setContentBounds', 'setPosition', 'center', 'moveTop', 'setVisibleOnAllWorkspaces']) {
      this.hooks.on(`window:${m}`, { apply: () => undefined })
    }
  }

  protected hideWithoutPanel(plugin: PluginRuntime, kill: boolean) {
    if (!kill && plugin.mainWc && !plugin.mainWc.isDestroyed()) BrowserWindow.fromWebContents(plugin.mainWc)?.hide()
  }

  protected showWithoutPanel(plugin: PluginRuntime) {
    if (!plugin.mainWc || plugin.mainWc.isDestroyed()) return
    const win = BrowserWindow.fromWebContents(plugin.mainWc)
    if (!win) return
    // 自动化测试：放到屏幕外、不抢焦点，不在用户屏幕上出现
    if (process.env.WHATEVERTOOLS_HEADLESS) {
      win.setPosition(-30000, -30000)
      win.showInactive()
      return
    }
    win.show()
  }

  protected sendEvent(plugin: PluginRuntime, name: string, args: unknown[]) {
    const wc = plugin.mainWc
    if (wc && !wc.isDestroyed()) wc.send(CH.event, name, ...args)
  }

  protected sendRequest(plugin: PluginRuntime, id: string, name: string, args: unknown[]) {
    const wc = plugin.mainWc
    if (!wc || wc.isDestroyed()) throw new Error(`${name}：插件没有运行`)
    wc.send(CH.request, id, name, ...args)
    return wc.id
  }

  /** 发给任意视图的请求（自定义窗口里的工具调用等用主视图，这里保留按 webContents 发的版本） */
  requestTo<T = unknown>(wc: WebContents, name: string, args: unknown[], timeoutMs = 0): Promise<T> {
    const info = this.wcIndex.get(wc.id)
    if (!info) return Promise.reject(new Error('不是插件窗口'))
    return this.request<T>(info.plugin, name, args, timeoutMs)
  }

  // ---------- 视图配置 ----------

  /** 插件窗口统一的 webPreferences：preload 换成桥，插件自己的 preload 由桥加载；每个插件一个独立会话分区 */
  webPreferences(plugin: PluginRuntime, extra: Electron.WebPreferences = {}): Electron.WebPreferences {
    this.configureSession(plugin)
    return {
      backgroundThrottling: extra.backgroundThrottling,
      partition: this.partitionOf(plugin),
      preload: BRIDGE,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    }
  }

  /** 插件独立的会话分区：localStorage、IndexedDB、cookie、缓存互不可见 */
  partitionOf(plugin: PluginRuntime) {
    return `persist:wt-plugin-${plugin.id}`
  }

  private configuredSessions = new Set<string>()

  /** 插件页面发起的浏览器权限请求（摄像头、麦克风、定位……）映射到插件权限，而不是 Electron 默认的全部放行 */
  private configureSession(plugin: PluginRuntime) {
    const part = this.partitionOf(plugin)
    if (this.configuredSessions.has(part)) return
    this.configuredSessions.add(part)
    const ses = Session.fromPartition(part)
    const map = (permission: string, details?: { mediaTypes?: string[] }): string[] | null => {
      switch (permission) {
        case 'media': {
          const t = details?.mediaTypes ?? ['video', 'audio']
          return [...(t.includes('video') ? ['media.camera'] : []), ...(t.includes('audio') ? ['media.microphone'] : [])]
        }
        case 'geolocation': return ['geolocation']
        case 'notifications': return ['notification']
        case 'clipboard-read': return ['clipboard.read']
        case 'clipboard-sanitized-write': return ['clipboard.write']
        case 'display-capture': return ['screen.captureDisplay']
        case 'hid': case 'serial': case 'usb': case 'midi': case 'midiSysex': return ['device.hardware']
        case 'openExternal': return ['shell.external']
        case 'fullscreen': case 'pointerLock': case 'keyboardLock': return []
        default: return null
      }
    }
    ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
      const perms = map(permission, details as { mediaTypes?: string[] })
      if (perms === null) return cb(false)
      Promise.all(perms.map((p) => this.permit(plugin, p))).then(() => cb(true), () => cb(false))
    })
    ses.setPermissionCheckHandler((_wc, permission) => {
      const perms = map(permission)
      return perms !== null && perms.every((p) => plugin.perms.check(p) === 'grant')
    })
  }

  /** 插件里的相对地址 → 可加载的 URL */
  pluginUrl(plugin: PluginRuntime, rel: string): string {
    const [file, query] = rel.split(/(?=[?#])/)
    const abs = path.resolve(plugin.manifest.dir, file)
    if (!this.insideDir(plugin.manifest.dir, abs)) throw new Error(`地址超出插件目录：${rel}`)
    return pathToFileURL(abs).href + (query ?? '')
  }

  insideDir(dir: string, p: string) {
    const rel = path.relative(dir, p)
    return !rel.startsWith('..') && !path.isAbsolute(rel)
  }

  /** 窗口类型变化（分离 / 收回） */
  setWindowKind(wc: WebContents, kind: WindowKind) {
    const info = this.wcIndex.get(wc.id)
    if (info) info.kind = kind
  }

  register(wc: WebContents, plugin: PluginRuntime, kind: WindowKind, parentWcId?: number) {
    this.wcIndex.set(wc.id, { plugin, kind, parentWcId })
    // 插件页面的报错写进宿主日志（经过 log:plugin hook，可以转发到自己的日志系统）
    wc.on('console-message', (e: any) => {
      const level = e.level ?? ''
      if (level !== 'error' && level !== 3) return
      const entry = { plugin: plugin.id, kind, message: String(e.message ?? '').slice(0, 2000), source: e.sourceId, line: e.lineNumber }
      this.hooks.runApply('log:plugin', { plugin: plugin.id }, null, [entry], (a) => this.log('warn', `[${plugin.id}] ${(a[0] as typeof entry).message}`, a[0]))
    })
    this.guardNavigation(wc, plugin)
    wc.once('destroyed', () => this.wcIndex.delete(wc.id))
  }

  private guardNavigation(wc: WebContents, plugin: PluginRuntime) {
    const devOrigin = plugin.isDev && plugin.manifest.dev?.main ? safeOrigin(plugin.manifest.dev.main) : null
    const allowed = (url: string) => {
      if (url.startsWith('file:')) {
        try {
          return this.insideDir(plugin.manifest.dir, fileURLToPath(url.split(/[?#]/)[0]))
        } catch {
          return false
        }
      }
      return !!devOrigin && safeOrigin(url) === devOrigin
    }
    wc.on('will-navigate', (e, url) => {
      if (allowed(url)) return
      e.preventDefault()
      this.openExternalChecked(plugin, url)
    })
    wc.setWindowOpenHandler(({ url }) => {
      if (!allowed(url)) this.openExternalChecked(plugin, url)
      return { action: 'deny' }
    })
  }

  private async openExternalChecked(plugin: PluginRuntime, url: string) {
    if (!/^(https?|mailto):/i.test(url)) return
    try {
      await this.permit(plugin, 'shell.external', url)
      await eShell.openExternal(url)
    } catch (e: any) {
      this.log('warn', e.message)
    }
  }

  /** 注册一个流（只接受指定 webContents 推来的数据） */
  openStream(onData: (data: unknown) => void, wcId?: number): { id: string; close: () => void } {
    const id = crypto.randomUUID()
    this.streams.set(id, { wcId, onData })
    return { id, close: () => this.streams.delete(id) }
  }

  // ---------- 调用分发 ----------

  ctxOf(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): CallCtx {
    const info = this.wcIndex.get(e.sender.id)
    if (!info) throw new Error('调用方不是插件窗口')
    return { host: this, plugin: info.plugin, wc: e.sender, kind: info.kind, event: e }
  }

  parentOf(wc: WebContents): WebContents | null {
    const id = this.wcIndex.get(wc.id)?.parentWcId
    const p = id !== undefined ? WebContentsStatic.fromId(id) : undefined
    return p && !p.isDestroyed() ? p : null
  }

  async dispatch(c: CallCtx, method: string, args: unknown[]): Promise<unknown> {
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(this.handlers, method)) throw new Error(`[whatevertools] 不支持的 API：${method}`)
    const spec = API_MAP[method]
    // 不在规格表里的只能是登记过的内部方法（各自在实现里检查权限和归属）
    if (!spec && !INTERNAL_METHODS.has(method)) throw new Error(`[whatevertools] 不允许调用：${method}`)
    if (!Array.isArray(args)) args = []
    const handler = this.handlers[method]
    if (spec) {
      if (spec.windows && !spec.windows.includes(c.kind)) return false
      const perms = spec.permission ? (Array.isArray(spec.permission) ? spec.permission : [spec.permission]) : []
      try {
        for (const p of perms) await this.permit(c.plugin, p, spec.scopeArg !== undefined ? toScope(args[spec.scopeArg]) : undefined)
      } catch (e) {
        // 这些 API 约定用返回值报告失败（数据库返回错误结果，openPath 返回错误字符串）
        if ((e as { code?: string }).code === 'EWTPERM') {
          if (spec.group === 'db' && method !== 'db.onPull') return { id: typeof args[0] === 'object' ? (args[0] as { _id?: string })?._id : args[0], error: true, name: 'forbidden', message: (e as Error).message }
          if (method === 'shell.openPath') return (e as Error).message
        }
        throw e
      }
    }
    return this.hooks.runApply(`service:${method}`, { plugin: c.plugin.id }, c, args, (a) => handler(c, ...a))
  }

  private installIpc() {
    // 同一进程里重复创建宿主时先清掉旧的处理函数
    ipcMain.removeHandler(CH.call)
    for (const ch of [CH.context, CH.sync, CH.perm, CH.ready, CH.reply, CH.stream]) ipcMain.removeAllListeners(ch)
    ipcMain.on(CH.context, (e) => {
      const info = this.wcIndex.get(e.sender.id)
      if (!info) return void (e.returnValue = null)
      const { plugin, kind } = info
      const ctx: BridgeContext = {
        pluginId: plugin.id,
        manifest: plugin.manifest,
        identity: this.identityFor(plugin),
        windowKind: kind,
        preload: kind === 'main' ? (plugin.manifest.preload ? path.join(plugin.manifest.dir, plugin.manifest.preload) : undefined) : this.customPreloads.get(e.sender.id),
        apiName: this.options.apiName ?? 'whatevertools',
        compat: this.compatLayers.filter((c) => c.module && c.use.api !== false).map((c) => ({ module: c.module!, name: c.name })),
        paths: { dir: plugin.manifest.dir, data: plugin.dataDir, temp: plugin.tempDir },
        grants: this.permissions.cacheable(plugin.id),
        isDev: plugin.isDev,
        rendererHooks: this.options.rendererHooks ?? [],
        ffmpegPath: this.options.ffmpegPath,
        unsupported: this.options.unsupported ?? 'throw',
      }
      e.returnValue = ctx
    })
    ipcMain.on(CH.sync, (e, method: string, args: unknown[]) => {
      let c: CallCtx
      try {
        c = this.ctxOf(e)
      } catch (err) {
        return void (e.returnValue = { error: wireError(err) })
      }
      this.dispatch(c, method, args).then(
        (value) => setReturn(e, { value }),
        (err) => setReturn(e, { error: wireError(err) }),
      )
    })
    ipcMain.handle(CH.call, async (e, method: string, args: unknown[]) => {
      try {
        return { value: await this.dispatch(this.ctxOf(e), method, args) }
      } catch (err) {
        return { error: wireError(err) }
      }
    })
    ipcMain.on(CH.perm, (e, permission: string, scope?: string) => {
      let c: CallCtx
      try {
        c = this.ctxOf(e)
      } catch {
        return void (e.returnValue = { decision: 'deny', cacheable: false } satisfies PermResult)
      }
      this.permit(c.plugin, permission, scope).then(
        () => (e.returnValue = { decision: 'grant', cacheable: c.plugin.perms.check(permission) === 'grant' && !scope } satisfies PermResult),
        () => (e.returnValue = { decision: 'deny', cacheable: false } satisfies PermResult),
      )
    })
    ipcMain.on(CH.ready, (e) => {
      const info = this.wcIndex.get(e.sender.id)
      if (info && info.kind === 'main') info.plugin.markReady()
    })
    // 只接受发出请求的那个窗口的回复（视图标识就是 webContents id）
    ipcMain.on(CH.reply, (e, id: string, ok: boolean, value: unknown) => this.resolveReply(e.sender.id, id, ok, value))
    ipcMain.on(CH.stream, (e, id: string, data: unknown) => {
      if (id === '__tool' || id === '__listen') {
        const info = this.wcIndex.get(e.sender.id)
        if (!info || info.kind !== 'main') return
        if (id === '__tool') info.plugin.addTool(String(data))
        else info.plugin.listening.add(String(data))
        return
      }
      const st = this.streams.get(id)
      if (st && (st.wcId === undefined || st.wcId === e.sender.id)) st.onData(data)
    })
  }

}

/** 解析兼容层配置：模块路径在宿主应用里解析（宿主包本身不依赖任何兼容层） */
function resolveCompat(c: CompatLayer) {
  const cfg: CompatLayerConfig = 'type' in c ? { module: '@whatevertools/compat-utools', name: c.name } : c
  let module = cfg.module
  let layer = cfg.layer
  if (module && !layer) {
    const paths = [process.cwd(), app.getAppPath(), __dirname]
    module = require.resolve(module, { paths })
    layer = require(module).compat as CompatLayerDescriptor
    if (!layer) throw new Error(`兼容层模块没有导出 compat：${cfg.module}`)
  } else if (module) module = require.resolve(module, { paths: [process.cwd(), app.getAppPath(), __dirname] })
  if (!layer) throw new Error('兼容层配置需要 module 或 layer')
  return { layer, module, name: cfg.name ?? layer.defaultName, use: cfg.use ?? {} }
}

/** 用户主动给出的输入来源：只有这些来源带来的文件才临时授予读取 */
const USER_INTENT_SOURCES = new Set(['main', 'panel', 'hotkey', 'tray', 'standalone', 'notification', 'url-scheme', 'drop', 'paste'])

/** 不在规格表里、但允许渲染进程调用的内部方法（实现里各自检查权限 / 归属） */
const INTERNAL_METHODS = new Set(['__win', '__clipboard', '__ubrowserRun', '__aiAbort', '__ffmpegPath', 'window.type'])

/** sendSync 的返回值必须能结构化克隆，否则渲染进程会一直卡住 */
function setReturn(e: Electron.IpcMainEvent, v: unknown) {
  try {
    e.returnValue = v
  } catch (err) {
    e.returnValue = { error: { message: `[whatevertools] 返回值无法跨进程传递：${(err as Error).message}` } }
  }
}

function safeOrigin(u: string) {
  try {
    return new URL(u).origin
  } catch {
    return null
  }
}

function toScope(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  // 非字符串作用域：返回空串，带作用域的授权会因此询问而不是放行
  return v === undefined ? undefined : ''
}

/** 网址授予主机名 */
function scopeHost(scope: string): string {
  try {
    return new URL(scope).hostname || scope
  } catch {
    return scope
  }
}

export function wireError(err: unknown): WireError {
  if (err && typeof err === 'object') {
    const e = err as any
    return { message: String(e.message ?? e), code: e.code, name: e.name, data: e.data }
  }
  return { message: String(err) }
}

async function defaultPrompt(req: PermissionPromptRequest): Promise<PermissionPromptAnswer> {
  const info = PERMISSION_MAP[req.permission]
  const title = info ? info.title : req.permission
  const detail = [
    info?.description,
    req.scope ? `范围：${req.scope}` : '',
    req.reason ? `插件说明：${req.reason}` : '',
    `权限 id：${req.permission}`,
  ].filter(Boolean).join('\n')
  const { response } = await dialog.showMessageBox({
    type: info?.risk === 'high' ? 'warning' : 'question',
    title: '权限请求',
    message: `「${req.plugin.manifest.name}」想要使用：${title}`,
    detail,
    buttons: ['始终允许', '仅本次', '禁止', '以后再说'],
    defaultId: 1,
    cancelId: 3,
    noLink: true,
  })
  return (['always', 'once', 'block', 'dismiss'] as const)[response]
}

