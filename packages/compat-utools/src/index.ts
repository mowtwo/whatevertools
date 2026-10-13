// uTools 兼容层：只依赖 whatevertools 原生 API，把它映射成 window.utools 的形状。
// 宿主注入时：window[name] = createUtoolsCompat(whatevertools, { hooks })；hook 目标前缀是 `<name>:`，如 utools:ubrowser、utools:db.put。
import type { HookRegistry } from '@whatevertools/core'
import type { WhateverToolsApi } from '@whatevertools/api'

export interface UtoolsCompatOptions {
  /** 注入名，也是 hook 前缀（默认 utools） */
  name?: string
  hooks?: HookRegistry
}

export function createUtoolsCompat(f: WhateverToolsApi, opts: UtoolsCompatOptions = {}): any {
  const name = opts.name ?? 'utools'
  const async = <A extends unknown[], R>(fn: (...a: A) => R) => async (...a: A): Promise<Awaited<R>> => fn(...a) as Awaited<R>
  const db = {
    put: f.db.put,
    get: f.db.get,
    remove: f.db.remove,
    bulkDocs: f.db.bulk,
    allDocs: f.db.all,
    postAttachment: f.db.putAttachment,
    getAttachment: f.db.getAttachment,
    getAttachmentType: f.db.getAttachmentType,
    replicateStateFromCloud: f.db.syncState,
    promises: {
      put: async(f.db.put),
      get: async(f.db.get),
      remove: async(f.db.remove),
      bulkDocs: async(f.db.bulk),
      allDocs: async(f.db.all),
      postAttachment: f.db.promises.putAttachment,
      getAttachment: f.db.promises.getAttachment,
      getAttachmentType: async(f.db.getAttachmentType),
      replicateStateFromCloud: async(f.db.syncState),
    },
  }
  const raw: Record<string, unknown> = {
    // 事件
    onPluginReady: f.lifecycle.onReady,
    onPluginEnter: f.lifecycle.onEnter,
    onPluginOut: f.lifecycle.onLeave,
    onPluginDetach: f.lifecycle.onDetach,
    onMainPush: f.lifecycle.onSearchPush,
    onDbPull: f.db.onPull,
    onScheduleTrigger: f.schedule.onTrigger,
    // 窗口
    createBrowserWindow: f.window.create,
    sendToParent: f.window.sendToParent,
    getWindowType: () => f.window.type,
    hideMainWindow: f.panel.hide,
    showMainWindow: f.panel.show,
    setExpandHeight: f.panel.setHeight,
    setSubInput: f.panel.input.set,
    removeSubInput: f.panel.input.remove,
    setSubInputValue: f.panel.input.setValue,
    subInputFocus: f.panel.input.focus,
    subInputBlur: f.panel.input.blur,
    subInputSelect: f.panel.input.select,
    findInPage: f.page.find,
    stopFindInPage: f.page.stopFind,
    outPlugin: f.lifecycle.exit,
    // 动态功能 / 跳转
    getFeatures: f.features.list,
    setFeature: f.features.set,
    removeFeature: f.features.remove,
    redirect: f.launch.open,
    redirectHotKeySetting: f.hotkeys.openSettings,
    getCmdHotKey: f.hotkeys.get,
    // 数据库
    db,
    dbStorage: { setItem: f.kv.set, getItem: f.kv.get, removeItem: f.kv.remove },
    // 屏幕
    captureDisplay: (o: { displayId?: number } = {}) => f.screen.captureDisplay(o?.displayId),
    screenCapture: f.screen.captureRegion,
    screenColorPick: f.screen.pickColor,
    getAllDisplays: f.screen.displays,
    getPrimaryDisplay: f.screen.primaryDisplay,
    getCursorScreenPoint: f.screen.cursor,
    getDisplayNearestPoint: f.screen.nearestDisplay,
    getDisplayMatching: f.screen.matchingDisplay,
    screenToDipPoint: f.screen.toDipPoint,
    dipToScreenPoint: f.screen.toScreenPoint,
    screenToDipRect: f.screen.toDipRect,
    dipToScreenRect: f.screen.toScreenRect,
    desktopCaptureSources: f.screen.captureSources,
    // 系统
    getPluginLocalDataPath: f.paths.data,
    getPluginTempPath: f.paths.temp,
    getPath: f.paths.get,
    showNotification: f.system.notify,
    showOpenDialog: f.dialog.open,
    showSaveDialog: f.dialog.save,
    shellOpenPath: f.shell.openPath,
    shellTrashItem: f.shell.trash,
    shellShowItemInFolder: f.shell.showInFolder,
    shellOpenExternal: f.shell.openExternal,
    shellBeep: f.shell.beep,
    getNativeId: f.device.id,
    getAppName: f.system.appName,
    getAppVersion: f.system.appVersion,
    getUser: f.account.user,
    getFileIcon: f.system.fileIcon,
    getFileIconAsync: f.system.fileIconAsync,
    readCurrentFolderPath: f.context.activeFolder,
    readCurrentBrowserUrl: f.context.activeBrowserUrl,
    isDev: f.system.isDev,
    isMacOS: f.system.isMac,
    isWindows: f.system.isWindows,
    isLinux: f.system.isLinux,
    isDarkColors: f.system.isDark,
    // 复制
    copyText: f.clipboard.writeText,
    copyImage: f.clipboard.writeImage,
    copyFile: f.clipboard.writeFiles,
    getCopiedFiles: f.clipboard.readFiles,
    // 输入
    hideMainWindowPasteText: f.input.sendText,
    hideMainWindowPasteFile: f.input.sendFiles,
    hideMainWindowPasteImage: f.input.sendImage,
    hideMainWindowTypeString: f.input.typeText,
    startDrag: f.input.startDrag,
    simulateKeyboardTap: f.input.keyTap,
    simulateMouseMove: f.input.mouseMove,
    simulateMouseClick: f.input.mouseClick,
    simulateMouseDoubleClick: f.input.mouseDoubleClick,
    simulateMouseRightClick: f.input.mouseRightClick,
    // 定时任务
    requestSchedule: f.schedule.request,
    getSchedules: f.schedule.list,
    removeSchedule: f.schedule.remove,
    // 付费
    isPurchasedUser: f.billing.isPurchased,
    openPurchase: f.billing.purchase,
    // AI
    registerTool: f.tools.register,
    ai: f.ai.chat,
    allAiModels: f.ai.models,
    // 多媒体
    runFFmpeg: f.media.ffmpeg,
    sharp: f.image.sharp,
    // 自动化浏览器
    getIdleUBrowsers: f.browser.idle,
    setUBrowserProxy: f.browser.setProxy,
    clearUBrowserCache: f.browser.clearCache,
  }
  // ubrowser 每次访问都是一条新的指令链
  Object.defineProperty(raw, 'ubrowser', { enumerable: true, get: () => f.browser.automate() })
  return opts.hooks ? opts.hooks.wrap(raw, `${name}:`, {}, { depth: 3 }) : raw
}

/** 兼容层里所有的旧名（自检和文档用） */
export const UTOOLS_NAMES = [
  'onPluginReady', 'onPluginEnter', 'onPluginOut', 'onPluginDetach', 'onMainPush', 'onDbPull', 'onScheduleTrigger',
  'createBrowserWindow', 'sendToParent', 'getWindowType', 'hideMainWindow', 'showMainWindow', 'setExpandHeight',
  'setSubInput', 'removeSubInput', 'setSubInputValue', 'subInputFocus', 'subInputBlur', 'subInputSelect', 'findInPage',
  'stopFindInPage', 'outPlugin', 'getFeatures', 'setFeature', 'removeFeature', 'redirect', 'redirectHotKeySetting',
  'getCmdHotKey', 'db', 'dbStorage', 'captureDisplay', 'screenCapture', 'screenColorPick', 'getAllDisplays',
  'getPrimaryDisplay', 'getCursorScreenPoint', 'getDisplayNearestPoint', 'getDisplayMatching', 'screenToDipPoint',
  'dipToScreenPoint', 'screenToDipRect', 'dipToScreenRect', 'desktopCaptureSources', 'getPluginLocalDataPath',
  'getPluginTempPath', 'getPath', 'showNotification', 'showOpenDialog', 'showSaveDialog', 'shellOpenPath', 'shellTrashItem',
  'shellShowItemInFolder', 'shellOpenExternal', 'shellBeep', 'getNativeId', 'getAppName', 'getAppVersion', 'getUser',
  'getFileIcon', 'getFileIconAsync', 'readCurrentFolderPath', 'readCurrentBrowserUrl', 'isDev', 'isMacOS', 'isWindows',
  'isLinux', 'isDarkColors', 'copyText', 'copyImage', 'copyFile', 'getCopiedFiles', 'hideMainWindowPasteText',
  'hideMainWindowPasteFile', 'hideMainWindowPasteImage', 'hideMainWindowTypeString', 'startDrag', 'simulateKeyboardTap',
  'simulateMouseMove', 'simulateMouseClick', 'simulateMouseDoubleClick', 'simulateMouseRightClick', 'requestSchedule',
  'getSchedules', 'removeSchedule', 'isPurchasedUser', 'openPurchase', 'registerTool', 'ai', 'allAiModels', 'runFFmpeg',
  'sharp', 'ubrowser', 'getIdleUBrowsers', 'setUBrowserProxy', 'clearUBrowserCache',
]
export { utoolsEntryTypes, registerUtoolsEntries, type MatchFile, type MatchWindow } from './entries'
export { utoolsSources, registerUtoolsSources, type UtoolsSourceOptions } from './sources'
export { utoolsManifestLoader } from './manifest'

import type { CompatLayerDescriptor } from '@whatevertools/core'
import { utoolsEntryTypes as _types } from './entries'
import { utoolsSources as _sources } from './sources'
import { utoolsManifestLoader as _loader } from './manifest'

/** uTools 兼容层描述：宿主配置 compat: [{ module: '@whatevertools/compat-utools' }] 或 [{ layer: compat }] */
export const compat: CompatLayerDescriptor = {
  id: 'utools',
  defaultName: 'utools',
  createApi: (api, opts) => createUtoolsCompat(api as WhateverToolsApi, opts),
  entryTypes: _types,
  sources: _sources,
  manifestLoader: _loader,
  identityMock: { platform: { name: 'uTools', version: '7.0.0' } },
}
