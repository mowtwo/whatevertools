// uTools 的 4 种唤起入口：main（主面板）、panel（超级面板）、hotkey（指令快捷键）、redirect（插件间跳转）。
// 平台能力通过 ctx.platform 拿到；平台做不到的部分会跳过并记日志。
import type { EntrySource, MatchResult } from '@whatevertools/core'

export interface UtoolsSourceOptions {
  /** 主面板快捷键（默认 Alt+Shift+Space） */
  main?: { accelerator?: string }
  /** 超级面板快捷键（uTools 默认是长按鼠标右键，Electron 拿不到全局鼠标事件，这里用快捷键；默认 Alt+Shift+P） */
  panel?: { accelerator?: string }
}

export const utoolsSources: EntrySource[] = [
  {
    id: 'main',
    title: '主面板',
    setup(ctx) {
      const accel = String(ctx.options.accelerator ?? 'Alt+Shift+Space')
      const p = ctx.platform
      if (!p.registerShortcut || !p.showMain) return
      if (!p.registerShortcut(accel, () => p.showMain!())) p.log?.(`主面板快捷键 ${accel} 注册失败（可能被占用）`)
      return () => p.unregisterShortcut?.(accel)
    },
  },
  {
    id: 'panel',
    title: '超级面板',
    setup(ctx) {
      const accel = String(ctx.options.accelerator ?? 'Alt+Shift+P')
      const p = ctx.platform
      if (!p.registerShortcut || !p.readSelection || !p.showPicker) return
      const run = async () => {
        const input = await p.readSelection!()
        const results = ctx.emit(input)
        if (!results.length) return
        const i = await p.showPicker!(results, { title: '超级面板' })
        const r = i === undefined ? undefined : results[i]
        if (r) await ctx.enter({ pluginId: r.pluginId, code: r.code, type: r.type, payload: r.payload })
      }
      if (!p.registerShortcut(accel, () => void run().catch((e) => p.log?.(`超级面板出错：${e.message}`)))) p.log?.(`超级面板快捷键 ${accel} 注册失败`)
      return () => p.unregisterShortcut?.(accel)
    },
  },
  {
    id: 'hotkey',
    title: '指令快捷键',
    setup(ctx) {
      const p = ctx.platform
      if (!p.registerShortcut) return
      let registered: string[] = []
      const apply = () => {
        for (const a of registered) p.unregisterShortcut?.(a)
        registered = []
        for (const h of ctx.hotkeys()) {
          const ok = p.registerShortcut!(h.accelerator, () => void press(h).catch((e) => p.log?.(`快捷键 ${h.accelerator} 出错：${e.message}`)))
          if (ok) registered.push(h.accelerator)
          else p.log?.(`快捷键 ${h.accelerator} 注册失败（可能被占用）`)
        }
      }
      const press = async (h: { pluginId: string; label: string; autocopy?: boolean }) => {
        // autocopy：先复制当前选中内容，再按匹配指令进入
        if (h.autocopy && p.readSelection) {
          const input = await p.readSelection()
          const hit = ctx.emit(input).find((r: MatchResult) => r.pluginId === h.pluginId && r.label === h.label)
          if (hit) return ctx.enter({ pluginId: hit.pluginId, code: hit.code, type: hit.type, payload: hit.payload })
        }
        const hit = ctx.emit({ text: h.label }).find((r: MatchResult) => r.pluginId === h.pluginId && r.label === h.label && r.type === 'text')
        if (hit) await ctx.enter({ pluginId: hit.pluginId, code: hit.code, type: hit.type, payload: hit.payload })
      }
      apply()
      const off = ctx.onHotkeysChange(apply)
      return () => {
        off()
        for (const a of registered) p.unregisterShortcut?.(a)
      }
    },
  },
  {
    // 插件调用 launch.open（uTools 的 redirect）时用这个来源进入；移除它就等于禁用插件间跳转
    id: 'redirect',
    title: '插件跳转',
    setup() {},
  },
]

export function registerUtoolsSources(registry: { register(s: EntrySource): () => void }, only?: string[]): () => void {
  const offs = utoolsSources.filter((s) => !only || only.includes(s.id)).map((s) => registry.register(s))
  return () => offs.forEach((f) => f())
}
