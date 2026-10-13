// 交互式截图（框选）和取色：截下光标所在的屏幕，盖一个全屏窗口让用户操作。
// 这个窗口会接管鼠标，所以有三重退出：Esc / 右键 / 超时（2 分钟），窗口失焦关闭也算取消。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Handler } from '../types'
import { captureDisplays } from './screen'
import { wireImage } from './util'

const ASSETS = path.join(__dirname, '..', '..', '..', 'assets')
let seq = 0

async function interactive(mode: 'region' | 'color'): Promise<any> {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const [shot] = await captureDisplays(d.id)
  const file = path.join(os.tmpdir(), `whatevertools-capture-${process.pid}-${++seq}.png`)
  fs.writeFileSync(file, shot.image.toPNG())
  const channel = `whatevertools-capture:${seq}`
  const { x, y, width, height } = d.bounds
  const win = new BrowserWindow({
    x, y, width, height, show: false, frame: false, resizable: false, movable: false, skipTaskbar: true, hasShadow: false,
    enableLargerThanScreen: true, alwaysOnTop: true, fullscreenable: false, roundedCorners: false,
    webPreferences: { preload: path.join(ASSETS, 'capture-preload.js'), contextIsolation: true, sandbox: true },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (r: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipcMain.removeAllListeners(channel)
      if (!win.isDestroyed()) win.destroy()
      fs.rm(file, { force: true }, () => {})
      if (!r || r.cancel) return reject(new Error('用户取消'))
      resolve(r)
    }
    const timer = setTimeout(() => finish({ cancel: true }), 120000)
    ipcMain.on(channel, (e, r) => {
      if (e.sender === win.webContents) finish(r)
    })
    win.on('closed', () => finish({ cancel: true }))
    win.on('blur', () => finish({ cancel: true }))
    win.webContents.on('render-process-gone', () => finish({ cancel: true }))
    win.once('ready-to-show', () => {
      win.setBounds(d.bounds)
      win.show()
      win.focus()
    })
    win.loadURL(`${pathToFileURL(path.join(ASSETS, 'capture.html')).href}?mode=${mode}&channel=${encodeURIComponent(channel)}&img=${encodeURIComponent(pathToFileURL(file).href)}`)
  }).then((r: any) => {
    if (mode === 'color') return r.color
    const img = shot.image
    const sx = img.getSize().width / r.viewport.width
    const sy = img.getSize().height / r.viewport.height
    return wireImage(img.crop({ x: Math.round(r.rect.x * sx), y: Math.round(r.rect.y * sy), width: Math.round(r.rect.width * sx), height: Math.round(r.rect.height * sy) }))
  })
}

export const captureSvc: Record<string, Handler> = {
  'screen.captureRegion': async (c) => {
    c.host.panel('hide', c.plugin, [false])
    const custom = await c.host.provider<Promise<string> | null>(c.plugin, 'capture', 'selectRegion', [], () => null)
    if (custom) return wireImage(require('electron').nativeImage.createFromDataURL(custom))
    return interactive('region')
  },
  'screen.pickColor': (c) => c.host.provider(c.plugin, 'capture', 'pickColor', [], () => interactive('color')),
  /** 渲染进程跑 ffmpeg 前取可执行文件路径 */
  __ffmpegPath: async (c, args: unknown) => {
    await c.host.permit(c.plugin, 'media.ffmpeg')
    // ffmpeg 能读写任意文件：输入（-i 后面）需要读取权限，输出（最后一个非选项参数）需要写入权限
    const list = Array.isArray(args) ? args.map(String) : []
    const isUrl = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s === '-' || s.startsWith('pipe:')
    for (let i = 0; i < list.length; i++) if (list[i] === '-i' && list[i + 1] && !isUrl(list[i + 1])) await c.host.permit(c.plugin, 'fs.read', require('node:path').resolve(list[i + 1]))
    const out = list[list.length - 1]
    if (out && !out.startsWith('-') && list[list.length - 2] !== '-i' && !isUrl(out)) await c.host.permit(c.plugin, 'fs.write', require('node:path').resolve(out))
    return c.host.provider(c.plugin, 'media', 'ffmpegPath', [], () => c.host.options.ffmpegPath ?? 'ffmpeg')
  },
}
