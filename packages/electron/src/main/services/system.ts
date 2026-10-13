import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { app, BrowserWindow, dialog, nativeTheme, Notification, shell } from 'electron'
import type { Handler, CallCtx } from '../types'

function parentWindow(c: CallCtx) {
  return BrowserWindow.fromWebContents(c.wc) ?? undefined
}

const PATHS: Record<string, Parameters<typeof app.getPath>[0]> = {
  home: 'home', temp: 'temp', desktop: 'desktop', documents: 'documents', downloads: 'downloads',
  music: 'music', pictures: 'pictures', videos: 'videos', appData: 'appData', userData: 'userData', exe: 'exe',
}

async function fileIcon(target: string): Promise<string> {
  let p = target
  let tmp: string | null = null
  if (target === 'folder') {
    // 用一个空目录取通用的文件夹图标（主目录在 macOS 上是房子图标）
    p = path.join(os.tmpdir(), 'whatevertools-folder-icon')
    fs.mkdirSync(p, { recursive: true })
  } else if (/^\.[\w-]+$/.test(target)) {
    // 只给扩展名时，用一个临时空文件取图标
    tmp = path.join(os.tmpdir(), `whatevertools-icon${target}`)
    if (!fs.existsSync(tmp)) fs.writeFileSync(tmp, '')
    p = tmp
  }
  const img = await app.getFileIcon(p, { size: 'normal' })
  return img.toDataURL()
}

const liveNotifications = new Set<Electron.Notification>()

export const system: Record<string, Handler> = {
  'paths.data': (c) => (fs.mkdirSync(c.plugin.dataDir, { recursive: true }), c.plugin.dataDir),
  'paths.temp': (c) => (fs.mkdirSync(c.plugin.tempDir, { recursive: true }), c.plugin.tempDir),
  'system.notify': (c, body: string, clickFeatureCode?: string) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: c.plugin.manifest.name, body: String(body ?? '') })
    // 保持引用直到点击或关闭，否则被回收后点击回调不会触发
    liveNotifications.add(n)
    const release = () => liveNotifications.delete(n)
    n.on('close', release)
    n.on('failed', release)
    if (clickFeatureCode) {
      n.on('click', () => {
        const f = c.plugin.allFeatures().find((x) => x.code === clickFeatureCode)
        const label = f?.cmds.find((x) => typeof x === 'string') as string | undefined
        release()
        // 点击通知也是一个入口来源（notification）
        c.host.sources.context('notification').enter({ pluginId: c.plugin.id, code: clickFeatureCode, type: 'text', payload: label ?? clickFeatureCode }).catch((e) => c.host.log('warn', e.message))
      })
    }
    n.show()
  },
  'dialog.open': (c, options: Electron.OpenDialogOptions = {}) => {
    const win = parentWindow(c)
    const res = win ? dialog.showOpenDialogSync(win, options) : dialog.showOpenDialogSync(options)
    // 用户选中的路径本次运行内可读写（同 Chrome 的文件选择器）
    for (const p of res ?? []) {
      c.plugin.perms.grantPath('fs.read', p)
      c.plugin.perms.grantPath('fs.write', p)
    }
    return res
  },
  'dialog.save': (c, options: Electron.SaveDialogOptions = {}) => {
    const win = parentWindow(c)
    const res = win ? dialog.showSaveDialogSync(win, options) : dialog.showSaveDialogSync(options)
    if (res) {
      c.plugin.perms.grantPath('fs.write', res)
      c.plugin.perms.grantPath('fs.read', res)
    }
    return res || undefined
  },
  'shell.openPath': (_c, p: string) => shell.openPath(String(p)),
  'shell.trash': (_c, p: string) => shell.trashItem(String(p)),
  'shell.showInFolder': (_c, p: string) => shell.showItemInFolder(String(p)),
  'shell.openExternal': (_c, url: string) => {
    // 只允许网页和邮件链接；file: / smb: / 自定义协议会绕过插件的文件权限
    if (!/^(https?|mailto):/i.test(String(url))) throw Object.assign(new Error(`[whatevertools] shell.openExternal 只支持 http / https / mailto：${url}`), { code: 'EWTPERM' })
    return shell.openExternal(String(url))
  },
  'shell.beep': () => shell.beep(),
  'device.id': (c) => c.host.provider(c.plugin, 'device', 'id', [], () => crypto.createHash('sha256').update(c.host.machineId()).update(c.plugin.id).digest('hex').slice(0, 32)),
  'account.user': (c) => c.host.provider(c.plugin, 'user', 'get', [], () => null),
  'paths.get': (_c, name: string) => {
    const key = PATHS[name]
    if (!key) throw new Error(`getPath 不支持：${name}`)
    return app.getPath(key)
  },
  'system.fileIcon': (_c, p: string) => fileIcon(String(p)),
  'system.fileIconAsync': (_c, p: string) => fileIcon(String(p)),
  'context.activeFolder': (c) => c.host.provider(c.plugin, 'context', 'activeFolder', [], frontFolder),
  'context.activeBrowserUrl': (c) => c.host.provider(c.plugin, 'context', 'activeBrowserUrl', [], frontBrowserUrl),
  'system.isDark': () => nativeTheme.shouldUseDarkColors,
}

// 前台应用上下文：macOS 用 AppleScript（需要「自动化」授权），其他平台暂不支持
function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') return reject(new Error('当前平台不支持'))
    require('node:child_process').execFile('osascript', ['-e', script], { timeout: 3000 }, (err: Error | null, out: string) =>
      err ? reject(err) : resolve(String(out).trim()),
    )
  })
}

async function frontFolder() {
  return osascript('tell application "Finder" to if (count of Finder windows) > 0 then get POSIX path of (target of front Finder window as alias)')
}

async function frontBrowserUrl() {
  const app = await osascript('tell application "System Events" to get name of first application process whose frontmost is true')
  if (app === 'Safari') return osascript('tell application "Safari" to get URL of front document')
  if (/Chrome|Edge|Brave|Arc|Chromium/.test(app)) return osascript(`tell application "${app}" to get URL of active tab of front window`)
  throw new Error(`前台应用不是支持的浏览器：${app}`)
}
