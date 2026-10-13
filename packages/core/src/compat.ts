// 兼容层注册：一个兼容层描述了「怎样让为某个旧平台写的插件跑起来」。
// 平台运行时不直接依赖任何兼容层包，而是遍历宿主配置里的兼容层描述：
//   - createApi：在插件进程里，用原生 API 生成兼容对象（注入为全局变量）
//   - entryTypes / sources：宿主侧默认的入口类型和唤起来源
//   - manifestLoader：旧平台的描述文件格式
//   - identityMock：伪装平台的默认身份（getAppName / getAppVersion）
import type { EntryType } from './entries'
import type { EntrySource } from './sources'
import type { HookRegistry } from './hooks'
import type { ManifestLoader } from './manifest'
import type { NameVersion } from './apis'

export interface CompatLayerDescriptor {
  id: string
  /** 默认注入名 */
  defaultName: string
  createApi(nativeApi: unknown, opts: { name: string; hooks?: HookRegistry }): unknown
  entryTypes?: EntryType[]
  sources?: EntrySource[]
  manifestLoader?: ManifestLoader
  identityMock?: { platform: NameVersion; runtime?: NameVersion }
}

/** 宿主配置里的一项兼容层：描述对象，或者导出 compat 描述的模块（插件进程按模块路径加载） */
export interface CompatLayerConfig {
  /** 模块 id 或绝对路径，模块导出 `compat: CompatLayerDescriptor` */
  module?: string
  layer?: CompatLayerDescriptor
  /** 注入名（默认 layer.defaultName） */
  name?: string
  /** 只启用描述里的哪些部分（默认全部） */
  use?: { api?: boolean; entryTypes?: boolean; sources?: boolean; manifest?: boolean }
}
