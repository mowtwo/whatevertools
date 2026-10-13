// 应用入口：启动器（多个插件）和独立应用（单个插件）都用它
import fs from 'node:fs'
import path from 'node:path'
import { app, globalShortcut, Menu, nativeImage, Tray } from 'electron'
import { WhateverToolsHost, type HostOptions } from './host'
import { WindowShell } from './shell'
import type { PluginRuntime } from './plugin'

export interface AppConfig extends Omit<HostOptions, 'shell'> {
  mode: 'launcher' | 'standalone'
  /** 插件目录（plugin.json 所在目录） */
  plugins: string[]
  /** launcher：主面板快捷键（等同 sourceOptions.main.accelerator） */
  hotkey?: string
  /** 托盘图标（默认开启） */
  tray?: boolean
  /** standalone：启动时进入的功能（默认 whatevertools.json 的 standalone.startFeature，否则第一个有功能指令的功能） */
  startFeature?: string
  /** 应用名（菜单、托盘提示） */
  appName?: string
  /**
   * URL scheme（如 whatevertools）：注册为系统的协议处理程序，scheme://open/<插件 id>/<功能 code>?text=… 进入功能，
   * scheme://search?text=… 打开主面板搜索。注册会修改系统设置，所以只有显式配置时才注册
   */
  urlScheme?: string
  /** 配置文件路径：设置页里添加 / 移除插件目录时写回这里 */
  configFile?: string
}

function firstTextFeature(p: PluginRuntime) {
  for (const f of p.allFeatures()) {
    const label = f.cmds.find((c) => typeof c === 'string') as string | undefined
    if (label) return { code: f.code, label, hidePanel: !!f.hidePanel }
  }
  return null
}

export async function runApp(cfg: AppConfig): Promise<{ host: WhateverToolsHost; shell: WindowShell }> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return new Promise(() => {})
  }
  await app.whenReady()
  app.on('before-quit', () => ((global as any).__whatevertoolsQuitting = true))
  const appName = cfg.appName ?? cfg.identity?.host?.name ?? 'whatevertools'
  const shell = new WindowShell({ mode: cfg.mode, title: appName })
  const sourceOptions = { ...cfg.sourceOptions }
  if (cfg.hotkey) sourceOptions.main = { ...sourceOptions.main, accelerator: cfg.hotkey }
  // 独立应用没有主面板和超级面板，只保留指令快捷键和插件跳转
  const standaloneDefaults = cfg.mode === 'standalone' && cfg.entrySources === undefined
  const install = cfg.install ?? { enabled: cfg.mode === 'launcher' }
  const host = new WhateverToolsHost({ ...cfg, install, shell, sourceOptions, entrySources: standaloneDefaults ? false : cfg.entrySources })
  if (standaloneDefaults) {
    for (const c of host.compatLayers) for (const s of c.layer.sources ?? []) if (s.id === 'hotkey' || s.id === 'redirect') host.sources.register(s)
  }
  shell.bind(host)
  const loaded: PluginRuntime[] = []
  for (const dir of cfg.plugins) {
    try {
      // 直接给的插件包（.upx / .asar / .zip）：解到临时目录运行，不安装
      if (fs.statSync(dir).isFile()) loaded.push(await host.installer.install(dir, { temporary: true }))
      else loaded.push(host.loadPlugin(dir))
    } catch (e: any) {
      host.log('error', `加载插件失败：${dir}`, e.message)
    }
  }
  if (install.enabled !== false) loaded.push(...host.installer.loadAll())
  if (cfg.mcp?.enabled) {
    try {
      await host.mcp.start(cfg.mcp.port, cfg.mcp.host)
    } catch (e: any) {
      host.log('warn', `MCP 服务启动失败：${e.message}`)
    }
  }
  app.on('second-instance', () => shell.toggle())
  app.on('window-all-closed', () => {
    /* 插件可能在后台运行（如桌面挂件），不退出 */
  })
  app.on('will-quit', () => {
    host.sources.dispose()
    globalShortcut.unregisterAll()
  })

  const enterText = (p: PluginRuntime, code: string, label: string, from: 'tray' | 'standalone') =>
    host.sources.context(from).enter({ pluginId: p.id, code, type: 'text', payload: label }).catch((e) => host.log('error', e.message))

  if (cfg.mode === 'standalone') {
    const p = loaded[0]
    if (!p) throw new Error('standalone 模式需要一个插件')
    const sa = p.manifest.standalone
    // whatevertools.json 里声明的快捷键放进指令快捷键表（不覆盖用户改过的）
    for (const [code, accel] of Object.entries(sa.shortcuts ?? {})) {
      const f = p.allFeatures().find((x) => x.code === code)
      const label = f?.cmds.find((c) => typeof c === 'string') as string | undefined
      if (f && label && !host.hotkeys.get(p.id, label)) host.hotkeys.set(p.id, label, accel, false, false)
    }
    const start = cfg.startFeature ?? sa.startFeature
    const f = start ? p.allFeatures().find((x) => x.code === start) : undefined
    const label = f?.cmds.find((c) => typeof c === 'string') as string | undefined
    const target = f && label ? { code: f.code, label } : firstTextFeature(p)
    if (target) await enterText(p, target.code, target.label, 'standalone')
    app.on('activate', () => target && void enterText(p, target.code, target.label, 'standalone'))
  } else if (process.platform === 'darwin') app.dock?.hide()
  // URL scheme：深链也是一个入口来源（url-scheme）
  if (cfg.urlScheme) {
    const scheme = cfg.urlScheme
    if (!app.isDefaultProtocolClient(scheme)) app.setAsDefaultProtocolClient(scheme)
    let ctx: import('@whatevertools/core').SourceContext | null = null
    host.sources.register({ id: 'url-scheme', title: 'URL Scheme', setup: (c) => void (ctx = c) })
    const open = (raw: string) => {
      let u: URL
      try {
        u = new URL(raw)
      } catch {
        return
      }
      if (u.protocol !== `${scheme}:` || !ctx) return
      const text = u.searchParams.get('text') ?? undefined
      const [, pluginId, code] = u.pathname.replace(/^\/+/, '').split('/')
      if (u.hostname === 'open' && pluginId && code) {
        const p = host.plugins.get(pluginId)
        const f = p?.allFeatures().find((x) => x.code === code)
        const label = f?.cmds.find((c) => typeof c === 'string') as string | undefined
        if (p && f) void ctx.enter({ pluginId, code, type: text ? 'over' : 'text', payload: text ?? label ?? code }).catch((e) => host.log('warn', e.message))
      } else if (u.hostname === 'search') shell.showMain(text !== undefined ? { text } : undefined)
    }
    app.on('open-url', (e, url) => (e.preventDefault(), open(url)))
    app.on('second-instance', (_e, argv) => argv.filter((a) => a.startsWith(`${scheme}:`)).forEach(open))
    process.argv.filter((a) => a.startsWith(`${scheme}:`)).forEach(open)
  }
  host.startSources()
  // 设置页：添加 / 移除插件目录（写回配置文件）
  shell.setPluginManager({
    list: () => {
      const installed = new Set(host.installer.list().map((r) => r.id))
      return [...host.plugins.values()].map((p) => ({ id: p.id, name: p.manifest.name, dir: p.manifest.dir, installed: installed.has(p.id) }))
    },
    install: install.enabled === false ? undefined : async () => {
      const { dialog } = require('electron')
      const r = await dialog.showOpenDialog({ title: '选择插件包', filters: [{ name: '插件包', extensions: ['upx', 'asar', 'zip'] }], properties: ['openFile'] })
      if (r.canceled || !r.filePaths[0]) return null
      return (await host.installer.install(r.filePaths[0])).id
    },
    add: async () => {
      const { dialog } = require('electron')
      const r = await dialog.showOpenDialog({ title: '选择插件目录（包含 plugin.json 或 whatevertools.json）', properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      const p = host.loadPlugin(r.filePaths[0])
      persistPlugins()
      return p.id
    },
    remove: (id: string) => {
      if (host.installer.list().some((r) => r.id === id)) return host.installer.uninstall(id)
      host.unloadPlugin(id)
      persistPlugins()
    },
  })
  function persistPlugins() {
    if (!cfg.configFile) return
    let raw: Record<string, unknown> = {}
    try {
      raw = JSON.parse(fs.readFileSync(cfg.configFile, 'utf8'))
    } catch {}
    const installed = new Set(host.installer.list().map((r) => r.id))
    raw.plugins = [...host.plugins.values()].filter((p) => !installed.has(p.id) && !p.manifest.dir.startsWith(require('node:os').tmpdir())).map((p) => p.manifest.dir)
    fs.mkdirSync(path.dirname(cfg.configFile), { recursive: true })
    fs.writeFileSync(cfg.configFile, JSON.stringify(raw, null, 2))
  }

  if (cfg.tray !== false) {
    const logo = loaded[0]?.manifest.logo ? path.join(loaded[0].manifest.dir, loaded[0].manifest.logo) : ''
    const icon = logo && fs.existsSync(logo) ? nativeImage.createFromPath(logo).resize({ width: 18, height: 18 }) : nativeImage.createEmpty()
    const tray = new Tray(icon)
    // 保持引用，否则托盘会被垃圾回收后消失
    ;(host as any).__tray = tray
    tray.setToolTip(appName)
    const build = () => {
      const items: Electron.MenuItemConstructorOptions[] = []
      if (cfg.mode === 'launcher') items.push({ label: `打开启动器（${cfg.hotkey ?? 'Alt+Shift+Space'}）`, click: () => shell.toggle() }, { type: 'separator' })
      for (const p of host.plugins.values()) {
        const feats = p.allFeatures().map((f) => ({ f, label: f.cmds.find((c) => typeof c === 'string') as string | undefined })).filter((x) => x.label)
        const sub = feats.map(({ f, label }) => ({ label: label!, click: () => void enterText(p, f.code, label!, 'tray') }))
        if (cfg.mode === 'standalone') items.push(...sub)
        else items.push({ label: p.manifest.name, submenu: sub })
      }
      items.push({ type: 'separator' })
      const devItems = [...host.plugins.values()].filter((p) => p.alive).map((p) => ({ label: p.manifest.name, click: () => host.openDevTools(p) }))
      if (devItems.length) items.push({ label: '开发者工具', submenu: devItems })
      items.push({ label: '插件权限与快捷键…', click: () => shell.openSettings() }, { label: '退出', click: () => app.quit() })
      // 托盘菜单经过 tray:menu hook，宿主可以增删菜单项
      const final = host.hooks.runApply('tray:menu', {}, null, [items], (a) => a[0]) as Electron.MenuItemConstructorOptions[]
      return Menu.buildFromTemplate(final)
    }
    // 每次打开前重建，插件运行状态变化后菜单也是新的
    tray.setContextMenu(build())
    tray.on('right-click', () => tray.setContextMenu(build()))
    if (process.platform === 'darwin') tray.on('mouse-enter', () => tray.setContextMenu(build()))
    else tray.on('click', () => shell.toggle())
  }
  return { host, shell }
}
