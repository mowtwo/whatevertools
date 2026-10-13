// 粘贴到其他应用 / 模拟键鼠：Electron 没有跨应用发送按键的能力，这里用系统脚本模拟，
// 宿主可以通过 hook（service:hideMainWindowPasteText 等）换成原生实现。
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { clipboardBackend } from './clipboard-backend'
import type { CallCtx, Handler } from '../types'
import { toNativeImage } from './util'
import { writeFiles } from './clipboard'

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => execFile(cmd, args, { timeout: 5000 }, (err) => (err ? reject(err) : resolve())))
}

const AS_KEYS: Record<string, number> = { enter: 36, return: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121 }
const WIN_KEYS: Record<string, string> = { enter: '{ENTER}', tab: '{TAB}', space: ' ', delete: '{DEL}', backspace: '{BS}', escape: '{ESC}', esc: '{ESC}', left: '{LEFT}', right: '{RIGHT}', down: '{DOWN}', up: '{UP}', home: '{HOME}', end: '{END}' }

export async function tapKey(key: string, modifiers: string[]) {
  const k = key.toLowerCase()
  if (process.platform === 'darwin') {
    const mods = modifiers.map((m) => ({ command: 'command down', cmd: 'command down', meta: 'command down', ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down', shift: 'shift down' } as Record<string, string>)[m.toLowerCase()]).filter(Boolean)
    const using = mods.length ? ` using {${mods.join(', ')}}` : ''
    const body = AS_KEYS[k] !== undefined ? `key code ${AS_KEYS[k]}${using}` : `keystroke "${k.replace(/"/g, '\\"')}"${using}`
    return run('osascript', ['-e', `tell application "System Events" to ${body}`])
  }
  if (process.platform === 'win32') {
    const prefix = modifiers.map((m) => ({ ctrl: '^', control: '^', alt: '%', shift: '+' } as Record<string, string>)[m.toLowerCase()] ?? '').join('')
    const seq = prefix + (WIN_KEYS[k] ?? k)
    return run('powershell', ['-NoProfile', '-Command', `$w=New-Object -ComObject WScript.Shell; $w.SendKeys('${seq.replace(/'/g, "''")}')`])
  }
  return run('xdotool', ['key', [...modifiers, k].join('+')])
}

async function typeString(text: string) {
  if (process.platform === 'darwin') return run('osascript', ['-e', `tell application "System Events" to keystroke ${JSON.stringify(text)}`])
  if (process.platform === 'win32') return run('powershell', ['-NoProfile', '-Command', `$w=New-Object -ComObject WScript.Shell; $w.SendKeys('${text.replace(/[+^%~(){}[\]]/g, '{$&}').replace(/'/g, "''")}')`])
  return run('xdotool', ['type', '--', text])
}

/** 隐藏主界面、把焦点还给之前的应用，然后执行 */
async function afterHide(c: CallCtx, fn: () => Promise<void>) {
  c.host.panel('hide', c.plugin, [true])
  // macOS：只有本应用没有其他可见窗口时才 app.hide() 把焦点还给前一个应用（否则会把挂件、分离窗口一起藏掉）
  if (process.platform === 'darwin') {
    const { app, BrowserWindow } = require('electron')
    if (!BrowserWindow.getAllWindows().some((w: Electron.BrowserWindow) => w.isVisible() && w.isFocusable())) app.hide()
  }
  await new Promise((r) => setTimeout(r, 200))
  await fn()
}

const pasteKey = () => tapKey('v', [process.platform === 'darwin' ? 'command' : 'ctrl'])

export const inputSvc: Record<string, Handler> = {
  // 所有输入操作都先经过提供者（provider:input.*，可接 nut.js 等原生实现），内置的系统脚本模拟作为兜底
  'input.sendText': (c, text: string) => {
    if (!text) return false
    return c.host.provider(c.plugin, 'input', 'pasteText', [String(text)], () => {
      clipboardBackend().writeText(String(text)).then(() => afterHide(c, pasteKey)).catch((e) => c.host.log('warn', `paste failed: ${e.message}`))
      return true
    })
  },
  'input.sendFiles': async (c, p: string | string[]) => {
    const list = (Array.isArray(p) ? p : [p]).filter((x) => typeof x === 'string').map((x) => path.resolve(x))
    // 粘贴文件等同于把文件交给别的应用：需要读取权限
    for (const f of list) await c.host.permit(c.plugin, 'fs.read', f)
    return c.host.provider(c.plugin, 'input', 'pasteFiles', [list], () => {
      const existing = list.filter((f) => fs.existsSync(f))
      if (!existing.length) return false
      writeFiles(existing).then((ok) => (ok ? afterHide(c, pasteKey) : c.host.log('warn', '当前 Electron 版本不支持把文件写入剪贴板'))).catch((e) => c.host.log('warn', `paste failed: ${e.message}`))
      return true
    })
  },
  'input.sendImage': async (c, image: unknown) => {
    if (typeof image === 'string' && !image.startsWith('data:')) await c.host.permit(c.plugin, 'fs.read', path.resolve(image))
    return c.host.provider(c.plugin, 'input', 'pasteImage', [image], () => {
      const img = toNativeImage(image)
      if (!img || img.isEmpty()) return false
      clipboardBackend().writeImage(img).then(() => afterHide(c, pasteKey)).catch((e) => c.host.log('warn', `paste failed: ${e.message}`))
      return true
    })
  },
  'input.typeText': (c, text: string) => {
    if (!text) return false
    return c.host.provider(c.plugin, 'input', 'typeText', [String(text)], () => {
      afterHide(c, () => typeString(String(text))).catch((e) => c.host.log('warn', `type failed: ${e.message}`))
      return true
    })
  },
  'input.startDrag': async (c, p: string | string[]) => {
    const files = (Array.isArray(p) ? p : [p]).filter((f) => typeof f === 'string' && fs.existsSync(f)).map((f) => path.resolve(f))
    for (const f of files) await c.host.permit(c.plugin, 'fs.read', f)
    if (!files.length) return
    const icon = require('electron').nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJklEQVR42mNkoBAwjhowasCoAaMGjBowasCoAaMGjBowasCoAQAAJgABxGWtQwAAAABJRU5ErkJggg==')
    c.wc.startDrag({ file: files[0], files, icon })
  },
  'input.keyTap': (_c, key: string, ...mods: string[]) => tapKey(String(key), mods),
  'input.mouseMove': () => unsupported('simulateMouseMove'),
  'input.mouseClick': () => unsupported('simulateMouseClick'),
  'input.mouseDoubleClick': () => unsupported('simulateMouseDoubleClick'),
  'input.mouseRightClick': () => unsupported('simulateMouseRightClick'),
}

function unsupported(name: string): never {
  const e = new Error(`[whatevertools] ${name} 需要宿主提供原生实现（providers.input）`) as Error & { code: string }
  e.code = 'EWTUNSUPPORTED'
  throw e
}
