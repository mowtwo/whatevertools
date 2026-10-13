// 唤起入口（action.from 的来源）：主面板、超级面板、快捷键、跳转、托盘、URL scheme……都是「来源」。
// core 只提供机制：
//   - 注册：registry.register(source)，经过 hook `source:register`（可改写、替换，返回 null 拒绝）
//   - 来源在 setup(ctx) 里接入平台能力（快捷键、读选中内容、弹候选面板……），
//     有输入时 ctx.emit(input) 交给匹配器，或 ctx.enter(...) 直接进入功能，from 自动填为来源 id
//   - 每次进入经过 hook `source:enter`（可改写或拦截），emit 经过 `source:emit`
// uTools 的 main / panel / hotkey / redirect 由 @whatevertools/compat-utools 默认注册。
import type { HookRegistry } from './hooks'
import type { EntryInput, MatchResult } from './entries'

export interface EnterRequest {
  pluginId: string
  code: string
  /** 入口类型（cmd.type） */
  type: string
  payload: unknown
  /** 附加信息（如搜索推送选中项 option） */
  option?: Record<string, unknown>
}

/** 平台提供给来源的能力；平台做不到的项可以不提供 */
export interface SourcePlatform {
  /** 注册全局快捷键，返回是否成功 */
  registerShortcut?(accelerator: string, onPress: () => void): boolean
  unregisterShortcut?(accelerator: string): void
  /** 读取当前前台应用里选中的内容（一般通过模拟复制） */
  readSelection?(): Promise<EntryInput>
  /** 读取剪贴板内容 */
  readClipboard?(): Promise<EntryInput>
  /** 当前前台窗口信息 */
  activeWindow?(): Promise<Record<string, unknown> | null>
  /** 在光标附近弹出候选列表，返回选中的下标（取消返回 undefined） */
  showPicker?(results: MatchResult[], opts?: { title?: string }): Promise<number | undefined>
  /** 显示主面板（搜索框），可带预填输入 */
  showMain?(input?: EntryInput): void
  log?(msg: string): void
}

export interface SourceContext {
  /** 来源 id（emit / enter 时作为 from） */
  readonly id: string
  readonly platform: SourcePlatform
  /** 宿主配置里给这个来源的选项（如超级面板的快捷键） */
  readonly options: Record<string, unknown>
  emit(input: EntryInput, meta?: Record<string, unknown>): MatchResult[]
  enter(req: EnterRequest): Promise<void>
  /** 指令快捷键表（hotkey 来源用）：pluginId → label → accelerator */
  hotkeys(): Array<{ pluginId: string; label: string; accelerator: string; autocopy?: boolean }>
  /** 监听指令快捷键表变化 */
  onHotkeysChange(fn: () => void): () => void
}

export interface EntrySource {
  id: string
  title?: string
  setup(ctx: SourceContext): void | (() => void)
}

export interface SourceHostAdapter {
  emit(input: EntryInput, meta: { from: string; [k: string]: unknown }): MatchResult[]
  enter(req: EnterRequest & { from: string }): Promise<void>
  hotkeys(): Array<{ pluginId: string; label: string; accelerator: string; autocopy?: boolean }>
  onHotkeysChange(fn: () => void): () => void
}

export class SourceRegistry {
  private sources = new Map<string, { source: EntrySource; dispose?: () => void }>()

  constructor(
    private hooks: HookRegistry,
    private host: SourceHostAdapter,
    private platform: SourcePlatform,
    /** 来源 id → 选项 */
    private options: Record<string, Record<string, unknown>> = {},
  ) {}

  register(source: EntrySource): () => void {
    const final = this.hooks.runApply('source:register', {}, null, [source], (a) => a[0]) as EntrySource | null
    if (!final) return () => {}
    this.unregister(final.id)
    const ctx = this.context(final.id)
    let dispose: (() => void) | undefined
    try {
      dispose = final.setup(ctx) || undefined
    } catch (e) {
      this.platform.log?.(`入口来源 ${final.id} 启动失败：${(e as Error).message}`)
    }
    this.sources.set(final.id, { source: final, dispose })
    return () => this.unregister(final.id)
  }

  unregister(id: string) {
    const s = this.sources.get(id)
    if (!s) return
    try {
      s.dispose?.()
    } catch {}
    this.sources.delete(id)
  }

  list(): Array<{ id: string; title?: string }> {
    return [...this.sources.values()].map(({ source }) => ({ id: source.id, title: source.title }))
  }

  /** 拿到某个来源的上下文（宿主自己实现的入口，如外壳的搜索框，也可以用它来发出 / 进入） */
  context(id: string): SourceContext {
    const host = this.host
    const hooks = this.hooks
    return {
      id,
      platform: this.platform,
      options: this.options[id] ?? {},
      emit: (input, meta = {}) =>
        hooks.runApply('source:emit', {}, null, [input, { ...meta, from: id }], (a) => host.emit(a[0] as EntryInput, a[1] as { from: string })) as MatchResult[],
      enter: async (req) => {
        const r = (await hooks.runApply('source:enter', { plugin: req.pluginId }, null, [{ ...req, from: id }], async (a) => a[0])) as (EnterRequest & { from: string }) | null
        if (r) await host.enter(r)
      },
      hotkeys: () => host.hotkeys(),
      onHotkeysChange: (fn) => host.onHotkeysChange(fn),
    }
  }

  dispose() {
    for (const id of [...this.sources.keys()]) this.unregister(id)
  }
}
