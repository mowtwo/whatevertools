import type { WebContents, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { PanelAdapter } from '@whatevertools/core'
import type { PluginRuntime } from './plugin'
import type { WhateverToolsHost } from './host'
import type { WindowKind } from '../shared/protocol'

export interface CallCtx {
  host: WhateverToolsHost
  plugin: PluginRuntime
  /** 调用方的 webContents（主界面或自定义窗口） */
  wc: WebContents
  kind: WindowKind
  event?: IpcMainEvent | IpcMainInvokeEvent
}

export type Handler = (c: CallCtx, ...args: any[]) => unknown

export type { EnterAction } from '@whatevertools/core'

/** 界面外壳：Electron 平台的面板适配器（core 的 PanelAdapter，视图是 WebContents） */
export type Shell = PanelAdapter<PluginRuntime, WebContents, Electron.WebPreferences> & {
  windowOf?(plugin: PluginRuntime): Electron.BrowserWindow | null
}

export interface PermissionPromptRequest {
  plugin: PluginRuntime
  permission: string
  scope?: string
  reason?: string
}

export type PermissionPromptAnswer = 'once' | 'always' | 'block' | 'dismiss'

export type { Providers, UserInfo, AiModelInfo, ProviderContext } from '@whatevertools/core'
