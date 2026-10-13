// 权限模型：
// - 每项权限都是一个 id（如 fs.read、clipboard.read），可以带作用域（路径、域名、模块名）
// - 生效顺序：插件单独设置 > 全局默认设置 > 内置默认值
// - 取值：grant（授予）/ deny（拒绝）/ ask（用到时问用户，结果按插件记住）
// - 参考 Chrome 的网站权限：默认询问；只有插件自己的沙盒（自己的数据库和私有目录）默认放行；
//   询问时可以选「仅本次 / 始终允许 / 禁止」，关掉弹窗算本次会话拒绝，连续关掉 3 次自动转为禁止
// - 插件可以在 whatevertools.json 里声明 permissions（附带用途说明和作用域），声明只影响问询文案和作用域，不会自动授予

export type Decision = 'grant' | 'deny' | 'ask'

export interface PermissionInfo {
  id: string
  title: string
  description: string
  /** 内置默认值 */
  default: Decision
  /** 是否支持路径/域名等作用域 */
  scoped?: boolean
  risk: 'low' | 'medium' | 'high'
}

export const PERMISSIONS: PermissionInfo[] = [
  { id: 'storage', title: '插件数据库', description: 'db / kv，只能访问自己的数据', default: 'grant', risk: 'low' },
  { id: 'fs.plugin', title: '插件私有目录', description: '读写插件自己的数据目录和临时目录', default: 'grant', risk: 'low' },
  { id: 'fs.read', title: '读取文件', description: '读取任意（或指定范围内的）本地文件', default: 'ask', scoped: true, risk: 'medium' },
  { id: 'fs.write', title: '写入文件', description: '创建、修改、删除任意（或指定范围内的）本地文件', default: 'ask', scoped: true, risk: 'high' },
  { id: 'clipboard.write', title: '写入剪贴板', description: 'clipboard.writeText / writeImage / writeFiles', default: 'ask', risk: 'low' },
  { id: 'clipboard.read', title: '读取剪贴板', description: '读取剪贴板里的文字、图片和文件', default: 'ask', risk: 'medium' },
  { id: 'notification', title: '系统通知', description: 'system.notify', default: 'ask', risk: 'low' },
  { id: 'dialog', title: '文件对话框', description: '弹出打开/保存对话框，用户选中的路径会临时授予读写', default: 'ask', risk: 'low' },
  { id: 'shell.open', title: '打开文件', description: '用系统默认程序打开文件、在访达/资源管理器中显示', default: 'ask', risk: 'medium' },
  { id: 'shell.external', title: '打开链接', description: '用浏览器打开网址', default: 'ask', scoped: true, risk: 'low' },
  { id: 'shell.trash', title: '移到废纸篓', description: 'shell.trash', default: 'ask', risk: 'high' },
  { id: 'screen.read', title: '屏幕信息', description: '显示器列表、光标位置', default: 'ask', risk: 'low' },
  { id: 'screen.capture', title: '截屏', description: 'screen.selectRegion / capture / sources / pickColor', default: 'ask', risk: 'high' },
  { id: 'window.create', title: '独立窗口', description: 'window.create', default: 'ask', risk: 'low' },
  { id: 'window.overlay', title: '覆盖层窗口', description: '置顶、鼠标穿透、全屏透明、所有桌面可见', default: 'ask', risk: 'medium' },
  { id: 'input.paste', title: '粘贴到其他应用', description: 'input.pasteText / pasteFiles / pasteImage / typeText', default: 'ask', risk: 'medium' },
  { id: 'input.simulate', title: '模拟键鼠', description: 'input.keyTap / mouseMove / mouseClick', default: 'ask', risk: 'high' },
  { id: 'input.drag', title: '拖出文件', description: 'input.startDrag', default: 'ask', risk: 'low' },
  { id: 'network', title: '网络', description: 'Node http/https/net/dgram/tls 模块（页面里的 fetch 不受影响）', default: 'ask', scoped: true, risk: 'medium' },
  { id: 'process.spawn', title: '运行程序', description: 'child_process / worker_threads', default: 'ask', risk: 'high' },
  { id: 'process.native', title: '原生模块', description: '加载 .node 原生扩展', default: 'ask', risk: 'high' },
  { id: 'electron.raw', title: '未过滤的 Electron API', description: 'require("electron") 拿到完整对象，而不是兼容白名单；只能在权限设置里显式授予，不会弹窗询问', default: 'deny', risk: 'high' },
  { id: 'system.identity', title: '用户与设备信息', description: 'system.user / deviceId', default: 'ask', risk: 'medium' },
  { id: 'system.context', title: '前台应用上下文', description: 'system.activeFolder / activeBrowserUrl', default: 'ask', risk: 'medium' },
  { id: 'schedule', title: '定时任务', description: 'schedule.request', default: 'ask', risk: 'low' },
  { id: 'features', title: '动态功能', description: 'features.set / remove', default: 'ask', risk: 'low' },
  { id: 'redirect', title: '跳转其他插件', description: 'launch.open，向其他插件传数据', default: 'ask', risk: 'low' },
  { id: 'ai', title: 'AI 模型', description: 'ai.chat / models，消耗宿主配置的模型额度', default: 'ask', risk: 'medium' },
  { id: 'mcp', title: 'MCP 工具', description: '把注册的工具暴露给外部 AI Agent（MCP）', default: 'ask', risk: 'medium' },
  { id: 'browser', title: '自动化浏览器', description: 'browser.automate', default: 'ask', scoped: true, risk: 'high' },
  { id: 'media.ffmpeg', title: 'FFmpeg', description: 'media.ffmpeg', default: 'ask', risk: 'low' },
  { id: 'image.sharp', title: 'Sharp', description: 'image.sharp 图像处理', default: 'ask', risk: 'low' },
  { id: 'payment', title: '付费', description: 'billing.isPurchased / purchase', default: 'ask', risk: 'low' },
  // 插件页面自己发起的浏览器权限请求（getUserMedia、geolocation 等）
  { id: 'media.camera', title: '摄像头', description: '页面通过 getUserMedia 使用摄像头', default: 'ask', risk: 'high' },
  { id: 'media.microphone', title: '麦克风', description: '页面通过 getUserMedia 使用麦克风', default: 'ask', risk: 'high' },
  { id: 'geolocation', title: '位置', description: '页面读取地理位置', default: 'ask', risk: 'medium' },
  { id: 'device.hardware', title: '硬件设备', description: 'WebHID / WebSerial / WebUSB / MIDI', default: 'ask', risk: 'high' },
]

export const PERMISSION_MAP: Record<string, PermissionInfo> = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p]))

/** 一条授权：取值 + 可选作用域（路径前缀、域名通配、模块名） */
export interface Grant {
  decision: Decision
  scopes?: string[]
  /** 授予/拒绝的时间，供权限页展示 */
  at?: number
}

/** 问询的回答 */
export type PromptAnswer = 'once' | 'always' | 'block' | 'dismiss'

export type GrantInput = Decision | boolean | string[] | Grant

export interface PermissionPolicy {
  /** enforce：拒绝时抛错；warn：只记录；off：不检查 */
  mode?: 'enforce' | 'warn' | 'off'
  /** 覆盖内置默认值，对所有插件生效 */
  defaults?: Record<string, GrantInput>
  /** 每个插件单独的设置，优先级最高 */
  plugins?: Record<string, Record<string, GrantInput>>
  /** 连续关掉几次问询后自动转为禁止（Chrome 是 3 次），0 表示不自动禁止 */
  dismissLimit?: number
}

export function normalizeGrant(g: GrantInput | undefined): Grant | undefined {
  if (g === undefined) return undefined
  if (g === true) return { decision: 'grant' }
  if (g === false) return { decision: 'deny' }
  if (typeof g === 'string') return { decision: g }
  if (Array.isArray(g)) return { decision: 'grant', scopes: g }
  return g
}


export interface PermissionError extends Error {
  code: 'EWTPERM'
  permission: string
  scope?: string
}

export function permissionError(plugin: string, permission: string, scope?: string): PermissionError {
  const info = PERMISSION_MAP[permission]
  const err = new Error(
    `[whatevertools] 插件「${plugin}」没有权限「${info ? info.title : permission}」(${permission})${scope ? `：${scope}` : ''}`,
  ) as PermissionError
  err.code = 'EWTPERM'
  err.permission = permission
  err.scope = scope
  return err
}

/** 路径规范化（不依赖 Node）：统一分隔符、解析 . 和 ..、去掉结尾的 /；Windows 盘符路径转小写比较 */
export function normalizeScopePath(p: string): string {
  let s = String(p).replace(/\\/g, '/')
  if (s.startsWith('file://')) {
    try {
      s = decodeURIComponent(new URL(s).pathname).replace(/^\/([A-Za-z]:)/, '$1')
    } catch {}
  }
  const drive = /^[A-Za-z]:/.exec(s)?.[0] ?? ''
  const rest = drive ? s.slice(drive.length) : s
  const out: string[] = []
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const norm = (drive ? drive.toLowerCase() : '') + '/' + out.join('/')
  return drive ? norm.toLowerCase() : norm
}

function isPathLike(s: string) {
  return s.startsWith('/') || s.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(s)
}

/** 作用域匹配：路径按目录边界前缀（先规范化，a/../b 不能绕过），网址按主机名（*.example.com 通配），其他精确匹配。
 *  value 为 undefined 时由调用方决定（带作用域的授权遇到没有作用域的请求应当询问） */
export function scopeMatches(scopes: string[] | undefined, value: string | undefined): boolean {
  if (!scopes || !scopes.length) return true
  if (typeof value !== 'string') return false
  return scopes.some((raw) => {
    if (typeof raw !== 'string' || !raw) return false
    if (raw === '*') return true
    if (raw.startsWith('*.')) {
      const host = hostOf(value)
      return !!host && (host === raw.slice(2) || host.endsWith(raw.slice(1)))
    }
    if (isPathLike(raw)) {
      if (!isPathLike(value)) return false
      const a = normalizeScopePath(value)
      const b = normalizeScopePath(raw)
      return b === '/' || a === b || a.startsWith(b + '/')
    }
    const host = hostOf(value)
    return value === raw || (!!host && host === raw)
  })
}

function hostOf(v: string): string | undefined {
  try {
    const h = new URL(v).hostname
    return h || undefined
  } catch {
    return /^[a-z0-9.-]+$/i.test(v) ? v : undefined
  }
}

/** 一个插件的权限状态：负责判定，问询结果由宿主通过 remember 写回 */
export class PermissionSet {
  constructor(
    readonly pluginId: string,
    private policy: PermissionPolicy,
    /** 插件声明（或推断）要用的权限及作用域 */
    readonly requested: Record<string, string[] | true>,
    /** 用户已经回答过的问询：permission → grant */
    private remembered: Record<string, Grant> = {},
  ) {}

  get mode() {
    return this.policy.mode ?? 'enforce'
  }

  /** 用户主动交给插件的路径（对话框选中、拖入、作为功能输入），本次运行内可读/可写 */
  private granted: Record<string, Set<string>> = {}

  grantPath(permission: 'fs.read' | 'fs.write', path: string) {
    ;(this.granted[permission] ??= new Set()).add(path)
  }

  grantedPaths(permission: string): string[] {
    return [...(this.granted[permission] ?? [])]
  }

  /** 不考虑作用域时的结论 */
  resolve(permission: string): Grant {
    const own = normalizeGrant(this.policy.plugins?.[this.pluginId]?.[permission])
    if (own) return own
    const remembered = this.remembered[permission]
    if (remembered) return remembered
    const global = normalizeGrant(this.policy.defaults?.[permission])
    if (global) return global
    const session = this.session[permission]
    if (session) return session
    const info = PERMISSION_MAP[permission]
    const builtin: Decision = info ? info.default : 'ask'
    const req = this.requested[permission]
    return { decision: builtin, scopes: Array.isArray(req) ? req : undefined }
  }

  /** grant / deny / ask，带作用域判断 */
  check(permission: string, scope?: string): Decision {
    if (this.mode === 'off') return 'grant'
    const extra = this.granted[permission]
    if (extra && typeof scope === 'string' && scopeMatches([...extra], scope)) return 'grant'
    const g = this.resolve(permission)
    if (g.decision !== 'grant') return g.decision
    // 带作用域的授权：请求没有给出作用域时不能直接放行
    if (g.scopes?.length && typeof scope !== 'string') return 'ask'
    if (scopeMatches(g.scopes, scope)) return 'grant'
    // 有作用域但不在范围内：范围外的部分按询问处理（与 Chrome 对新目录再次询问一致）
    return 'ask'
  }

  /** 本次运行内有效的结论（仅本次 / 关掉弹窗） */
  private session: Record<string, Grant> = {}
  private dismissed: Record<string, number> = {}

  /** 把一次问询的回答记下来；返回需要持久化的变更（undefined 表示无需写盘） */
  answer(permission: string, answer: PromptAnswer, scopes?: string[]): Grant | undefined {
    const at = Date.now()
    switch (answer) {
      case 'once':
        this.session[permission] = { decision: 'grant', scopes, at }
        return undefined
      case 'always': {
        delete this.dismissed[permission]
        const prev = this.remembered[permission]
        const merged = scopes && prev?.decision === 'grant' && prev.scopes?.length ? [...new Set([...prev.scopes, ...scopes])] : scopes
        return (this.remembered[permission] = { decision: 'grant', scopes: merged, at })
      }
      case 'block':
        return (this.remembered[permission] = { decision: 'deny', at })
      case 'dismiss': {
        const n = (this.dismissed[permission] ?? 0) + 1
        this.dismissed[permission] = n
        const limit = this.policy.dismissLimit ?? 3
        if (limit > 0 && n >= limit) return (this.remembered[permission] = { decision: 'deny', at })
        this.session[permission] = { decision: 'deny', at }
        return undefined
      }
    }
  }

  /** 权限页手动设置；decision 为 ask 表示重置回询问 */
  set(permission: string, decision: Decision, scopes?: string[]) {
    delete this.session[permission]
    delete this.dismissed[permission]
    if (decision === 'ask') delete this.remembered[permission]
    else this.remembered[permission] = { decision, scopes, at: Date.now() }
  }

  reset() {
    this.remembered = {}
    this.session = {}
    this.dismissed = {}
  }

  snapshot(): Record<string, Grant> {
    const out: Record<string, Grant> = {}
    for (const p of PERMISSIONS) out[p.id] = this.resolve(p.id)
    return out
  }

  rememberedGrants(): Record<string, Grant> {
    return { ...this.remembered }
  }
}
