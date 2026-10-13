// 宿主面板适配器：承载插件主界面的「面板」（启动器窗口、独立应用窗口、网页里的容器……）由平台实现。
// 宿主对面板的所有操作都经过 hook `panel:<操作>`（如 panel:show、panel:detach、panel:input.set），
// 可以拦截、改参数或整个替换。平台做不到的操作不实现，supports() 会如实报告。
import type { MatchResult } from './entries'

/** 面板看到的插件（平台无关的最小信息） */
export interface PanelPlugin {
  id: string
  manifest: { name: string; logo: string; dir: string }
}

export interface PanelAdapter<P extends PanelPlugin = PanelPlugin, View = unknown, Prefs = unknown> {
  /** 为插件创建主界面视图（平台类型：Electron 是 WebContents，web 是 iframe/文档） */
  attach(plugin: P, prefs: Prefs): View
  show(plugin: P): void
  hide(plugin: P, focusPrev?: boolean): void
  /** 插件退出（kill 时销毁视图） */
  detachPlugin?(plugin: P, kill: boolean): void
  setExpandHeight?(plugin: P, height: number): boolean
  /** 面板里的输入框（插件把主搜索框借来用） */
  input?: {
    set(plugin: P, placeholder: string, focus: boolean): boolean
    remove(plugin: P): boolean
    setValue(plugin: P, text: string): boolean
    focus(plugin: P): boolean
    blur(plugin: P): void
    select(plugin: P): boolean
  }
  /** 分离成独立窗口 / 收回 */
  detach?(plugin: P): void
  reattach?(plugin: P): void
  /** 在光标附近弹出候选（超级面板等） */
  pick?(results: MatchResult[], opts?: { title?: string }): Promise<number | undefined>
  /** 显示主面板（可预填输入） */
  showMain?(input?: Record<string, unknown>): void
  /** 多个功能同名时让用户选 */
  chooseFeature?(candidates: Array<{ pluginId: string; code: string; label: string }>): Promise<number | undefined>
  /** 设置页（权限、快捷键） */
  openSettings?(focus?: string): void
  openHotkeySetting?(plugin: P, cmdLabel: string, autocopy: boolean): void
  /** 插件主界面所在的平台窗口（对话框父窗口等） */
  windowOf?(plugin: P): unknown
}

/** 面板操作名（hook 目标 panel:<op>） */
export type PanelOp =
  | 'show' | 'hide' | 'detachPlugin' | 'setExpandHeight' | 'detach' | 'reattach' | 'pick' | 'showMain' | 'chooseFeature'
  | 'openSettings' | 'openHotkeySetting' | 'input.set' | 'input.remove' | 'input.setValue' | 'input.focus' | 'input.blur' | 'input.select'
