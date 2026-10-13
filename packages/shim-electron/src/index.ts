// Electron 渲染进程模块的垫片：给没有 Electron 的平台（web、以后的 tauri）用。
// 只覆盖插件常用的部分；做不到的方法按策略抛错。
import type { Capabilities } from '@whatevertools/core'
import { CompatImage, fromBase64 } from '@whatevertools/api'

export interface ElectronShimOptions {
  unsupported?: (name: string) => never
}

function unsupportedDefault(name: string): never {
  throw Object.assign(new Error(`[whatevertools] 当前平台不支持 electron.${name}`), { code: 'EWTUNSUPPORTED' })
}

/** 从 PNG / JPEG 字节读尺寸（够 nativeImage.getSize 用） */
export function imageSize(b: Uint8Array): { width: number; height: number } {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length) {
      if (b[i] !== 0xff) break
      const marker = b[i + 1]
      const len = (b[i + 2] << 8) | b[i + 3]
      if (marker >= 0xc0 && marker <= 0xc3) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
      i += 2 + len
    }
  }
  return { width: 0, height: 0 }
}

export function createElectronModule(caps: Capabilities, opts: ElectronShimOptions = {}) {
  const unsupported = opts.unsupported ?? unsupportedDefault
  const img = (png: Uint8Array | null) => new CompatImage(png && png.length ? { png, ...imageSize(png) } : null, caps)
  const nativeImage = {
    createEmpty: () => img(null),
    createFromBuffer: (b: Uint8Array) => img(new Uint8Array(b)),
    createFromDataURL: (u: string) => img(fromBase64(String(u).split(',')[1] ?? '')),
    createFromPath: (p: string) => {
      const d = caps.image?.fromPathSync?.(p)
      if (d) return img(d.png)
      try {
        return img(caps.fs?.readFileSync?.(p) ?? null)
      } catch {
        return img(null)
      }
    },
  }
  const listeners = new Map<string, Set<(...a: any[]) => void>>()
  const ipcRenderer = {
    on(channel: string, fn: (...a: any[]) => void) {
      if (!caps.ipc) return unsupported('ipcRenderer.on')
      caps.ipc.on(channel, fn)
      let s = listeners.get(channel)
      if (!s) listeners.set(channel, (s = new Set()))
      s.add(fn)
      return ipcRenderer
    },
    once(channel: string, fn: (...a: any[]) => void) {
      const wrap = (...a: any[]) => {
        ipcRenderer.removeListener(channel, wrap)
        fn(...a)
      }
      return ipcRenderer.on(channel, wrap)
    },
    removeListener(channel: string, fn: (...a: any[]) => void) {
      caps.ipc?.off(channel, fn)
      listeners.get(channel)?.delete(fn)
      return ipcRenderer
    },
    off(channel: string, fn: (...a: any[]) => void) {
      return ipcRenderer.removeListener(channel, fn)
    },
    removeAllListeners(channel?: string) {
      for (const [c, s] of listeners) if (!channel || c === channel) for (const fn of s) caps.ipc?.off(c, fn)
      if (channel) listeners.delete(channel)
      else listeners.clear()
      return ipcRenderer
    },
    send: (channel: string, ...args: unknown[]) => (caps.ipc?.send ? caps.ipc.send(channel, args) : unsupported('ipcRenderer.send')),
    invoke: (channel: string, ...args: unknown[]) => (caps.ipc?.invoke ? caps.ipc.invoke(channel, args) : Promise.reject(new Error('[whatevertools] 当前平台不支持 ipcRenderer.invoke'))),
    sendSync: () => unsupported('ipcRenderer.sendSync'),
  }
  const c = caps.clipboard
  const clipboard = {
    readText: () => (c?.readTextSync ? c.readTextSync() : ''),
    writeText: (t: string) => (c?.writeTextSync ? c.writeTextSync(String(t)) : unsupported('clipboard.writeText')),
    readHTML: () => c?.readHTMLSync?.() ?? '',
    writeHTML: (h: string) => (c?.writeHTMLSync ? c.writeHTMLSync(h) : unsupported('clipboard.writeHTML')),
    readImage: () => img(c?.readImageSync?.()?.png ?? null),
    writeImage: (i: { toPNG(): Uint8Array }) => (c?.writeImageSync ? void c.writeImageSync(new Uint8Array(i.toPNG())) : unsupported('clipboard.writeImage')),
    availableFormats: () => [] as string[],
    has: () => false,
    clear: () => c?.writeTextSync?.(''),
    readBuffer: () => unsupported('clipboard.readBuffer'),
    writeBuffer: () => unsupported('clipboard.writeBuffer'),
    read: () => '',
    write: (d: { text?: string; html?: string }) => {
      if (d.text !== undefined) clipboard.writeText(d.text)
      if (d.html !== undefined) clipboard.writeHTML(d.html)
    },
  }
  const shell = {
    openExternal: (u: string) => (caps.shell ? caps.shell.openExternal(u) : unsupported('shell.openExternal')),
    openPath: (p: string) => (caps.shell?.openPath ? caps.shell.openPath(p) : Promise.resolve('[whatevertools] 当前平台不支持 shell.openPath')),
    showItemInFolder: (p: string) => (caps.shell?.showItemInFolder ? caps.shell.showItemInFolder(p) : unsupported('shell.showItemInFolder')),
    trashItem: (p: string) => (caps.shell?.trashItem ? caps.shell.trashItem(p) : Promise.reject(new Error('[whatevertools] 当前平台不支持 shell.trashItem'))),
    beep: () => caps.shell?.beep?.(),
  }
  let zoom = 1
  const webFrame = {
    getZoomFactor: () => zoom,
    setZoomFactor: (f: number) => {
      zoom = f
      if (typeof document !== 'undefined') (document.documentElement.style as any).zoom = String(f)
    },
    setVisualZoomLevelLimits: () => {},
    insertCSS: (css: string) => {
      const s = document.createElement('style')
      s.textContent = css
      document.head.appendChild(s)
      return String(Math.random())
    },
  }
  const webUtils = { getPathForFile: (f: unknown) => (caps.fs?.pathForFile ? caps.fs.pathForFile(f) : '') }
  const contextBridge = { exposeInMainWorld: (k: string, v: unknown) => ((globalThis as any)[k] = v), exposeInIsolatedWorld: () => {} }
  return { nativeImage, ipcRenderer, clipboard, shell, webFrame, webUtils, contextBridge }
}
