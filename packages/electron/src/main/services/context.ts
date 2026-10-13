// 前台应用上下文：当前前台窗口（window 入口类型的输入、context.activeWindow）
import type { WhateverToolsHost } from '../host'
import type { PluginRuntime } from '../plugin'
import type { Handler } from '../types'

/** 前台窗口：优先用 providers.context.activeWindow，否则 macOS 用 AppleScript */
export async function activeWindow(host: WhateverToolsHost, plugin?: PluginRuntime): Promise<Record<string, unknown> | null> {
  // 有插件时走 callProvider（经过 provider:context.activeWindow hook）
  const custom = host.options.providers?.context?.activeWindow
  if (custom) {
    try {
      return plugin ? await host.provider(plugin, 'context', 'activeWindow', [], () => null) : await custom({ pluginId: '', pluginName: '' })
    } catch {
      return null
    }
  }
  if (process.platform !== 'darwin') return null
  const script = `tell application "System Events"
    set p to first application process whose frontmost is true
    set n to name of p
    set pid to unix id of p
    set t to ""
    set b to {0, 0, 0, 0}
    try
      set w to front window of p
      set t to name of w
      set {x, y} to position of w
      set {ww, hh} to size of w
      set b to {x, y, ww, hh}
    end try
    return n & "\n" & pid & "\n" & t & "\n" & (item 1 of b) & "," & (item 2 of b) & "," & (item 3 of b) & "," & (item 4 of b)
  end tell`
  return new Promise((resolve) => {
    require('node:child_process').execFile('osascript', ['-e', script], { timeout: 1500 }, (err: Error | null, out: string) => {
      if (err) return resolve(null)
      const [app, pid, title, bounds] = String(out).trim().split('\n')
      const [x, y, width, height] = (bounds ?? '0,0,0,0').split(',').map(Number)
      resolve({ id: Number(pid), app: `${app}.app`, appPath: '', pid: Number(pid), title: title ?? '', x, y, width, height })
    })
  })
}


export const contextSvc: Record<string, Handler> = {
  'context.activeWindow': (c) => activeWindow(c.host, c.plugin),
}
