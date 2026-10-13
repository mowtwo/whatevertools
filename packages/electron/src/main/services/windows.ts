// 自定义窗口：createBrowserWindow 在 main 里建真正的 BrowserWindow，渲染进程拿到的是按白名单转发调用的代理。
import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { WINDOW_METHODS, WEBCONTENTS_METHODS, WINDOW_WRITE_METHODS, windowCallNeedsOverlay } from '@whatevertools/core'
import { CH } from '../../shared/protocol'
import type { CallCtx, Handler } from '../types'
import { serialize } from './util'

const OPTION_KEYS = new Set([
  'show', 'title', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'x', 'y', 'center', 'resizable',
  'movable', 'maximizable', 'minimizable', 'closable', 'frame', 'hasShadow', 'roundedCorners', 'alwaysOnTop', 'focusable',
  'skipTaskbar', 'enableLargerThanScreen', 'fullscreenable', 'fullscreen', 'opacity', 'backgroundColor', 'transparent',
  'titleBarStyle', 'acceptFirstMouse', 'autoHideMenuBar', 'vibrancy', 'visualEffectState', 'trafficLightPosition', 'type', 'kiosk',
])

/** 覆盖层特征：置顶、全屏透明、kiosk */
function isOverlay(o: Record<string, any>) {
  if (o.alwaysOnTop || o.kiosk) return true
  if (o.transparent && (o.fullscreen || coversDisplay(o))) return true
  return false
}

function coversDisplay(o: Record<string, any>) {
  if (typeof o.width !== 'number' || typeof o.height !== 'number') return false
  const d = screen.getDisplayMatching({ x: o.x ?? 0, y: o.y ?? 0, width: o.width, height: o.height })
  return o.width >= d.bounds.width * 0.9 && o.height >= d.bounds.height * 0.9
}

const closable = (o: Record<string, any>) => (o.closeable !== undefined && o.closable === undefined ? { closable: o.closeable } : {})

async function createWindow(c: CallCtx, url: string, options: Record<string, any> = {}) {
  const { host, plugin } = c
  // hook window:create：可以改写地址和选项，返回 null 拒绝创建
  const req = (await host.hooks.runApply('window:create', { plugin: plugin.id }, c, [{ url, options }], async (a) => a[0])) as { url: string; options: Record<string, any> } | null
  if (!req) throw new Error('[whatevertools] 宿主拒绝创建窗口')
  url = req.url
  options = req.options
  if (typeof url !== 'string' || !url) throw new Error('createBrowserWindow: url 不能为空')
  const opts: Record<string, any> = { ...closable(options) }
  for (const [k, v] of Object.entries(options ?? {})) if (OPTION_KEYS.has(k)) opts[k] = v
  if (isOverlay(opts)) await host.permit(plugin, 'window.overlay')
  const wp = options?.webPreferences ?? {}
  let preload: string | undefined
  if (wp.preload) {
    preload = path.resolve(plugin.manifest.dir, String(wp.preload))
    if (!host.insideDir(plugin.manifest.dir, preload)) throw new Error(`preload 必须在插件目录内：${wp.preload}`)
  }
  const remote = /^https?:/i.test(url)
  const target = remote ? url : host.pluginUrl(plugin, url)
  // 远程网页：不注入插件 API，开启隔离和沙箱（否则远程脚本会拿到插件的全部授权）
  const webPreferences: Electron.WebPreferences = remote
    ? { partition: host.partitionOf(plugin), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: wp.backgroundThrottling, zoomFactor: wp.zoomFactor }
    : { ...host.webPreferences(plugin, { backgroundThrottling: wp.backgroundThrottling }), zoomFactor: wp.zoomFactor }
  if (remote && /^http:/i.test(url)) host.log('warn', `插件 ${plugin.id} 用明文 http 打开远程窗口：${url}`)
  const win = new BrowserWindow({ ...opts, webPreferences })
  const wc = win.webContents
  const creator = c.wc
  if (remote) {
    // 远程窗口只允许在同源内导航，其他链接交给系统浏览器（需要 shell.external 权限）
    const origin = new URL(url).origin
    const allowed = (u: string) => {
      try {
        return new URL(u).origin === origin
      } catch {
        return false
      }
    }
    wc.on('will-navigate', (e, u) => !allowed(u) && e.preventDefault())
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  } else {
    host.customPreloads.set(wc.id, preload)
    host.register(wc, plugin, 'custom', creator.id)
  }
  const entry = { id: win.id, wcId: wc.id, parentWcId: creator.id, win }
  plugin.windows.set(win.id, entry)
  wc.once('did-finish-load', () => {
    if (!creator.isDestroyed()) creator.send(CH.event, '__winReady', win.id)
  })
  win.once('closed', () => {
    plugin.windows.delete(entry.id)
    host.customPreloads.delete(entry.wcId)
    if (!creator.isDestroyed()) creator.send(CH.event, '__winClosed', entry.id)
  })
  win.loadURL(target).catch((e) => host.log('warn', `custom window load failed: ${e.message}`))
  return { id: win.id, wcId: wc.id }
}

async function callWindow(c: CallCtx, winId: number, target: 'win' | 'wc', method: string, args: unknown[] = []) {
  const entry = c.plugin.windows.get(winId)
  if (!entry || entry.win.isDestroyed()) {
    if (method === 'isDestroyed') return true
    throw new Error('Object has been destroyed')
  }
  const allowed = target === 'win' ? WINDOW_METHODS : WEBCONTENTS_METHODS
  if (!allowed.includes(method)) throw new Error(`[whatevertools] 窗口不支持方法 ${target === 'wc' ? 'webContents.' : ''}${method}`)
  if (target === 'win' && windowCallNeedsOverlay(method, args)) await c.host.permit(c.plugin, 'window.overlay')
  if (target === 'wc' && method in WINDOW_WRITE_METHODS) await c.host.permit(c.plugin, 'fs.write', String(args[WINDOW_WRITE_METHODS[method]]))
  let a = args
  if (target === 'win' && method === 'loadFile') {
    const abs = path.resolve(c.plugin.manifest.dir, String(args[0]))
    if (!c.host.insideDir(c.plugin.manifest.dir, abs)) throw new Error('loadFile 只能加载插件目录内的文件')
    a = [abs, ...args.slice(1)]
  }
  if ((target === 'win' || target === 'wc') && method === 'loadURL') {
    // 只能加载插件目录里的页面；远程网页请用 window.create 打开（不注入插件 API）
    const u = String(args[0] ?? '')
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) throw new Error('loadURL 只能加载插件目录里的页面（远程网页请用 window.create）')
    a = [c.host.pluginUrl(c.plugin, u), ...args.slice(1)]
  }
  let obj: any = target === 'win' ? entry.win : entry.win.webContents
  // 白名单里有几个其实是 webContents 的方法（isLoading / stop / reloadIgnoringCache）
  if (target === 'win' && typeof obj[method] !== 'function' && typeof (entry.win.webContents as any)[method] === 'function') obj = entry.win.webContents
  if (target === 'wc' && method === 'getPrinters') return entry.win.webContents.getPrintersAsync()
  if (target === 'wc' && method === 'print') {
    return new Promise((resolve) => entry.win.webContents.print((a[0] as Electron.WebContentsPrintOptions) ?? {}, (success, failureReason) => resolve({ success, failureReason })))
  }
  // hook window:<方法> / window:webContents.<方法>
  const hookName = target === 'win' ? `window:${method}` : `window:webContents.${method}`
  return serialize(await c.host.hooks.runApply(hookName, { plugin: c.plugin.id, windowId: winId } as any, c, a, (x) => obj[method](...x)))
}

export const windowsSvc: Record<string, Handler> = {
  'window.type': (c) => c.kind,
  'window.create': (c, url: string, options: Record<string, any>) => createWindow(c, url, options),
  __win: (c, winId: number, target: 'win' | 'wc', method: string, args: unknown[]) => callWindow(c, winId, target, method, args),
  'window.sendToParent': (c, channel: string, ...args: unknown[]) => {
    if (typeof channel !== 'string' || channel.startsWith('whatevertools:')) throw new Error(`sendToParent: 无效通道 ${channel}`)
    c.host.parentOf(c.wc)?.send(channel, ...args)
  },
  'panel.hide': (c, focusPrev = true) => (c.host.panel('hide', c.plugin, [focusPrev !== false], () => BrowserWindow.fromWebContents(c.wc)?.hide()), true),
  'panel.show': (c) => (c.host.panel('show', c.plugin, [], () => BrowserWindow.fromWebContents(c.wc)?.show()), true),
  'panel.setHeight': (c, height: number) =>
    c.host.panel('setExpandHeight', c.plugin, [Number(height)], () => {
      const win = BrowserWindow.fromWebContents(c.wc)
      if (!win) return false
      const [w] = win.getContentSize()
      win.setContentSize(w, Math.max(1, Math.round(Number(height))))
      return true
    }),
  'panel.input.set': (c, placeholder = '', focus = true) => {
    c.plugin.panelInput = { placeholder: String(placeholder ?? ''), value: '' }
    return c.host.panel('input.set', c.plugin, [String(placeholder ?? ''), focus !== false], () => true)
  },
  'panel.input.remove': (c) => ((c.plugin.panelInput = null), c.host.panel('input.remove', c.plugin, [], () => true)),
  'panel.input.setValue': (c, text: string) => {
    if (c.plugin.panelInput) c.plugin.panelInput.value = String(text ?? '')
    const ok = c.host.panel('input.setValue', c.plugin, [String(text ?? '')], () => true)
    // 旧平台设置值也会触发 onChange
    c.host.emit(c.plugin, 'panel.input', { text: String(text ?? '') })
    return ok
  },
  'panel.input.focus': (c) => c.host.panel('input.focus', c.plugin, [], () => false),
  'panel.input.blur': (c) => {
    c.host.panel('input.blur', c.plugin)
    c.wc.focus()
  },
  'panel.input.select': (c) => c.host.panel('input.select', c.plugin, [], () => false),
  'lifecycle.exit': (c, kill = false) => c.host.out(c.plugin, !!kill),
  'page.find': (c, text: string, options?: Electron.FindInPageOptions) => {
    if (text) c.wc.findInPage(String(text), options)
  },
  'page.stopFind': (c, action: 'clearSelection' | 'keepSelection' | 'activateSelection' = 'clearSelection') => c.wc.stopFindInPage(action),
}
