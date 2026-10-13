// 可选运行时：在 uTools 本体上用 window.utools 实现 whatevertools 原生 API。
// 按 whatevertools API 写的插件发布到 uTools 时引入它：import { createWhateverTools } from '@whatevertools/utools/runtime'
// 体积很小（只有映射），不引入其他依赖。
import type { WhateverToolsApi } from '@whatevertools/api'

export interface WhateverToolsOnUtoolsOptions {
  plugin: { id: string; name: string; version: string }
  /** 默认 window.utools */
  utools?: any
}

export function createWhateverTools(opts: WhateverToolsOnUtoolsOptions): WhateverToolsApi {
  const u = opts.utools ?? (globalThis as any).utools
  if (!u) throw new Error('window.utools 不存在：当前不在 uTools 环境')
  const appVersion = String(u.getAppVersion?.() ?? '')
  const proc = (globalThis as any).process
  const platform = proc?.platform ?? 'unknown'
  return {
    identity: {
      runtime: { name: 'utools', version: appVersion, api: {} },
      host: { name: 'uTools', version: appVersion },
      mock: { platform: { name: 'uTools', version: appVersion }, runtime: { name: 'utools', version: appVersion } },
      plugin: opts.plugin,
      env: { platform, arch: proc?.arch ?? 'unknown', electron: proc?.versions?.electron, chrome: proc?.versions?.chrome, node: proc?.versions?.node },
    },
    // uTools 本体：存在即支持；权限由 uTools 自己负责
    supports: (name: string) => (name.split('.').reduce((o: any, k) => (o == null ? o : o[k]), u) !== undefined ? 'native' : false),
    permissions: { query: () => true, request: async () => true },
    lifecycle: {
      onReady: (cb) => u.onPluginReady(cb),
      onEnter: (cb) => u.onPluginEnter(cb),
      onLeave: (cb) => u.onPluginOut(cb),
      onDetach: (cb) => u.onPluginDetach(cb),
      onSearchPush: (provide, onSelect) => u.onMainPush(provide, onSelect),
      exit: (k) => u.outPlugin(k),
    },
    window: {
      get type() {
        return u.getWindowType()
      },
      create: (url, options, onLoad) => u.createBrowserWindow(url, options, onLoad),
      sendToParent: (channel, ...args) => u.sendToParent(channel, ...args),
    },
    panel: {
      hide: (f) => u.hideMainWindow(f),
      show: () => u.showMainWindow(),
      setHeight: (h) => u.setExpandHeight(h),
      input: {
        set: (cb, p, f) => u.setSubInput(cb, p, f),
        remove: () => u.removeSubInput(),
        setValue: (t) => u.setSubInputValue(t),
        focus: () => u.subInputFocus(),
        blur: () => u.subInputBlur(),
        select: () => u.subInputSelect(),
      },
    },
    page: {
      find: (t, o) => u.findInPage(t, o),
      stopFind: (a = 'clearSelection') => u.stopFindInPage(a),
    },
    features: { list: (c) => u.getFeatures(c), set: (f) => u.setFeature(f), remove: (c) => u.removeFeature(c) },
    launch: { open: (t, p) => u.redirect(t, p) },
    hotkeys: { openSettings: (l, a) => u.redirectHotKeySetting(l, a), get: (l) => u.getCmdHotKey(l) },
    db: {
      put: (d) => u.db.put(d),
      get: (id) => u.db.get(id),
      remove: (d) => u.db.remove(d),
      bulk: (d) => u.db.bulkDocs(d),
      all: (f) => u.db.allDocs(f),
      putAttachment: (id, d, t) => u.db.postAttachment(id, d, t),
      getAttachment: (id) => u.db.getAttachment(id),
      getAttachmentType: (id) => u.db.getAttachmentType(id),
      syncState: () => u.db.replicateStateFromCloud(),
      onPull: (cb) => u.onDbPull(cb),
      promises: { putAttachment: (id, d, t) => u.db.promises.postAttachment(id, d, t), getAttachment: (id) => u.db.promises.getAttachment(id) },
    },
    kv: { set: (k, v) => u.dbStorage.setItem(k, v), get: (k) => u.dbStorage.getItem(k), remove: (k) => u.dbStorage.removeItem(k) },
    paths: { data: () => u.getPluginLocalDataPath(), temp: () => u.getPluginTempPath(), get: (n) => u.getPath(n) },
    system: {
      notify: (b, f) => u.showNotification(b, f),
      appName: () => (u.getAppName ? u.getAppName() : 'uTools'),
      appVersion: () => u.getAppVersion(),
      fileIcon: (p) => u.getFileIcon(p),
      fileIconAsync: (p) => u.getFileIconAsync(p),
      isDev: () => u.isDev(),
      isMac: () => u.isMacOS(),
      isWindows: () => u.isWindows(),
      isLinux: () => u.isLinux(),
      isDark: () => u.isDarkColors(),
      // uTools 没有主题事件：用页面的 prefers-color-scheme 监听
      onThemeChange: (cb) => globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => cb(e.matches)),
    },
    account: { user: () => u.getUser() },
    device: { id: () => u.getNativeId() },
    context: {
      activeFolder: () => u.readCurrentFolderPath(),
      activeBrowserUrl: () => u.readCurrentBrowserUrl(),
      // uTools 没有这个接口
      activeWindow: async () => null,
    },
    dialog: { open: (o = {}) => u.showOpenDialog(o), save: (o = {}) => u.showSaveDialog(o), openAsync: async (o = {}) => u.showOpenDialog(o), saveAsync: async (o = {}) => u.showSaveDialog(o) },
    shell: { openPath: (p) => u.shellOpenPath(p), trash: (p) => u.shellTrashItem(p), showInFolder: (p) => u.shellShowItemInFolder(p), openExternal: (x) => u.shellOpenExternal(x), beep: () => u.shellBeep() },
    clipboard: { writeText: (t) => u.copyText(t), writeImage: (i) => u.copyImage(i), writeFiles: (p) => u.copyFile(p), readFiles: () => u.getCopiedFiles() },
    input: {
      sendText: (t) => u.hideMainWindowPasteText(t),
      sendFiles: (p) => u.hideMainWindowPasteFile(p),
      sendImage: (i) => u.hideMainWindowPasteImage(i),
      typeText: (t) => u.hideMainWindowTypeString(t),
      startDrag: (p) => u.startDrag(p),
      keyTap: (k, ...m) => u.simulateKeyboardTap(k, ...m),
      mouseMove: (x, y) => u.simulateMouseMove(x, y),
      mouseClick: (x, y) => u.simulateMouseClick(x, y),
      mouseDoubleClick: (x, y) => u.simulateMouseDoubleClick(x, y),
      mouseRightClick: (x, y) => u.simulateMouseRightClick(x, y),
    },
    screen: {
      displays: () => u.getAllDisplays(),
      primaryDisplay: () => u.getPrimaryDisplay(),
      cursor: () => u.getCursorScreenPoint(),
      nearestDisplay: (p) => u.getDisplayNearestPoint(p),
      matchingDisplay: (r) => u.getDisplayMatching(r),
      toDipPoint: (p) => u.screenToDipPoint(p),
      toScreenPoint: (p) => u.dipToScreenPoint(p),
      toDipRect: (r) => u.screenToDipRect(r),
      toScreenRect: (r) => u.dipToScreenRect(r),
      captureDisplay: (displayId) => u.captureDisplay(displayId === undefined ? {} : { displayId }),
      captureRegion: ((cb?: any) => u.screenCapture(cb)) as any,
      pickColor: ((cb?: any) => u.screenColorPick(cb)) as any,
      captureSources: (o) => u.desktopCaptureSources(o),
    },
    schedule: { request: (s) => u.requestSchedule(s), list: () => u.getSchedules(), remove: (c) => u.removeSchedule(c), onTrigger: (cb) => u.onScheduleTrigger(cb) },
    ai: { chat: ((o: any, cb?: any) => u.ai(o, cb)) as any, models: () => u.allAiModels() },
    tools: { register: (n, h) => u.registerTool(n, h) },
    media: { ffmpeg: (a, o) => u.runFFmpeg(a, o) },
    image: { sharp: (...a: any[]) => u.sharp(...a) },
    billing: { isPurchased: () => u.isPurchasedUser(), purchase: (o, cb) => u.openPurchase(o, cb) },
    browser: { automate: () => u.ubrowser, idle: () => u.getIdleUBrowsers(), setProxy: (c) => u.setUBrowserProxy(c), clearCache: () => u.clearUBrowserCache() },
  }
}
