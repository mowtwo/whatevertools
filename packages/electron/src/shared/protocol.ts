// main 与 preload 之间的通信协议。所有通道以 whatevertools: 开头，插件自己的通道不要用这个前缀。
import type { Identity, Grant, PluginManifest } from '@whatevertools/core'

export const CH = {
  /** sendSync：preload 启动时取上下文 */
  context: 'whatevertools:context',
  /** sendSync：同步 API 调用 [method, args] */
  sync: 'whatevertools:sync',
  /** invoke：异步 API 调用 [method, args] */
  call: 'whatevertools:call',
  /** sendSync：权限检查 [permission, scope] → PermResult */
  perm: 'whatevertools:perm',
  /** sendSync / invoke：窗口方法 [winId, 'win' | 'wc', method, args] */
  winSync: 'whatevertools:win-sync',
  winCall: 'whatevertools:win-call',
  /** main → preload：事件 [name, ...args] */
  event: 'whatevertools:event',
  /** main → preload：需要回复的请求 [id, name, ...args] */
  request: 'whatevertools:request',
  /** preload → main：请求的回复 [id, ok, value | error] */
  reply: 'whatevertools:reply',
  /** preload → main：页面和 onPluginReady 都完成 */
  ready: 'whatevertools:ready',
  /** preload → main：流式数据（ai 分片、工具进度等）[streamId, data] */
  stream: 'whatevertools:stream',
} as const

export type WindowKind = 'main' | 'detach' | 'custom'

export interface BridgeContext {
  pluginId: string
  manifest: PluginManifest
  identity: Identity
  windowKind: WindowKind
  /** 插件 preload 的绝对路径（没有则为空） */
  preload?: string
  /** 原生 API 的注入名（默认 whatevertools，可自定义） */
  apiName: string
  /** 兼容层：在插件进程里按模块路径加载，用原生 API 生成兼容对象注入为 name */
  compat: Array<{ module: string; name: string }>
  paths: { dir: string; data: string; temp: string }
  /** 渲染进程可以直接用的权限结论（避免每次 fs 调用都走 IPC） */
  grants: Record<string, Grant>
  isDev: boolean
  /** 宿主额外的渲染进程 hook 模块（绝对路径），在插件 preload 之前加载 */
  rendererHooks: string[]
  ffmpegPath?: string
  /** 不能用 API 时的行为：throw 抛错；warn 只打印并返回 undefined */
  unsupported: 'throw' | 'warn'
}

/** 宿主配置里的兼容层：完整写法是 core 的 CompatLayerConfig；`{ type: 'utools' }` 是 uTools 兼容层的简写 */
export type CompatLayer = import('@whatevertools/core').CompatLayerConfig | { type: 'utools'; name?: string }

export interface PermResult {
  decision: 'grant' | 'deny'
  /** 结论可以在渲染进程缓存（没有作用域限制时） */
  cacheable: boolean
}

/** 跨进程传递的错误 */
export interface WireError {
  message: string
  code?: string
  name?: string
  data?: unknown
}

/** NativeImage 跨进程传递时的形式 */
export interface WireImage {
  __whatevertoolsImage: true
  png: Uint8Array
  width: number
  height: number
}
