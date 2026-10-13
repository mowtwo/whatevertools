// 入口（关键字触发）引擎：把各种来源的输入和插件声明的 cmds 对上。
// core 只提供机制，不内置任何入口类型：
//   - 注册：registry.register(type)，经过 hook `entry:register`（可以改写、替换或拒绝注册，返回 null 即拒绝）
//   - 匹配：每种类型的匹配经过 hook `entry:match.<type>`（可以改写输入、改结果、补充匹配）
//   - 调用：registry.emit(input, meta) —— 搜索框、粘贴、拖入、快捷键、URL scheme 或任何自定义来源都用它，
//           经过 hook `entry:emit`（可以改写输入或结果），然后通知 onEmit 监听者
// uTools 的 text / regex / over / img / files / window 由 @whatevertools/compat-utools 作为默认类型注册。
import type { HookRegistry } from './hooks'
import { featureOnPlatform, type Feature } from './manifest'

/** 一条 cmd：字符串 cmd 视为 { type: 'text', label } */
export interface EntryCmd {
  type: string
  label: string
  [k: string]: unknown
}

/** 输入是开放的键值：text、files、image、window，或任何自定义字段 */
export type EntryInput = Record<string, unknown>

export interface EntryContext {
  platform: string
  /** 宿主提供的额外文字匹配（如拼音），返回 0~1，0 表示不匹配 */
  textScorer?: (query: string, label: string) => number
}

export interface EntryHit {
  /** 进入插件时 action.payload */
  payload: unknown
  /** 0~100，越大越靠前 */
  score: number
}

export interface EntryType {
  /** cmd.type */
  type: string
  /** 字符串 cmd 归到哪个类型（只能有一个类型声明 handlesString） */
  handlesString?: boolean
  match(cmd: EntryCmd, input: EntryInput, ctx: EntryContext): EntryHit | null
  /** 校验 cmd，返回问题描述 */
  validate?(cmd: EntryCmd): string | null
}

export interface MatchResult {
  pluginId: string
  code: string
  label: string
  type: string
  payload: unknown
  score: number
  /** 功能声明了 hidePanel */
  hidePanel?: boolean
}

export interface MatchSource {
  pluginId: string
  features: Feature[]
}

export interface EmitMeta {
  /** 来源：main（搜索框）、paste、drop、hotkey、url 或自定义 */
  from: string
  [k: string]: unknown
}

export class EntryRegistry {
  private types = new Map<string, EntryType>()
  private listeners = new Set<(results: MatchResult[], input: EntryInput, meta: EmitMeta) => void>()

  constructor(
    private hooks: HookRegistry,
    /** 匹配时用到的插件功能（宿主提供，包括动态功能） */
    private sources: () => MatchSource[],
    private ctx: EntryContext,
  ) {}

  register(t: EntryType): () => void {
    const final = this.hooks.runApply('entry:register', {}, null, [t], (a) => a[0]) as EntryType | null
    if (!final) return () => {}
    if (final.handlesString) {
      for (const other of this.types.values()) if (other.handlesString && other.type !== final.type) other.handlesString = false
    }
    this.types.set(final.type, final)
    return () => {
      if (this.types.get(final.type) === final) this.types.delete(final.type)
    }
  }

  unregister(type: string) {
    this.types.delete(type)
  }

  get(type: string) {
    return this.types.get(type)
  }

  list(): string[] {
    return [...this.types.keys()]
  }

  /** cmd 规范化：字符串 → 处理字符串的类型 */
  normalize(cmd: unknown): EntryCmd | null {
    if (typeof cmd === 'string') {
      const t = [...this.types.values()].find((x) => x.handlesString)
      return t ? { type: t.type, label: cmd } : null
    }
    if (cmd && typeof cmd === 'object' && typeof (cmd as EntryCmd).type === 'string') return cmd as EntryCmd
    return null
  }

  /** 校验插件的 cmds（未注册的类型会列出来，但不算错误，可能由宿主之后注册） */
  validate(features: Feature[]): { problems: string[]; unknownTypes: string[] } {
    const problems: string[] = []
    const unknown = new Set<string>()
    for (const f of features) {
      for (const raw of f.cmds) {
        const cmd = this.normalize(raw)
        if (!cmd) continue
        const t = this.types.get(cmd.type)
        if (!t) unknown.add(cmd.type)
        else {
          const p = t.validate?.(cmd)
          if (p) problems.push(`${f.code}: ${p}`)
        }
      }
    }
    return { problems, unknownTypes: [...unknown] }
  }

  /** 只匹配不通知 */
  match(input: EntryInput): MatchResult[] {
    const out: MatchResult[] = []
    for (const src of this.sources()) {
      for (const f of src.features) {
        if (!featureOnPlatform(f, this.ctx.platform)) continue
        for (const raw of f.cmds) {
          const cmd = this.normalize(raw)
          if (!cmd) continue
          const t = this.types.get(cmd.type)
          if (!t) continue
          const hit = this.hooks.runApply(`entry:match.${cmd.type}`, { plugin: src.pluginId }, null, [cmd, input, this.ctx], (a) =>
            t.match(a[0] as EntryCmd, a[1] as EntryInput, a[2] as EntryContext),
          ) as EntryHit | null
          if (hit) out.push({ pluginId: src.pluginId, code: f.code, label: cmd.label, type: cmd.type, payload: hit.payload, score: hit.score, hidePanel: f.hidePanel })
        }
      }
    }
    // 同一功能、同一类型只留得分最高的一条
    const best = new Map<string, MatchResult>()
    for (const r of out) {
      const k = `${r.pluginId}\u0000${r.code}\u0000${r.type}`
      const prev = best.get(k)
      if (!prev || prev.score < r.score) best.set(k, r)
    }
    return [...best.values()].sort((a, b) => b.score - a.score)
  }

  /** 发出一次输入：匹配后通知监听者，返回结果 */
  emit(input: EntryInput, meta: EmitMeta = { from: 'main' }): MatchResult[] {
    const results = this.hooks.runApply('entry:emit', {}, null, [input, meta], (a) => this.match(a[0] as EntryInput)) as MatchResult[]
    for (const fn of this.listeners) fn(results, input, meta)
    return results
  }

  onEmit(fn: (results: MatchResult[], input: EntryInput, meta: EmitMeta) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

/** 通用的文字打分（前缀 > 包含 > 子序列），供入口类型复用 */
export function scoreText(query: string, label: string): number {
  const q = query.trim().toLowerCase()
  const l = label.toLowerCase()
  if (!q) return 0
  if (l === q) return 1
  if (l.startsWith(q)) return 0.9
  if (l.includes(q)) return 0.7
  let i = 0
  for (const ch of l) if (ch === q[i]) i++
  return i === q.length ? 0.4 : 0
}

/** 解析 "/.../flags" 形式的正则 */
export function parseRegexLiteral(literal: string): RegExp | null {
  const m = /^\/(.*)\/([dgimsuvy]*)$/s.exec(literal)
  if (!m) return null
  try {
    return new RegExp(m[1], m[2].replace(/[gy]/g, ''))
  } catch {
    return null
  }
}
