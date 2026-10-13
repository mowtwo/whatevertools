// 打包用的默认入口：浏览器运行时 + uTools 兼容层（配置里 compat 只写注入名即可）+ 默认适配器（Canvas 版 sharp）
import { compat as utools } from '@whatevertools/compat-utools'
import { createCanvasSharp } from '@whatevertools/sharp-canvas'
import { boot as baseBoot, type WebBootConfig } from './index'

export type FullBootConfig = Omit<WebBootConfig, 'compat'> & { compat?: Array<{ type: 'utools'; name?: string }> }

export function boot(cfg: FullBootConfig) {
  return baseBoot({
    createSharp: (io) => createCanvasSharp(io) as (...a: unknown[]) => unknown,
    ...cfg,
    compat: (cfg.compat ?? []).map((c) => ({ layer: utools, name: c.name })),
  })
}
