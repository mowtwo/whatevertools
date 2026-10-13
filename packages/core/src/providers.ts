// 提供者：用户信息、AI 模型、付费等「需要宿主自己接后端」的接口。
// 宿主通过配置传入实现；每次调用都经过 hook `provider:<名字>.<方法>`（如 provider:ai.models、provider:user.get），
// 可以拦截、改写参数或结果。没配置时走默认行为（见 DEFAULT_PROVIDER_BEHAVIOR）。
import type { HookRegistry } from './hooks'

export interface UserInfo { avatar: string; nickname: string; type: string; [k: string]: unknown }
export interface AiModelInfo { id: string; label: string; icon: string; cost?: number; vision?: boolean }

export interface ProviderContext {
  pluginId: string
  pluginName: string
}

export interface Providers {
  user?: {
    get(ctx: ProviderContext): UserInfo | null | Promise<UserInfo | null>
  }
  ai?: {
    models(ctx: ProviderContext): AiModelInfo[] | Promise<AiModelInfo[]>
    complete(
      ctx: ProviderContext,
      req: { model?: string; messages: unknown[]; tools?: unknown[] },
      io: { onChunk?: (chunk: unknown) => void; callTool: (name: string, args: unknown) => Promise<unknown>; signal: AbortSignal },
    ): Promise<unknown>
  }
  billing?: {
    isPurchased(ctx: ProviderContext): boolean | string | Promise<boolean | string>
    purchase(ctx: ProviderContext, options: { goodsId: string; outOrderId?: string; attach?: string }): Promise<boolean>
  }
  device?: {
    /** 设备 id（应按插件区分） */
    id(ctx: ProviderContext): string
  }
  context?: {
    activeFolder?(ctx: ProviderContext): Promise<string>
    activeBrowserUrl?(ctx: ProviderContext): Promise<string>
    /** 当前前台窗口（window 入口类型的匹配输入）：{ id, title, app, appPath, pid, x, y, width, height } */
    activeWindow?(ctx: ProviderContext): Promise<Record<string, unknown> | null>
  }
  /** 原生键鼠自动化（如 nut.js / robotjs）；没有时用平台内置的系统脚本模拟 */
  input?: {
    pasteText?(ctx: ProviderContext, text: string): Promise<boolean> | boolean
    pasteFiles?(ctx: ProviderContext, paths: string[]): Promise<boolean> | boolean
    pasteImage?(ctx: ProviderContext, image: unknown): Promise<boolean> | boolean
    typeText?(ctx: ProviderContext, text: string): Promise<boolean> | boolean
    keyTap?(ctx: ProviderContext, key: string, modifiers: string[]): Promise<void> | void
    mouseMove?(ctx: ProviderContext, x: number, y: number): Promise<void> | void
    mouseClick?(ctx: ProviderContext, x: number, y: number, button: 'left' | 'right', double: boolean): Promise<void> | void
  }
  /** 截图框选 / 取色界面（如换成系统截图工具）；返回 PNG Data URL / 颜色 */
  capture?: {
    selectRegion?(ctx: ProviderContext): Promise<string>
    pickColor?(ctx: ProviderContext): Promise<{ hex: string; rgb: string }>
  }
  /** ffmpeg：返回可执行文件路径（可以在这里引导用户下载安装） */
  media?: {
    ffmpegPath?(ctx: ProviderContext): string | Promise<string>
  }
  /** sharp：返回 sharp 函数（electron 默认 require('sharp')，web 可接 wasm 版） */
  image?: {
    sharp?(ctx: ProviderContext): (...args: unknown[]) => unknown
  }
  /** 自动化浏览器引擎（如换成 Playwright）：执行 browser.automate() 的指令队列 */
  browser?: {
    run?(ctx: ProviderContext, steps: Array<{ op: string; args: unknown[] }>, target: Record<string, unknown> | number | undefined): Promise<unknown[]>
  }
}

export const DEFAULT_PROVIDER_BEHAVIOR = {
  user: 'null（未登录）',
  ai: '不可用（ai.chat 报 EWTUNSUPPORTED，ai.models 返回空列表）',
  billing: '视为已购买；purchase 不可用',
  device: '本机随机 id 与插件 id 的哈希',
  context: '平台内置实现（macOS AppleScript），其他平台不可用',
  input: '平台内置的系统脚本模拟（macOS AppleScript / Windows SendKeys / Linux xdotool），鼠标模拟不可用',
  capture: '平台内置的框选 / 取色覆盖层',
  media: 'PATH 里的 ffmpeg 或 HostOptions.ffmpegPath',
  image: 'electron：宿主安装的 sharp；web：不可用',
  browser: 'electron：内置 BrowserWindow 执行器；web：不可用',
}

/** 调用提供者：经过 provider:<name>.<method> hook；没有实现时调用 fallback */
export function callProvider<T>(
  hooks: HookRegistry,
  providers: Providers,
  name: keyof Providers,
  method: string,
  ctx: ProviderContext,
  args: unknown[],
  fallback: () => T,
): T {
  const impl = (providers[name] as Record<string, (...a: unknown[]) => unknown> | undefined)?.[method]
  return hooks.runApply(`provider:${name}.${method}`, { plugin: ctx.pluginId }, null, args, (a) => (impl ? impl.call(providers[name], ctx, ...a) : fallback())) as T
}
