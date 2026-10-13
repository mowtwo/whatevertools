import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { clipboardBackend, legacyClipboardCall } from './clipboard-backend'
import type { Handler } from '../types'
import { toNativeImage } from './util'

const plistEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function writeFiles(paths: string[]): Promise<boolean> {
  const clipboard = clipboardBackend()
  const files = paths.filter((p) => fs.existsSync(p))
  if (!files.length || !clipboard.nativeFormats) return false
  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array>${files.map((f) => `<string>${plistEscape(f)}</string>`).join('')}</array></plist>`
    await clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist))
  } else if (process.platform === 'win32') {
    // CF_HDROP：DROPFILES 头（20 字节）+ 以 \0 分隔、\0\0 结尾的 UTF-16 路径
    const list = Buffer.from(files.join('\0') + '\0\0', 'utf16le')
    const header = Buffer.alloc(20)
    header.writeUInt32LE(20, 0)
    header.writeUInt32LE(1, 16)
    await clipboard.writeBuffer('CF_HDROP', Buffer.concat([header, list]))
  } else {
    const uris = files.map((f) => pathToFileURL(f).href).join('\r\n')
    await clipboard.writeBuffer('text/uri-list', Buffer.from(uris))
    await clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(`copy\n${files.map((f) => pathToFileURL(f).href).join('\n')}`))
  }
  return true
}

export async function readFiles(): Promise<string[]> {
  const clipboard = clipboardBackend()
  if (!clipboard.nativeFormats) return []
  const formats = await clipboard.formats()
  if (process.platform === 'darwin') {
    if (formats.includes('NSFilenamesPboardType') || (await clipboard.has('NSFilenamesPboardType'))) {
      const xml = (await clipboard.readBuffer('NSFilenamesPboardType')).toString('utf8')
      const out = [...xml.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      if (out.length) return out
    }
    const url = (await clipboard.readBuffer('public.file-url')).toString('utf8')
    if (url) {
      try { return [fileURLToPath(url)] } catch {}
    }
    return []
  }
  if (process.platform === 'win32') {
    // CF_HDROP：DROPFILES 头（第一个 DWORD 是文件列表偏移，第 16 字节起的 DWORD 表示是否 UTF-16）+ \0 分隔、\0\0 结尾的路径
    const drop = await clipboard.readBuffer('CF_HDROP')
    if (drop.length > 20) {
      const offset = drop.readUInt32LE(0)
      const wide = drop.readUInt32LE(16) !== 0
      const list = drop.subarray(offset).toString(wide ? 'utf16le' : 'latin1').split('\0').filter(Boolean)
      if (list.length) return list
    }
    const raw = await clipboard.readBuffer('FileNameW')
    if (raw.length) return [raw.toString('utf16le').replace(/\0+$/, '')]
    return []
  }
  const uris = (await clipboard.readBuffer('text/uri-list')).toString()
  return uris.split(/\r?\n/).filter((u) => u.startsWith('file:')).map((u) => fileURLToPath(u))
}

export const clipboardSvc: Record<string, Handler> = {
  'clipboard.writeText': async (_c, text: string) => (await clipboardBackend().writeText(String(text ?? '')), true),
  'clipboard.writeImage': async (c, image: unknown) => {
    if (typeof image === 'string' && !image.startsWith('data:')) await c.host.permit(c.plugin, 'fs.read', path.resolve(image))
    const img = toNativeImage(image)
    if (!img || img.isEmpty()) return false
    await clipboardBackend().writeImage(img)
    return true
  },
  'clipboard.writeFiles': async (c, p: string | string[]) => {
    const list = (Array.isArray(p) ? p : [p]).filter((x) => typeof x === 'string').map((x) => path.resolve(x))
    // 放到剪贴板的文件会被别的应用粘贴走，等同于读取
    for (const f of list) await c.host.permit(c.plugin, 'fs.read', f)
    return writeFiles(list)
  },
  'clipboard.readFiles': async (c) => {
    const files = await readFiles()
    if (!files.length) return null
    // 只返回路径信息，不授予读取（剪贴板内容可能是插件自己写进去的）
    return files.map((p) => {
      let st: fs.Stats | null = null
      try { st = fs.statSync(p) } catch {}
      return { path: p, name: path.basename(p), isFile: !!st?.isFile(), isDirectory: !!st?.isDirectory() }
    })
  },
  /** 插件 require('electron').clipboard 的旧同步形状，经 IPC 走这里（权限由渲染进程按读/写区分后再调用） */
  __clipboard: async (c, method: string, args: unknown[]) => {
    const perm = /^(read|has|availableFormats)/.test(String(method)) ? 'clipboard.read' : 'clipboard.write'
    await c.host.permit(c.plugin, perm)
    // 直接写原生格式（文件列表等）需要完整的文件读取权限
    if (method === 'writeBuffer') await c.host.permit(c.plugin, 'fs.read')
    return legacyClipboardCall(method, args as any[])
  },
}
