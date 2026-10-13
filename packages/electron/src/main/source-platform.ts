// 入口来源需要的平台能力（Electron 实现）：全局快捷键、读选中内容、弹候选面板、主面板
import fs from 'node:fs'
import path from 'node:path'
import { globalShortcut } from 'electron'
import type { EntryInput, SourcePlatform } from '@whatevertools/core'
import type { WhateverToolsHost } from './host'
import { clipboardBackend } from './services/clipboard-backend'
import { readFiles } from './services/clipboard'
import { tapKey } from './services/input'

async function readClipboardInput(): Promise<EntryInput> {
  const cb = clipboardBackend()
  const files = await readFiles().catch(() => [] as string[])
  if (files.length) {
    return {
      files: files.map((p) => {
        const st = fs.statSync(p, { throwIfNoEntry: false })
        return { path: p, name: path.basename(p), isFile: !!st?.isFile(), isDirectory: !!st?.isDirectory() }
      }),
    }
  }
  const img = await cb.readImage()
  if (!img.isEmpty()) return { image: img.toDataURL() }
  return { text: await cb.readText() }
}

export function electronSourcePlatform(getHost: () => WhateverToolsHost): SourcePlatform {
  return {
    registerShortcut: (accel, onPress) => {
      try {
        return globalShortcut.register(accel, onPress)
      } catch {
        return false
      }
    },
    unregisterShortcut: (accel) => {
      try {
        globalShortcut.unregister(accel)
      } catch {}
    },
    readClipboard: readClipboardInput,
    // 模拟复制拿到前台应用的选中内容，然后恢复剪贴板（只恢复文字和图片）
    readSelection: async () => {
      const cb = clipboardBackend()
      const saved = { text: await cb.readText(), image: await cb.readImage() }
      await cb.writeText('')
      try {
        await tapKey('c', [process.platform === 'darwin' ? 'command' : 'ctrl'])
        await new Promise((r) => setTimeout(r, 180))
        const input = await readClipboardInput()
        if (input.text === '' && !input.files && !input.image) return {}
        return input
      } finally {
        if (!saved.image.isEmpty()) await cb.writeImage(saved.image)
        else await cb.writeText(saved.text)
      }
    },
    showPicker: (results, opts) => getHost().panel<Promise<number | undefined>>('pick', null, [results, opts], () => Promise.resolve(undefined)),
    showMain: (input) => getHost().panel('showMain', null, [input]),
    log: (msg) => getHost().log('warn', msg),
  }
}
