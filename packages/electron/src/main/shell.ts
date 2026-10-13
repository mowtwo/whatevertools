// 界面外壳：一个窗口，顶部是搜索框 / 子输入框，下面嵌入插件主界面（WebContentsView）。
// launcher 模式可以搜索所有插件；standalone 模式只承载一个插件（独立打包的应用）。
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, ipcMain, screen, WebContentsView, type WebContents } from 'electron'
import { PERMISSIONS, type EntryInput, type MatchResult } from '@whatevertools/core'
import type { WhateverToolsHost } from './host'
import type { PluginRuntime } from './plugin'
import type { Shell } from './types'

const ASSETS = path.join(__dirname, '..', '..', 'assets')

import { activeWindow } from './services/context'

const HEADER = 56
const WIDTH = 800

export interface WindowShellOptions {
  mode: 'launcher' | 'standalone'
  /** 窗口标题（standalone 用插件名） */
  title?: string
  /** 失焦时隐藏（launcher 默认 true） */
  hideOnBlur?: boolean
  placeholder?: string
}

export class WindowShell implements Shell {
  win: BrowserWindow
  host!: WhateverToolsHost
  private views = new Map<string, WebContentsView>()
  private heights = new Map<string, number>()
  private active: PluginRuntime | null = null
  private results: MatchResult[] = []
  /** 打开主面板前的前台窗口（window 入口类型的输入） */
  private activeWindow: Record<string, unknown> | null = null
  /** 搜索结果里由插件推送（onSearchPush）的条目：下标 → 推送内容 */
  private pushed = new Map<number, { text: string; title?: string; icon?: string }>()
  private listHeight = HEADER
  private settingsWin: BrowserWindow | null = null

  constructor(readonly opts: WindowShellOptions) {
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEADER,
      show: false,
      frame: opts.mode === 'standalone',
      title: opts.title ?? 'whatevertools',
      resizable: opts.mode === 'standalone',
      minimizable: opts.mode === 'standalone',
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: opts.mode === 'launcher',
      alwaysOnTop: opts.mode === 'launcher',
      useContentSize: true,
      webPreferences: { preload: path.join(ASSETS, 'shell-preload.js'), contextIsolation: true, sandbox: true },
    })
    this.win.loadFile(path.join(ASSETS, 'shell.html'))
    if ((opts.hideOnBlur ?? opts.mode === 'launcher') && !process.env.WHATEVERTOOLS_HEADLESS) this.win.on('blur', () => {
      // 插件弹出的对话框会让外壳失焦，这时不隐藏
      if (!this.win.webContents.isDevToolsOpened() && !BrowserWindow.getFocusedWindow()) this.hideWindow()
    })
    this.win.on('close', (e) => {
      // 关闭窗口只是隐藏，插件留在后台；退出走托盘或 app.quit
      if (!(global as any).__whatevertoolsQuitting) {
        e.preventDefault()
        this.hideWindow()
      }
    })
    this.win.on('resize', () => this.layout())
  }

  bind(host: WhateverToolsHost) {
    this.host = host
    for (const ch of ['whatevertools-shell:query', 'whatevertools-shell:query-input', 'whatevertools-settings:load', 'whatevertools-settings:set', 'whatevertools-settings:reset', 'whatevertools-settings:hotkey', 'whatevertools-settings:copy-mcp', 'whatevertools-settings:plugins', 'whatevertools-settings:plugin-add', 'whatevertools-settings:plugin-remove']) ipcMain.removeHandler(ch)
    const own = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => e.sender === this.win.webContents
    ipcMain.handle('whatevertools-shell:query', (e, text: string) => (own(e) ? this.query({ text }) : []))
    ipcMain.handle('whatevertools-shell:query-input', (e, input: { files?: Array<{ path: string; name: string }>; image?: string }) => {
      if (!own(e)) return []
      const fs = require('node:fs')
      const files = input.files?.map((f) => {
        const st = fs.statSync(f.path, { throwIfNoEntry: false })
        return { path: f.path, name: f.name, isFile: !!st?.isFile(), isDirectory: !!st?.isDirectory() }
      })
      return this.query({ files, image: input.image })
    })
    ipcMain.on('whatevertools-shell:choose', (e, i: number) => own(e) && this.choose(i))
    ipcMain.on('whatevertools-shell:input', (e, text: string) => {
      if (!own(e) || !this.active) return
      if (this.active.panelInput) this.active.panelInput.value = text
      this.host.emit(this.active, 'panel.input', { text })
    })
    ipcMain.on('whatevertools-shell:escape', (e) => own(e) && this.escape())
    ipcMain.on('whatevertools-shell:height', (e, h: number) => {
      if (!own(e) || this.active) return
      this.listHeight = Math.max(HEADER, Math.min(600, Math.round(h)))
      this.resize(this.listHeight)
    })
    ipcMain.on('whatevertools-shell:settings', (e) => own(e) && this.host.panel('openSettings', null))
    ipcMain.on('whatevertools-shell:detach', (e) => own(e) && this.active && this.host.panel('detach', this.active))
    ipcMain.on('whatevertools-shell:devtools', (e) => own(e) && this.active && this.host.openDevTools(this.active))
    this.installSettingsIpc()
    this.win.webContents.on('did-finish-load', () => this.push({ reset: true }))
  }

  // ---------- 搜索 ----------

  private querySeq = 0

  private async query(input: EntryInput) {
    // 只有最新一次查询的结果算数，否则 choose(i) 可能打开旧列表里的功能
    const seq = ++this.querySeq
    if (!input.text && !input.files && !input.image && !input.window) {
      this.results = []
      this.pushed.clear()
      return []
    }
    if (this.activeWindow) input = { ...input, window: this.activeWindow }
    const matched = this.host.emitFrom('main', input)
    // searchPush 功能：让正在运行的插件推送动态结果（最多等 300ms）
    const pushes = await Promise.all(
      matched.map(async (r) => {
        const p = this.host.plugins.get(r.pluginId)
        const f = p?.allFeatures().find((x) => x.code === r.code)
        if (!p || !f?.searchPush || !p.mainWc || !p.ready) return []
        try {
          const items = await Promise.race([
            this.host.request<Array<{ text: string; title?: string; icon?: string }>>(p, 'searchPush', [{ code: r.code, type: r.type, payload: r.payload }]),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 300)),
          ])
          return (Array.isArray(items) ? items : []).slice(0, 10).map((item) => ({ r, item }))
        } catch {
          return []
        }
      }),
    )
    if (seq !== this.querySeq) return []
    this.pushed.clear()
    const rows: Array<{ r: MatchResult; item?: { text: string; title?: string; icon?: string } }> = []
    matched.forEach((r, i) => {
      rows.push(...pushes[i])
      rows.push({ r })
    })
    this.results = rows.map((x) => x.r)
    rows.forEach((x, i) => x.item && this.pushed.set(i, x.item))
    return rows.map(({ r, item }) => {
      const p = this.host.plugins.get(r.pluginId)!
      const icon = item?.icon ? pathToFileURL(path.join(p.manifest.dir, item.icon)).href : this.logoUrl(p)
      return { label: item ? item.text : r.label, type: item ? 'push' : r.type, pluginName: p.manifest.name + (item ? ` · ${r.label}` : ''), logo: icon }
    })
  }

  private picking: ((i: number | undefined) => void) | null = null

  private choose(i: number) {
    if (this.picking) {
      const done = this.picking
      this.picking = null
      done(this.results[i] ? i : undefined)
      return
    }
    const r = this.results[i]
    if (!r) return
    const push = this.pushed.get(i)
    if (push) {
      // 推送条目：交给插件的 onSelect，返回 true 才进入插件
      const p = this.host.plugins.get(r.pluginId)
      if (!p?.mainWc) return
      const action = { code: r.code, type: r.type, payload: r.payload, from: 'main', option: { text: push.text } }
      this.host.request<boolean>(p, 'searchPush.select', [action]).then(
        (ok) => {
          if (ok === true) return this.host.sources.context('main').enter({ pluginId: r.pluginId, code: r.code, type: r.type, payload: r.payload, option: { text: push.text } })
          this.hideWindow()
        },
        (e) => this.host.log('warn', `onSearchPush 选择处理出错：${e.message}`),
      ).catch((e) => this.host.log('warn', e.message))
      return
    }
    this.host.sources
      .context('main')
      .enter({ pluginId: r.pluginId, code: r.code, type: r.type, payload: r.payload })
      .catch((e) => this.host.log('error', e.message))
  }

  /** 候选面板（超级面板等）：在光标附近弹出外壳，只显示给定结果 */
  pick(results: MatchResult[], opts: { title?: string } = {}): Promise<number | undefined> {
    if (this.active) this.host.out(this.active, false)
    this.picking?.(undefined)
    this.results = results
    const rows = results.map((r) => {
      const p = this.host.plugins.get(r.pluginId)!
      return { label: r.label, type: r.type, pluginName: p.manifest.name, logo: this.logoUrl(p) }
    })
    const pt = screen.getCursorScreenPoint()
    const d = screen.getDisplayNearestPoint(pt)
    const h = HEADER + Math.min(8, rows.length) * 48 + 8
    this.win.setContentSize(WIDTH, h)
    const x = Math.min(Math.max(d.workArea.x, pt.x - 40), d.workArea.x + d.workArea.width - WIDTH)
    const y = Math.min(Math.max(d.workArea.y, pt.y + 12), d.workArea.y + d.workArea.height - h)
    if (process.env.WHATEVERTOOLS_HEADLESS) {
      this.win.setPosition(-20000, -20000)
      this.win.showInactive()
    } else {
      this.win.setPosition(Math.round(x), Math.round(y))
      this.win.show()
      this.win.focus()
    }
    this.push({ pick: { title: opts.title ?? '', results: rows } })
    return new Promise((resolve) => (this.picking = resolve))
  }

  showMain(input?: Record<string, unknown>) {
    if (this.win.isVisible() && this.win.isFocused() && !input) return this.hideWindow()
    // 先记下前台窗口，再显示主面板（显示后前台就变成自己了）
    this.activeWindow = null
    activeWindow(this.host).then((w) => {
      this.activeWindow = w
      if (w && !this.active) {
        const rows = this.host.emitFrom('main', { window: w })
        if (rows.length) void this.query({ window: w }).then((list) => this.push({ windowMatches: list }))
      }
    })
    this.showWindow()
    this.push({ focusInput: true, selectInput: true, prefill: typeof input?.text === 'string' ? input.text : undefined })
  }

  private escape() {
    if (this.picking) {
      const done = this.picking
      this.picking = null
      done(undefined)
      this.hideWindow()
      return
    }
    if (this.active && this.opts.mode === 'launcher') {
      this.host.out(this.active, false)
      return
    }
    this.hideWindow()
  }

  private logoUrl(p: PluginRuntime) {
    return p.manifest.logo ? pathToFileURL(path.join(p.manifest.dir, p.manifest.logo)).href : ''
  }

  /** 窗口已经销毁（应用退出中）时，所有界面操作都跳过 */
  private get gone() {
    return this.win.isDestroyed() || this.win.webContents.isDestroyed()
  }

  private push(extra: Record<string, unknown> = {}) {
    if (this.gone) return
    const a = this.active
    this.win.webContents.send('whatevertools-shell:state', {
      mode: this.opts.mode,
      placeholder: this.opts.placeholder,
      active: a ? { pluginId: a.id, name: a.manifest.name, logo: this.logoUrl(a), panelInput: a.panelInput } : null,
      ...extra,
    })
  }

  // ---------- 布局 ----------

  private resize(contentHeight: number) {
    if (this.gone || this.opts.mode === 'standalone') return
    const [w] = this.win.getContentSize()
    this.win.setContentSize(w, contentHeight)
  }

  private layout() {
    const a = this.active
    if (!a || this.gone) return
    const view = this.views.get(a.id)
    if (!view) return
    const [w, h] = this.win.getContentSize()
    const top = this.opts.mode === 'standalone' && !a.panelInput ? 0 : HEADER
    view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) })
  }

  private showWindow() {
    // 自动化测试：窗口放在屏幕外、不抢焦点
    if (process.env.WHATEVERTOOLS_HEADLESS) {
      this.win.setPosition(-20000, -20000)
      this.win.showInactive()
      return
    }
    if (this.opts.mode === 'launcher' && !this.win.isVisible()) {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const [w, h] = this.win.getSize()
      this.win.setPosition(Math.round(d.workArea.x + (d.workArea.width - w) / 2), Math.round(d.workArea.y + d.workArea.height * 0.2))
      void h
    }
    this.win.show()
    this.win.focus()
  }

  hideWindow() {
    if (this.win.isDestroyed()) return
    if (this.picking) {
      const done = this.picking
      this.picking = null
      done(undefined)
    }
    this.win.hide()
  }

  /** 显示 / 隐藏主面板 */
  toggle() {
    this.showMain()
  }

  // ---------- Shell 接口 ----------

  attach(plugin: PluginRuntime, webPreferences: Electron.WebPreferences): WebContents {
    const view = new WebContentsView({ webPreferences })
    view.setBackgroundColor('#00000000')
    this.views.set(plugin.id, view)
    view.webContents.once('destroyed', () => {
      if (this.views.get(plugin.id) === view) this.views.delete(plugin.id)
      if (this.active === plugin) {
        this.active = null
        this.resize(HEADER)
        this.push({ reset: true })
      }
    })
    return view.webContents
  }

  show(plugin: PluginRuntime) {
    const view = this.views.get(plugin.id)
    if (!view || this.gone) return
    const dw = this.detached.get(plugin.id)
    if (dw && !dw.isDestroyed()) {
      dw.show()
      dw.focus()
      return
    }
    if (this.active && this.active !== plugin) {
      this.host.emit(this.active, 'leave', false)
      this.detachPlugin(this.active, false, true)
    }
    this.active = plugin
    this.win.contentView.addChildView(view)
    const height = this.heights.get(plugin.id) ?? plugin.manifest.panel.height
    if (this.opts.mode === 'launcher') this.resize(HEADER + height)
    else if (!this.win.isVisible()) {
      const [w] = this.win.getContentSize()
      this.win.setContentSize(Math.max(w, WIDTH), (plugin.panelInput ? HEADER : 0) + height)
    }
    this.layout()
    this.showWindow()
    this.push({ focusInput: !!plugin.panelInput })
    if (!plugin.panelInput) view.webContents.focus()
  }

  hide(_plugin: PluginRuntime) {
    this.hideWindow()
  }

  detachPlugin(plugin: PluginRuntime, kill: boolean, switching = false) {
    // 插件在分离窗口里：退出时一起隐藏 / 关闭分离窗口
    const dw = this.detached.get(plugin.id)
    if (dw && !dw.isDestroyed()) {
      if (kill) {
        this.detached.delete(plugin.id)
        dw.destroy()
      } else dw.hide()
    }
    const view = this.views.get(plugin.id)
    if (view) {
      try {
        if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
      } catch {}
      if (kill && !view.webContents.isDestroyed()) view.webContents.close()
    }
    if (this.active === plugin) {
      this.active = null
      plugin.panelInput = null
      if (!switching) {
        if (!this.gone) {
          this.resize(this.opts.mode === 'launcher' ? HEADER : this.win.getContentSize()[1])
          this.push({ reset: true })
        }
      }
    }
  }

  setExpandHeight(plugin: PluginRuntime, height: number) {
    this.heights.set(plugin.id, Math.max(1, Math.round(height)))
    if (this.active === plugin && this.opts.mode === 'launcher') {
      this.resize(HEADER + this.heights.get(plugin.id)!)
      this.layout()
    }
    return true
  }

  input = {
    set: (plugin: PluginRuntime, _placeholder: string, focus: boolean) => {
      if (this.active === plugin) {
        this.layout()
        this.push({ focusInput: focus })
      }
      return true
    },
    remove: (plugin: PluginRuntime) => {
      if (this.active === plugin) {
        this.layout()
        this.push()
      }
      return true
    },
    setValue: (plugin: PluginRuntime) => (this.active === plugin && this.push(), true),
    focus: (plugin: PluginRuntime) => (this.active === plugin && this.push({ focusInput: true }), true),
    blur: (plugin: PluginRuntime) => {
      if (this.active === plugin) this.push({ blurInput: true })
    },
    select: (plugin: PluginRuntime) => (this.active === plugin && this.push({ focusInput: true, selectInput: true }), true),
  }

  windowOf(plugin: PluginRuntime) {
    const dw = this.detached.get(plugin.id)
    return dw && !dw.isDestroyed() ? dw : this.win
  }

  openHotkeySetting(plugin: PluginRuntime, cmdLabel: string) {
    this.openSettings(`${plugin.id}\u0000${cmdLabel}`)
  }

  async chooseFeature(candidates: Array<{ pluginId: string; code: string; label: string }>) {
    const { dialog } = require('electron')
    const { response } = await dialog.showMessageBox(this.win, {
      message: '选择要打开的功能',
      buttons: [...candidates.map((c) => `${this.host.plugins.get(c.pluginId)?.manifest.name ?? c.pluginId} · ${c.label}`), '取消'],
      cancelId: candidates.length,
    })
    return response < candidates.length ? response : undefined
  }

  // ---------- 分离窗口 ----------

  private detached = new Map<string, BrowserWindow>()

  /** 把插件主界面移到独立窗口（触发 lifecycle.onDetach，window.type 变成 detach） */
  detach(plugin: PluginRuntime) {
    const view = this.views.get(plugin.id)
    if (!view || this.detached.has(plugin.id)) return
    const [w, h] = this.win.getContentSize()
    const top = plugin.panelInput ? HEADER : 0
    this.detachPlugin(plugin, false)
    this.hideWindow()
    const dw = new BrowserWindow({ width: w, height: Math.max(200, h - HEADER), title: plugin.manifest.name, show: false, useContentSize: true })
    dw.contentView.addChildView(view)
    const layout = () => {
      const [cw, ch] = dw.getContentSize()
      view.setBounds({ x: 0, y: 0, width: cw, height: ch })
    }
    layout()
    void top
    dw.on('resize', layout)
    dw.once('ready-to-show', () => dw.show())
    dw.show()
    this.detached.set(plugin.id, dw)
    this.host.setWindowKind(view.webContents, 'detach')
    this.host.emit(plugin, 'detach')
    dw.on('closed', () => {
      this.detached.delete(plugin.id)
      if (!view.webContents.isDestroyed()) {
        // 关掉分离窗口：插件回到后台
        this.host.setWindowKind(view.webContents, 'main')
        this.host.emit(plugin, 'leave', false)
      }
    })
  }

  // ---------- 插件管理（设置页） ----------

  private pluginManager: { list(): Array<{ id: string; name: string; dir: string; installed?: boolean }>; add(): Promise<string | null>; install?(): Promise<string | null>; remove(id: string): void } | null = null

  setPluginManager(m: NonNullable<WindowShell['pluginManager']>) {
    this.pluginManager = m
  }

  // ---------- 权限设置页 ----------

  openSettings(focus?: string) {
    if (this.settingsWin && !this.settingsWin.isDestroyed()) {
      if (focus) this.settingsWin.webContents.send('whatevertools-settings:focus', focus)
      return this.settingsWin.focus()
    }
    this.settingsWin = new BrowserWindow({
      width: 820, height: 680, title: '插件权限',
      webPreferences: { preload: path.join(ASSETS, 'settings-preload.js'), contextIsolation: true, sandbox: true },
    })
    this.settingsWin.loadFile(path.join(ASSETS, 'settings.html'), focus ? { hash: encodeURIComponent(focus) } : undefined)
  }

  private installSettingsIpc() {
    const own = (e: Electron.IpcMainInvokeEvent) => !!this.settingsWin && !this.settingsWin.isDestroyed() && e.sender === this.settingsWin.webContents
    ipcMain.handle('whatevertools-settings:load', (e) => {
      if (!own(e)) return []
      return [...this.host.plugins.values()].map((p) => {
        const snap = p.perms.snapshot()
        const cmds = p.allFeatures().flatMap((f) => f.cmds.map((c) => (typeof c === 'string' ? c : c.label)))
        return {
          id: p.id, name: p.manifest.name, version: p.manifest.version, legacy: p.manifest.format !== 'native', logo: this.logoUrl(p),
          perms: PERMISSIONS.map((info) => ({ ...info, decision: snap[info.id].decision, scopes: snap[info.id].scopes })),
          hotkeys: [...new Set(cmds)].map((label) => {
            const h = this.host.hotkeys.list().find((x) => x.pluginId === p.id && x.label === label)
            return { label, accelerator: h?.accelerator ?? '', autocopy: !!h?.autocopy }
          }),
        }
      })
    })
    ipcMain.handle('whatevertools-settings:set', (e, pluginId: string, permission: string, decision: 'grant' | 'deny' | 'ask') => {
      if (!own(e)) return
      this.host.setPermission(this.host.get(pluginId), permission, decision)
    })
    ipcMain.handle('whatevertools-settings:hotkey', (e, pluginId: string, label: string, accelerator: string, autocopy: boolean) => {
      if (!own(e)) return false
      this.host.hotkeys.set(pluginId, label, accelerator || null, !!autocopy)
      return true
    })
    ipcMain.handle('whatevertools-settings:plugins', (e) => (own(e) ? this.pluginManager?.list() ?? [] : []))
    ipcMain.handle('whatevertools-settings:plugin-add', (e) => (own(e) && this.pluginManager ? this.pluginManager.add() : null))
    ipcMain.handle('whatevertools-settings:plugin-install', (e) => (own(e) && this.pluginManager?.install ? this.pluginManager.install() : null))
    ipcMain.handle('whatevertools-settings:plugin-remove', (e, id: string) => {
      if (own(e)) this.pluginManager?.remove(id)
    })
    ipcMain.handle('whatevertools-settings:reset', (e, pluginId: string) => {
      if (!own(e)) return
      this.host.resetPermissions(this.host.get(pluginId))
    })
    ipcMain.handle('whatevertools-settings:copy-mcp', (e) => {
      if (!own(e) || !this.host.mcp.port) return false
      require('electron').clipboard.writeText(JSON.stringify({ mcpServers: { [this.host.options.identity?.host?.name ?? 'whatevertools']: this.host.mcp.clientConfig() } }, null, 2))
      return true
    })
  }
}
