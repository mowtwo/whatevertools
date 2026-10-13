// API 规格表：插件能用到的每个函数 / 属性在这里登记一次。
// 各运行时（electron、web）据此生成注入对象，权限检查、版本号、支持程度查询也都以它为准。

/** 调用方式：local = 在插件进程内完成；sync / async = 交给宿主；event = 注册回调，由宿主推送 */
export type ApiKind = 'local' | 'sync' | 'async' | 'event' | 'value' | 'namespace'

/** 支持程度：native = 行为一致；emulated = 换了实现但语义一致；partial = 只支持一部分参数；mock = 占位实现（不报错但没有真实效果）；none = 调用即报错 */
export type Support = 'native' | 'emulated' | 'partial' | 'mock' | 'none'

export interface ApiSpec {
  /** 点分路径，如 db.put、db.promises.get */
  name: string
  kind: ApiKind
  group: string
  /** 调用需要的权限；数组表示都需要 */
  permission?: string | string[]
  /** 引入该 API 的底座版本 */
  since: string
  /** 参数里哪个位置是需要做作用域检查的值（路径、网址） */
  scopeArg?: number
  support: { electron: Support; web: Support }
  /** 仅允许在哪类窗口调用；不写表示都可以 */
  windows?: Array<'main' | 'detach' | 'custom'>
  /** 旧平台（uTools）里的名字，供兼容层和 supports() 按旧名查询 */
  legacy?: string
  note?: string
}

const S = (electron: Support, web: Support) => ({ electron, web })
const N = S('native', 'emulated')

function api(name: string, kind: ApiKind, group: string, permission: ApiSpec['permission'], support: ApiSpec['support'], extra: Partial<ApiSpec> = {}): ApiSpec {
  return { name, kind, group, permission, since: '0.1.0', support, ...extra }
}

export const APIS: ApiSpec[] = [
  // 事件
  api('lifecycle.onEnter', 'event', 'lifecycle', undefined, N, { legacy: 'onPluginEnter' }),
  api('lifecycle.onLeave', 'event', 'lifecycle', undefined, N, { legacy: 'onPluginOut' }),
  api('lifecycle.onReady', 'event', 'lifecycle', undefined, N, { legacy: 'onPluginReady' }),
  api('lifecycle.onDetach', 'event', 'lifecycle', undefined, S('emulated', 'mock'), { note: '启动器没有分离窗口时不会触发' , legacy: 'onPluginDetach' }),
  api('lifecycle.onSearchPush', 'event', 'lifecycle', undefined, S('emulated', 'none'), { legacy: 'onMainPush' }),
  api('schedule.onTrigger', 'event', 'events', 'schedule', S('emulated', 'partial'), { legacy: 'onScheduleTrigger' }),

  // 窗口
  api('panel.hide', 'sync', 'panel', undefined, S('native', 'none'), { windows: ['main'] , legacy: 'hideMainWindow' }),
  api('panel.show', 'sync', 'panel', undefined, S('native', 'none'), { windows: ['main'] , legacy: 'showMainWindow' }),
  api('panel.setHeight', 'sync', 'panel', undefined, S('emulated', 'mock'), { windows: ['main'] , legacy: 'setExpandHeight' }),
  api('panel.input.set', 'local', 'panel', undefined, S('emulated', 'none'), { windows: ['main', 'detach'] , legacy: 'setSubInput' }),
  api('panel.input.remove', 'sync', 'panel', undefined, S('emulated', 'none'), { windows: ['main', 'detach'] , legacy: 'removeSubInput' }),
  api('panel.input.setValue', 'sync', 'panel', undefined, S('emulated', 'none'), { windows: ['main', 'detach'] , legacy: 'setSubInputValue' }),
  api('panel.input.focus', 'sync', 'panel', undefined, S('emulated', 'none'), { windows: ['main', 'detach'] , legacy: 'subInputFocus' }),
  api('panel.input.blur', 'sync', 'panel', undefined, S('emulated', 'none'), { legacy: 'subInputBlur' }),
  api('panel.input.select', 'sync', 'panel', undefined, S('emulated', 'none'), { windows: ['main', 'detach'] , legacy: 'subInputSelect' }),
  api('lifecycle.exit', 'sync', 'lifecycle', undefined, N, { windows: ['main', 'detach'] , legacy: 'outPlugin' }),
  api('window.create', 'local', 'window', 'window.create', S('native', 'partial'), { note: 'web 端用 window.open / iframe 模拟' , legacy: 'createBrowserWindow' }),
  api('window.sendToParent', 'sync', 'window', undefined, S('native', 'emulated'), { windows: ['custom'] , legacy: 'sendToParent' }),
  api('window.type', 'local', 'window', undefined, N, { legacy: 'getWindowType' }),
  api('page.find', 'sync', 'page', undefined, S('native', 'none'), { legacy: 'findInPage' }),
  api('page.stopFind', 'sync', 'page', undefined, S('native', 'none'), { legacy: 'stopFindInPage' }),

  // 系统
  api('system.notify', 'sync', 'system', 'notification', N, { legacy: 'showNotification' }),
  api('dialog.open', 'sync', 'system', 'dialog', S('native', 'partial'), { legacy: 'showOpenDialog', note: 'web：选目录且带 createDirectory 时返回下载目录；其他情况浏览器没法同步选文件，返回 undefined 并异步弹出选择器，选中的文件按 WebBootConfig.fileDialogs.openDialog 交给插件（默认作为 files 进入）。新代码请用 dialog.openAsync' }),
  api('dialog.save', 'sync', 'system', 'dialog', S('native', 'emulated'), { legacy: 'showSaveDialog', note: 'web：返回 /downloads 下的路径，写进这个路径的文件会由浏览器下载' }),
  api('dialog.openAsync', 'async', 'system', 'dialog', S('native', 'emulated'), { since: '0.2.0', note: 'web：浏览器文件选择器，选中的文件放在虚拟文件系统 /picked 下' }),
  api('dialog.saveAsync', 'async', 'system', 'dialog', S('native', 'emulated'), { since: '0.2.0', note: '同 dialog.save' }),
  api('shell.openPath', 'async', 'system', 'shell.open', S('native', 'partial'), { scopeArg: 0 , legacy: 'shellOpenPath', note: 'web：只对 /downloads 下的文件有效（重新下载）' }),
  api('shell.trash', 'async', 'system', 'shell.trash', S('native', 'none'), { scopeArg: 0 , legacy: 'shellTrashItem' }),
  api('shell.showInFolder', 'sync', 'system', 'shell.open', S('native', 'mock'), { scopeArg: 0 , legacy: 'shellShowItemInFolder', note: 'web：浏览器管理下载位置，调用不报错也没有效果' }),
  api('shell.openExternal', 'async', 'system', 'shell.external', N, { scopeArg: 0 , legacy: 'shellOpenExternal' }),
  api('shell.beep', 'sync', 'system', undefined, S('native', 'none'), { legacy: 'shellBeep' }),
  api('device.id', 'sync', 'device', 'system.identity', S('emulated', 'emulated'), { legacy: 'getNativeId' }),
  api('system.appName', 'local', 'system', undefined, N, { legacy: 'getAppName' }),
  api('system.appVersion', 'local', 'system', undefined, N, { note: '返回 identity.mock.platform.version' , legacy: 'getAppVersion' }),
  api('account.user', 'sync', 'account', 'system.identity', S('emulated', 'emulated'), { note: '宿主可通过 hook 提供用户信息，默认 null' , legacy: 'getUser' }),
  api('paths.get', 'sync', 'system', undefined, S('native', 'mock'), { legacy: 'getPath' }),
  api('system.fileIcon', 'sync', 'system', undefined, S('native', 'none'), { legacy: 'getFileIcon' }),
  api('system.fileIconAsync', 'async', 'system', undefined, S('native', 'none'), { legacy: 'getFileIconAsync' }),
  api('context.activeFolder', 'async', 'context', 'system.context', S('partial', 'none'), { legacy: 'readCurrentFolderPath' }),
  api('context.activeBrowserUrl', 'async', 'context', 'system.context', S('partial', 'none'), { legacy: 'readCurrentBrowserUrl' }),
  api('context.activeWindow', 'async', 'context', 'system.context', S('partial', 'none')),
  api('paths.data', 'sync', 'system', 'fs.plugin', S('native', 'emulated'), { legacy: 'getPluginLocalDataPath' }),
  api('paths.temp', 'sync', 'system', 'fs.plugin', S('native', 'emulated'), { legacy: 'getPluginTempPath' }),
  api('system.isDev', 'local', 'system', undefined, N, { legacy: 'isDev' }),
  api('system.isMac', 'local', 'system', undefined, N, { legacy: 'isMacOS' }),
  api('system.isWindows', 'local', 'system', undefined, N, { legacy: 'isWindows' }),
  api('system.isLinux', 'local', 'system', undefined, N, { legacy: 'isLinux' }),
  api('system.isDark', 'sync', 'system', undefined, N, { legacy: 'isDarkColors' }),
  api('system.onThemeChange', 'event', 'system', undefined, N, { note: '宿主主题变化（跟随系统或宿主设置）' }),

  // 复制
  api('clipboard.writeText', 'sync', 'clipboard', 'clipboard.write', N, { legacy: 'copyText' }),
  api('clipboard.writeImage', 'sync', 'clipboard', 'clipboard.write', S('native', 'emulated'), { legacy: 'copyImage' }),
  api('clipboard.writeFiles', 'sync', 'clipboard', 'clipboard.write', S('native', 'none'), { legacy: 'copyFile' }),
  api('clipboard.readFiles', 'sync', 'clipboard', 'clipboard.read', S('native', 'none'), { legacy: 'getCopiedFiles' }),

  // 输入
  api('input.sendText', 'sync', 'input', 'input.paste', S('emulated', 'none'), { legacy: 'hideMainWindowPasteText' }),
  api('input.sendFiles', 'sync', 'input', 'input.paste', S('emulated', 'none'), { legacy: 'hideMainWindowPasteFile' }),
  api('input.sendImage', 'sync', 'input', 'input.paste', S('emulated', 'none'), { legacy: 'hideMainWindowPasteImage' }),
  api('input.typeText', 'sync', 'input', 'input.paste', S('emulated', 'none'), { legacy: 'hideMainWindowTypeString' }),
  api('input.startDrag', 'sync', 'input', 'input.drag', S('native', 'none'), { legacy: 'startDrag' }),
  api('input.keyTap', 'sync', 'input', 'input.simulate', S('partial', 'none'), { note: '系统级按键：macOS AppleScript / Windows SendKeys / Linux xdotool，或 providers.input' , legacy: 'simulateKeyboardTap' }),
  api('input.mouseMove', 'sync', 'input', 'input.simulate', S('mock', 'none'), { legacy: 'simulateMouseMove' }),
  api('input.mouseClick', 'sync', 'input', 'input.simulate', S('mock', 'none'), { legacy: 'simulateMouseClick' }),
  api('input.mouseDoubleClick', 'sync', 'input', 'input.simulate', S('mock', 'none'), { legacy: 'simulateMouseDoubleClick' }),
  api('input.mouseRightClick', 'sync', 'input', 'input.simulate', S('mock', 'none'), { legacy: 'simulateMouseRightClick' }),

  // 屏幕
  api('screen.captureRegion', 'local', 'screen', 'screen.captureDisplay', S('emulated', 'none'), { legacy: 'screenCapture' }),
  api('screen.captureDisplay', 'async', 'screen', 'screen.captureDisplay', S('native', 'none'), { legacy: 'captureDisplay' }),
  api('screen.pickColor', 'local', 'screen', 'screen.captureDisplay', S('emulated', 'none'), { legacy: 'screenColorPick' }),
  api('screen.captureSources', 'async', 'screen', 'screen.captureDisplay', S('native', 'none'), { legacy: 'desktopCaptureSources' }),
  api('screen.displays', 'sync', 'screen', 'screen.read', S('native', 'emulated'), { legacy: 'getAllDisplays' }),
  api('screen.primaryDisplay', 'sync', 'screen', 'screen.read', S('native', 'emulated'), { legacy: 'getPrimaryDisplay' }),
  api('screen.cursor', 'sync', 'screen', 'screen.read', S('native', 'partial'), { legacy: 'getCursorScreenPoint' }),
  api('screen.nearestDisplay', 'sync', 'screen', 'screen.read', S('native', 'emulated'), { legacy: 'getDisplayNearestPoint' }),
  api('screen.matchingDisplay', 'sync', 'screen', 'screen.read', S('native', 'emulated'), { legacy: 'getDisplayMatching' }),
  api('screen.toDipPoint', 'sync', 'screen', 'screen.read', S('native', 'emulated'), { legacy: 'screenToDipPoint' }),
  api('screen.toScreenPoint', 'sync', 'screen', 'screen.read', S('native', 'emulated'), { legacy: 'dipToScreenPoint' }),
  api('screen.toDipRect', 'sync', 'screen', 'screen.read', S('native', 'emulated'), { legacy: 'screenToDipRect' }),
  api('screen.toScreenRect', 'sync', 'screen', 'screen.read', S('native', 'emulated'), { legacy: 'dipToScreenRect' }),

  // 数据库（文档库 + 键值）
  api('db.put', 'sync', 'db', 'storage', N, { legacy: 'db.put' }),
  api('db.get', 'sync', 'db', 'storage', N, { legacy: 'db.get' }),
  api('db.remove', 'sync', 'db', 'storage', N, { legacy: 'db.remove' }),
  api('db.bulk', 'sync', 'db', 'storage', N, { legacy: 'db.bulkDocs' }),
  api('db.all', 'sync', 'db', 'storage', N, { legacy: 'db.allDocs' }),
  api('db.putAttachment', 'sync', 'db', 'storage', S('native', 'partial'), { legacy: 'db.postAttachment' }),
  api('db.getAttachment', 'sync', 'db', 'storage', N, { legacy: 'db.getAttachment' }),
  api('db.getAttachmentType', 'sync', 'db', 'storage', N, { legacy: 'db.getAttachmentType' }),
  api('db.syncState', 'sync', 'db', 'storage', S('emulated', 'emulated'), { legacy: 'db.replicateStateFromCloud', note: '配置了同步适配器才有意义' }),
  api('db.onPull', 'event', 'db', 'storage', S('emulated', 'emulated'), { legacy: 'onDbPull', note: '配置了同步适配器才会触发' }),
  api('kv.set', 'sync', 'db', 'storage', N, { legacy: 'dbStorage.setItem' }),
  api('kv.get', 'sync', 'db', 'storage', N, { legacy: 'dbStorage.getItem' }),
  api('kv.remove', 'sync', 'db', 'storage', N, { legacy: 'dbStorage.removeItem' }),

  // 动态功能 / 跳转
  api('features.list', 'sync', 'features', undefined, N, { legacy: 'getFeatures' }),
  api('features.set', 'sync', 'features', 'features', N, { legacy: 'setFeature' }),
  api('features.remove', 'sync', 'features', 'features', N, { legacy: 'removeFeature' }),
  api('launch.open', 'sync', 'launch', 'redirect', S('emulated', 'none'), { legacy: 'redirect' }),
  api('hotkeys.openSettings', 'sync', 'hotkeys', undefined, S('emulated', 'none'), { legacy: 'redirectHotKeySetting' }),
  api('hotkeys.get', 'sync', 'hotkeys', undefined, S('emulated', 'none'), { legacy: 'getCmdHotKey' }),

  // 定时任务
  api('schedule.request', 'async', 'schedule', 'schedule', S('emulated', 'partial'), { legacy: 'requestSchedule' }),
  api('schedule.list', 'sync', 'schedule', 'schedule', S('emulated', 'partial'), { legacy: 'getSchedules' }),
  api('schedule.remove', 'sync', 'schedule', 'schedule', S('emulated', 'partial'), { legacy: 'removeSchedule' }),

  // AI / MCP
  api('ai.chat', 'local', 'ai', 'ai', S('emulated', 'emulated'), { note: '需要宿主配置模型提供方（hook: service:ai）' , legacy: 'ai' }),
  api('ai.models', 'async', 'ai', 'ai', S('emulated', 'emulated'), { legacy: 'allAiModels' }),
  api('tools.register', 'local', 'ai', undefined, S('emulated', 'none'), { note: '注册不需要权限；外部 Agent 第一次调用时按 mcp 权限询问' , legacy: 'registerTool' }),

  // 多媒体 / 图像
  api('media.ffmpeg', 'local', 'media', 'media.ffmpeg', S('emulated', 'partial'), { note: '使用宿主配置或 PATH 中的 ffmpeg；web 端可接 ffmpeg.wasm' , legacy: 'runFFmpeg' }),
  api('image.sharp', 'local', 'media', 'image.sharp', S('emulated', 'partial'), { note: 'electron：宿主安装的 sharp；web：@whatevertools/sharp-canvas（Canvas 实现的常用子集，不支持 AVIF 编码、ICC、动图），也可以换成 wasm 版' , legacy: 'sharp' }),

  // 付费
  api('billing.isPurchased', 'sync', 'payment', 'payment', S('mock', 'mock'), { note: '默认 true，宿主可 hook' , legacy: 'isPurchasedUser' }),
  api('billing.purchase', 'local', 'payment', 'payment', S('mock', 'mock'), { legacy: 'openPurchase' }),

  // 自动化浏览器
  api('browser.automate', 'value', 'ubrowser', 'browser', S('partial', 'none'), { note: '用隐藏的 BrowserWindow 实现常用链式指令' , legacy: 'ubrowser' }),
  api('browser.idle', 'sync', 'ubrowser', 'browser', S('emulated', 'none'), { legacy: 'getIdleUBrowsers' }),
  api('browser.setProxy', 'sync', 'ubrowser', 'browser', S('emulated', 'none'), { legacy: 'setUBrowserProxy' }),
  api('browser.clearCache', 'sync', 'ubrowser', 'browser', S('emulated', 'none'), { legacy: 'clearUBrowserCache' }),
]

export const API_MAP: Record<string, ApiSpec> = Object.fromEntries(APIS.map((a) => [a.name, a]))

/** 旧名 → 规格 */
export const LEGACY_API_MAP: Record<string, ApiSpec> = Object.fromEntries(APIS.filter((a) => a.legacy).map((a) => [a.legacy!, a]))

/** 按原生名或旧名查规格 */
export function findApi(name: string): ApiSpec | undefined {
  return API_MAP[name] ?? LEGACY_API_MAP[name]
}

/** 底座版本：注入给插件的 versions.runtime */
export const RUNTIME_VERSION = '0.1.1'

/** 每个 API 的版本号（目前都随底座 0.1.0 引入），插件可用 versions.api['db.put'] 判断 */
export function apiVersions(): Record<string, string> {
  return Object.fromEntries(APIS.map((a) => [a.name, a.since]))
}

export interface NameVersion {
  name: string
  /** 任意字符串，不要求是 semver */
  version: string
}

/**
 * 注入给插件的身份信息（whatevertools.identity）：
 * - runtime：真实底座（名字可自定义，默认 whatevertools），version 是 semver，api 是每个 API 的版本
 * - host：真实宿主平台（谁在用这个底座），名字和版本都是宿主注入的任意字符串，插件自行解析
 * - mock：对旧插件伪装的平台和底座，getAppName / getAppVersion 等兼容 API 返回这里的值
 * - plugin：插件本身
 */
export interface Identity {
  runtime: NameVersion & { api: Record<string, string> }
  host: NameVersion
  mock: { platform: NameVersion; runtime: NameVersion }
  plugin: { id: string; name: string; version: string }
  env: { platform: string; arch: string; electron?: string; chrome?: string; node?: string }
}

/** 宿主可配置的身份字段（runtime.api、plugin、env 由底座填写） */
export interface IdentityOptions {
  runtimeName?: string
  host?: Partial<NameVersion>
  mock?: { platform?: Partial<NameVersion>; runtime?: Partial<NameVersion> }
}

export function buildIdentity(opts: IdentityOptions, plugin: Identity['plugin'], env: Identity['env']): Identity {
  return {
    runtime: { name: opts.runtimeName ?? 'whatevertools', version: RUNTIME_VERSION, api: apiVersions() },
    host: { name: opts.host?.name ?? 'whatevertools-host', version: opts.host?.version ?? RUNTIME_VERSION },
    mock: {
      platform: { name: opts.mock?.platform?.name ?? 'whatevertools', version: opts.mock?.platform?.version ?? RUNTIME_VERSION },
      runtime: { name: opts.mock?.runtime?.name ?? 'whatevertools', version: opts.mock?.runtime?.version ?? RUNTIME_VERSION },
    },
    plugin,
    env,
  }
}

/** createBrowserWindow 返回对象允许调用的方法（与官方文档列出的一致），其余调用会抛错 */
export const WINDOW_METHODS = [
  'show', 'showInactive', 'hide', 'destroy', 'close', 'isFocused', 'isDestroyed', 'isVisible', 'focus', 'blur',
  'setResizable', 'isResizable', 'setSize', 'getSize', 'setPosition', 'getPosition', 'setBounds', 'getBounds',
  'setContentBounds', 'getContentBounds', 'getNormalBounds', 'setContentSize', 'getContentSize', 'setMinimumSize',
  'getMinimumSize', 'setMaximumSize', 'getMaximumSize', 'setEnabled', 'isEnabled', 'maximize', 'unmaximize',
  'isMaximized', 'minimize', 'restore', 'isMinimized', 'isNormal', 'setFullScreen', 'isFullScreen',
  'setFullScreenable', 'isFullScreenable', 'setClosable', 'isClosable', 'setAlwaysOnTop', 'isAlwaysOnTop', 'moveTop',
  'setTitle', 'getTitle', 'setAspectRatio', 'setBackgroundColor', 'getBackgroundColor', 'setHasShadow', 'hasShadow',
  'setIgnoreMouseEvents', 'setSkipTaskbar', 'setMenuBarVisibility', 'isMenuBarVisible', 'setProgressBar',
  'setVisibleOnAllWorkspaces', 'isVisibleOnAllWorkspaces', 'setContentProtection', 'isContentProtected', 'setKiosk',
  'isKiosk', 'flashFrame', 'focusOnWebView', 'blurWebView', 'capturePage', 'reload', 'reloadIgnoringCache', 'loadURL',
  'loadFile', 'isLoading', 'stop', 'setOpacity', 'getOpacity',
]

export const WEBCONTENTS_METHODS = [
  'send', 'capturePage', 'openDevTools', 'closeDevTools', 'isDevToolsOpened', 'isDevToolsFocused', 'toggleDevTools',
  'executeJavaScript', 'insertCSS', 'removeInsertedCSS', 'insertText', 'copy', 'cut', 'paste', 'pasteAndMatchStyle',
  'delete', 'undo', 'redo', 'selectAll', 'unselect', 'replace', 'replaceMisspelling', 'copyImageAt', 'findInPage',
  'stopFindInPage', 'isLoading', 'isLoadingMainFrame', 'isWaitingForResponse', 'stop', 'isDestroyed', 'isCrashed',
  'isFocused', 'isPainting', 'isOffscreen', 'startPainting', 'stopPainting', 'isBeingCaptured', 'isCurrentlyAudible',
  'isAudioMuted', 'setAudioMuted', 'getTitle', 'getURL', 'getUserAgent', 'setUserAgent', 'getZoomFactor',
  'setZoomFactor', 'getBackgroundThrottling', 'setBackgroundThrottling', 'getFrameRate', 'setFrameRate',
  'getWebRTCIPHandlingPolicy', 'setWebRTCIPHandlingPolicy', 'setIgnoreMenuShortcuts', 'getProcessId',
  'getOSProcessId', 'getPrinters', 'print', 'printToPDF', 'savePage', 'takeHeapSnapshot', 'sendInputEvent',
  'invalidate', 'blur', 'focus', 'enableDeviceEmulation', 'disableDeviceEmulation',
]

/** 返回 Promise 的窗口方法（宿主异步处理） */
export const WINDOW_ASYNC_METHODS = new Set(['capturePage', 'loadURL', 'loadFile', 'executeJavaScript', 'insertCSS', 'removeInsertedCSS', 'insertText', 'printToPDF', 'savePage', 'takeHeapSnapshot', 'getPrinters'])

/** 写文件的窗口方法：第一个参数是路径，需要 fs.write 权限 */
export const WINDOW_WRITE_METHODS: Record<string, number> = { savePage: 0, takeHeapSnapshot: 0 }

/** 这些方法会让窗口成为覆盖层，需要 window.overlay 权限 */
export function windowCallNeedsOverlay(method: string, args: unknown[]): boolean {
  if (method === 'setIgnoreMouseEvents') return args[0] === true
  if (method === 'setAlwaysOnTop') return args[0] === true
  if (method === 'setVisibleOnAllWorkspaces') return args[0] === true
  if (method === 'setContentProtection') return args[0] === true
  if (method === 'setKiosk' || method === 'setFullScreen') return args[0] === true
  return false
}
