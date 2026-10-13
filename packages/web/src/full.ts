// 打包用的默认入口：浏览器运行时 + uTools 兼容层（配置里 compat 只写注入名即可）
import { compat as utools } from '@whatevertools/compat-utools'
import { boot as baseBoot, type WebBootConfig } from './index'

export type FullBootConfig = Omit<WebBootConfig, 'compat'> & { compat?: Array<{ type: 'utools'; name?: string }> }

export function boot(cfg: FullBootConfig) {
  return baseBoot({ ...cfg, compat: (cfg.compat ?? []).map((c) => ({ layer: utools, name: c.name })) })
}
