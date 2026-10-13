// 插件安装策略（平台无关）：宿主允许用户动态安装插件包（upx / asar / zip）时用它判断能不能装。
// 宿主侧还有 plugin:install hook（apply，args[0] 是 InstallCandidate，返回 false 拒绝），可以接自己的审核、签名校验或界面。
import type { PermissionRequest } from './manifest'

export interface InstallPolicy {
  /** 是否允许动态安装（启动器默认允许，独立应用默认不允许） */
  enabled?: boolean
  /** 最多装多少个（只算动态安装的，不算宿主固定带的插件） */
  max?: number
  /** 允许的插件 id，支持 * 通配；不写表示不限 */
  allow?: string[]
  /** 禁止的插件 id，支持 * 通配；优先于 allow */
  deny?: string[]
  /** 允许的包格式，默认 upx / asar / zip */
  formats?: string[]
  /** 安装前是否让用户确认，默认 true */
  confirm?: boolean
}

export interface InstallCandidate {
  id: string
  name: string
  version: string
  description: string
  /** 包格式：upx / asar / zip / dir */
  format: string
  /** 插件声明的权限（用于确认界面） */
  permissions: Record<string, PermissionRequest>
  /** 已经装了同一个插件时的旧版本（升级） */
  previousVersion?: string
  /** 来源（文件路径、网址等，仅用于展示） */
  source?: string
}

export interface InstalledRecord {
  id: string
  version: string
  dir: string
  format: string
  source?: string
  installedAt: number
}

const glob = (pattern: string) => new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
const matchAny = (patterns: string[] | undefined, id: string) => !!patterns?.some((p) => glob(p).test(id))

/** 返回不允许安装的原因；可以装返回 null */
export function checkInstall(policy: InstallPolicy, cand: InstallCandidate, installed: InstalledRecord[]): string | null {
  if (policy.enabled === false) return '这个应用不允许安装插件'
  const formats = policy.formats ?? ['upx', 'asar', 'zip', 'dir']
  if (!formats.includes(cand.format)) return `不允许安装 ${cand.format} 格式的插件包`
  if (matchAny(policy.deny, cand.id)) return `插件 ${cand.id} 在禁止名单里`
  if (policy.allow && !matchAny(policy.allow, cand.id)) return `插件 ${cand.id} 不在允许名单里`
  const upgrading = installed.some((r) => r.id === cand.id)
  if (!upgrading && policy.max !== undefined && installed.length >= policy.max) return `最多只能安装 ${policy.max} 个插件`
  return null
}
