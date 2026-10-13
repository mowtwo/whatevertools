// 权限管理器：所有平台共用的权限编排。平台只提供存储（HostStore）和问询界面（PermissionPrompter）。
// hook：
//   permission:check   apply(args=[permission, scope]) → 'grant' | 'deny' | 'ask'，可改写结论
//   permission:prompt  apply(args=[request]) → 回答，可替换问询界面
//   permission:change  apply(args=[pluginId, permission]) 变化通知（返回值忽略）
import type { HookRegistry } from './hooks'
import type { HostStore } from './store'
import { normalizeScopePath, PERMISSION_MAP, PermissionSet, permissionError, type Decision, type Grant, type PermissionInfo, type PermissionPolicy, type PromptAnswer } from './permissions'

export interface PromptRequest {
  pluginId: string
  pluginName: string
  permission: string
  scope?: string
  /** 插件在描述文件里写的用途说明 */
  reason?: string
  info?: PermissionInfo
}

export interface PermissionPrompter {
  prompt(req: PromptRequest): Promise<PromptAnswer>
  /** 同步问询（浏览器 confirm 之类）；没有时同步检查遇到「询问」按拒绝处理 */
  promptSync?(req: PromptRequest): PromptAnswer
}

export interface PermissionManagerOptions {
  policy?: PermissionPolicy
  store: HostStore
  prompter: PermissionPrompter
  hooks: HookRegistry
  /** 「始终允许」时授予的范围（默认：路径就是这个路径，网址授予主机名） */
  scopeRoot?: (permission: string, scope: string) => string
}

interface PluginEntry {
  set: PermissionSet
  name: string
  permissions: Record<string, { reason?: string; scopes?: string[] }>
}

const KEY = (id: string) => `grants/${id}`

function defaultScopeRoot(permission: string, scope: string) {
  if (permission.startsWith('fs.')) return normalizeScopePath(scope)
  try {
    return new URL(scope).hostname || scope
  } catch {
    return scope
  }
}

export class PermissionManager {
  private plugins = new Map<string, PluginEntry>()
  private prompts = new Map<string, Promise<void>>()
  private listeners = new Set<(pluginId: string, permission: string) => void>()

  constructor(private o: PermissionManagerOptions) {}

  /** 登记插件（加载插件时调用），返回它的权限状态 */
  register(pluginId: string, pluginName: string, permissions: Record<string, { reason?: string; scopes?: string[] }> = {}): PermissionSet {
    const requested = Object.fromEntries(Object.entries(permissions).map(([k, v]) => [k, v.scopes ?? (true as const)]))
    const set = new PermissionSet(pluginId, this.o.policy ?? {}, requested, this.o.store.get<Record<string, Grant>>(KEY(pluginId)) ?? {})
    this.plugins.set(pluginId, { set, name: pluginName, permissions })
    return set
  }

  unregister(pluginId: string) {
    this.plugins.delete(pluginId)
  }

  get(pluginId: string): PermissionSet {
    const e = this.plugins.get(pluginId)
    if (!e) throw new Error(`[whatevertools] 没有登记的插件：${pluginId}`)
    return e.set
  }

  /** 不问询的检查（经过 permission:check hook） */
  check(pluginId: string, permission: string, scope?: string): Decision {
    const set = this.get(pluginId)
    return this.o.hooks.runApply('permission:check', { plugin: pluginId }, null, [permission, scope], (a) => set.check(a[0] as string, a[1] as string | undefined)) as Decision
  }

  /** 检查，需要时问用户；拒绝时抛 EWTPERM（warn 模式只记录） */
  async permit(pluginId: string, permission: string, scope?: string): Promise<void> {
    const set = this.get(pluginId)
    let d = this.check(pluginId, permission, scope)
    if (d === 'ask') {
      await this.ask(pluginId, permission, scope)
      d = this.check(pluginId, permission, scope)
      if (d === 'ask') d = 'deny'
    }
    if (d === 'grant') return
    const err = permissionError(pluginId, permission, scope)
    if (set.mode === 'warn') return
    throw err
  }

  /** 同步检查：能同步问询的平台会弹窗，否则「询问」按拒绝处理 */
  checkSync(pluginId: string, permission: string, scope?: string): boolean {
    let d = this.check(pluginId, permission, scope)
    if (d === 'ask' && this.o.prompter.promptSync) {
      const answer = this.o.hooks.runApply('permission:prompt', { plugin: pluginId }, null, [this.request(pluginId, permission, scope)], (a) => this.o.prompter.promptSync!(a[0] as PromptRequest)) as PromptAnswer
      this.apply(pluginId, permission, scope, answer)
      d = this.check(pluginId, permission, scope)
    }
    return d === 'grant'
  }

  private request(pluginId: string, permission: string, scope?: string): PromptRequest {
    const e = this.plugins.get(pluginId)!
    return { pluginId, pluginName: e.name, permission, scope, reason: e.permissions[permission]?.reason, info: PERMISSION_MAP[permission] }
  }

  private ask(pluginId: string, permission: string, scope?: string): Promise<void> {
    // 同一个插件、同一项权限、同一个作用域同时只问一次
    const key = `${pluginId}\u0000${permission}\u0000${scope ?? ''}`
    const running = this.prompts.get(key)
    if (running) return running
    const p = (async () => {
      const req = this.request(pluginId, permission, scope)
      const answer = (await this.o.hooks.runApply('permission:prompt', { plugin: pluginId }, null, [req], (a) => this.o.prompter.prompt(a[0] as PromptRequest))) as PromptAnswer
      this.apply(pluginId, permission, scope, answer)
    })().finally(() => this.prompts.delete(key))
    this.prompts.set(key, p)
    return p
  }

  private apply(pluginId: string, permission: string, scope: string | undefined, answer: PromptAnswer) {
    const set = this.get(pluginId)
    const info = PERMISSION_MAP[permission]
    const scopes = scope && info?.scoped ? [(this.o.scopeRoot ?? defaultScopeRoot)(permission, scope)] : undefined
    const persisted = set.answer(permission, answer, scopes)
    if (answer === 'once' && scope && info?.scoped && (permission === 'fs.read' || permission === 'fs.write')) set.grantPath(permission, scope)
    if (persisted) this.save(pluginId)
    this.changed(pluginId, permission)
  }

  /** 设置页手动修改 */
  set(pluginId: string, permission: string, decision: Decision, scopes?: string[]) {
    this.get(pluginId).set(permission, decision, scopes)
    this.save(pluginId)
    this.changed(pluginId, permission)
  }

  reset(pluginId: string) {
    this.get(pluginId).reset()
    this.save(pluginId)
    this.changed(pluginId, '*')
  }

  /** 用户主动交给插件的路径（对话框、拖入），本次运行内可读写 */
  grantPath(pluginId: string, permission: 'fs.read' | 'fs.write', path: string) {
    this.get(pluginId).grantPath(permission, path)
    this.changed(pluginId, permission)
  }

  /** 可以在插件进程缓存的结论：不带作用域的授予，以及拒绝 */
  cacheable(pluginId: string): Record<string, Grant> {
    const set = this.get(pluginId)
    const out: Record<string, Grant> = {}
    for (const [k, g] of Object.entries(set.snapshot())) {
      if (g.decision === 'grant' && !g.scopes?.length) out[k] = g
      else if (g.decision === 'deny' && set.mode === 'enforce') out[k] = g
    }
    return out
  }

  onChange(fn: (pluginId: string, permission: string) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private save(pluginId: string) {
    this.o.store.set(KEY(pluginId), this.get(pluginId).rememberedGrants())
  }

  private changed(pluginId: string, permission: string) {
    this.o.hooks.runApply('permission:change', { plugin: pluginId }, null, [pluginId, permission], () => undefined)
    for (const fn of this.listeners) fn(pluginId, permission)
  }
}
