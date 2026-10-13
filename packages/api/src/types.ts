// whatevertools 原生 API 的类型。插件开发时引用它获得代码提示；各平台实现必须满足它。
import type { DisplayInfo, Identity, Point, Rect, Support, FfmpegProgress } from '@whatevertools/core'

export interface DbDoc { _id: string; _rev?: string; _deleted?: boolean; [k: string]: unknown }
export interface DbResult { id: string; rev?: string; ok?: boolean; error?: boolean; name?: string; message?: string }

export interface EnterAction {
  code: string
  type: 'text' | 'img' | 'files' | 'regex' | 'over' | 'window'
  payload: any
  from: string
  option?: { text?: string }
}

export interface SearchPushItem { icon?: string; text: string; title?: string }

export interface NativeImageLike {
  getSize(): { width: number; height: number }
  isEmpty(): boolean
  toPNG(): Uint8Array
  toJPEG(quality: number): Uint8Array
  toDataURL(): string
  crop(rect: Rect): NativeImageLike
  resize(opts: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): NativeImageLike
}

/** window.create 返回的窗口（白名单方法，见 WINDOW_METHODS / WEBCONTENTS_METHODS） */
export interface WhateverToolsWindow {
  readonly id: number
  readonly webContents: { readonly id: number; send(channel: string, ...args: unknown[]): void; executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>; [method: string]: any }
  show(): void
  hide(): void
  close(): void
  destroy(): void
  isDestroyed(): boolean
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void
  setAlwaysOnTop(flag: boolean, level?: string): void
  [method: string]: any
}

export interface FileEntry { path: string; name: string; isFile: boolean; isDirectory: boolean }

export interface AiMessage { role: 'system' | 'user' | 'assistant'; content?: string | unknown[]; reasoning_content?: string }
export interface AiTool { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface AiOptions { model?: string; messages: AiMessage[]; tools?: AiTool[] }
export type AiPromise<T> = Promise<T> & { abort(): void }

export interface ToolContext {
  requestId: string | number
  sendProgress?: (p: { progress: number; total?: number; message?: string }) => Promise<void>
}

export interface Schedule { code: string; label: string; trigger: number | { cron: string; startTime?: number; endTime?: number } }
export interface ScheduleInfo extends Schedule { successCount: number; failureCount: number; lastExecuteAt?: number; lastStatus?: 'success' | 'failure' }

export type FfmpegProcess = Promise<void> & { kill(): void; quit(): void }

/** 自动化浏览器的链式指令（与旧平台 ubrowser 指令一致） */
export interface Automation {
  run(target?: Record<string, unknown> | number): Promise<unknown[]>
  goto(url: string, headers?: Record<string, string>, timeout?: number): Automation
  userAgent(ua: string): Automation
  viewport(width: number, height: number): Automation
  device(o: { userAgent?: string; viewport?: { width: number; height: number; deviceScaleFactor?: number; isMobile?: boolean; hasTouch?: boolean } }): Automation
  click(...args: any[]): Automation
  dblclick(...args: any[]): Automation
  mousedown(...args: any[]): Automation
  mouseup(...args: any[]): Automation
  hover(...args: any[]): Automation
  press(key: string, ...modifiers: string[]): Automation
  focus(selector: string): Automation
  input(...args: any[]): Automation
  value(selector: string, value: string): Automation
  check(selector: string, checked: boolean): Automation
  scroll(...args: any[]): Automation
  file(selector: string, payload: string | Uint8Array | string[]): Automation
  drop(...args: any[]): Automation
  paste(payload: string): Automation
  download(...args: any[]): Automation
  evaluate(fn: (...args: any[]) => any, ...args: any[]): Automation
  css(css: string): Automation
  wait(...args: any[]): Automation
  when(...args: any[]): Automation
  endWhen(): Automation
  markdown(selector?: string): Automation
  screenshot(target?: string | Rect, savePath?: string): Automation
  pdf(options: Record<string, unknown>, savePath?: string): Automation
  cookies(filter?: string | Record<string, unknown>): Automation
  setCookies(...args: any[]): Automation
  removeCookies(name: string): Automation
  clearCookies(url?: string): Automation
  show(): Automation
  hide(): Automation
  devTools(mode?: 'right' | 'bottom' | 'undocked' | 'detach'): Automation
}

export interface WhateverToolsApi {
  /** 身份：底座、宿主、伪装平台、插件本身、环境 */
  readonly identity: Identity
  /** 某个 API（原生名或旧名）在当前平台的支持程度；false 表示不支持 */
  supports(name: string): Support | false
  permissions: {
    /** 是否已授予（可能触发问询） */
    query(permission: string, scope?: string): boolean
    request(permission: string, scope?: string): Promise<boolean>
  }
  lifecycle: {
    onReady(cb: () => void | Promise<void>): void
    onEnter(cb: (action: EnterAction) => void): void
    onLeave(cb: (kill: boolean) => void): void
    onDetach(cb: () => void): void
    onSearchPush(provide: (action: Omit<EnterAction, 'from'>) => SearchPushItem[], onSelect?: (action: EnterAction) => boolean | undefined): void
    /** 退出插件：kill = false 退到后台，true 结束进程 */
    exit(kill?: boolean): void
  }
  /** 插件自己创建的窗口 */
  window: {
    readonly type: 'main' | 'detach' | 'custom'
    create(url: string, options?: Record<string, unknown>, onLoad?: () => void): WhateverToolsWindow
    sendToParent(channel: string, ...args: unknown[]): void
  }
  /** 宿主承载插件主界面的面板（启动器窗口等） */
  panel: {
    hide(focusPrev?: boolean): boolean
    show(): boolean
    setHeight(height: number): boolean
    /** 面板输入框：插件把主搜索框借来当自己的输入框 */
    input: {
      set(onChange: (d: { text: string }) => void, placeholder?: string, focus?: boolean): boolean
      remove(): boolean
      setValue(text: string): boolean
      focus(): boolean
      blur(): void
      select(): boolean
    }
  }
  /** 当前页面 */
  page: {
    find(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): void
    stopFind(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  }
  features: {
    list(codes?: string[]): Array<Record<string, unknown>>
    set(feature: Record<string, unknown>): void
    remove(code: string): boolean
  }
  launch: {
    /** 打开某个指令：label 或 [插件名, label] */
    open(target: string | [string, string], payload?: string | { type: 'img' | 'files'; data: string | string[] }): boolean
  }
  /** 指令快捷键 */
  hotkeys: {
    openSettings(cmdLabel: string, autocopy?: boolean): void
    get(cmdLabel: string): string | null
  }
  db: {
    put(doc: DbDoc): DbResult
    get(id: string): DbDoc | null
    remove(docOrId: DbDoc | string): DbResult
    bulk(docs: DbDoc[]): DbResult[]
    all(filter?: string | string[]): DbDoc[]
    putAttachment(id: string, data: Uint8Array, type: string): DbResult
    getAttachment(id: string): Uint8Array | null
    getAttachmentType(id: string): string | null
    /** null 未开启同步 / 1 拉取中 / 0 已拉取 */
    syncState(): null | 0 | 1
    onPull(cb: (docs: DbDoc[]) => void): void
    promises: {
      putAttachment(id: string, data: Uint8Array, type: string): Promise<DbResult>
      getAttachment(id: string): Promise<Uint8Array | null>
    }
  }
  kv: {
    set(key: string, value: unknown): void
    get<T = unknown>(key: string): T | null
    remove(key: string): boolean
  }
  paths: {
    data(): string
    temp(): string
    get(name: 'home' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | string): string
  }
  system: {
    notify(body: string, feature?: string): void
    appName(): string
    appVersion(): string
    fileIcon(pathOrExt: string): string
    fileIconAsync(pathOrExt: string): Promise<string>
    isDev(): boolean
    isMac(): boolean
    isWindows(): boolean
    isLinux(): boolean
    isDark(): boolean
    /** 宿主主题变化（深色 / 浅色），参数为是否深色 */
    onThemeChange(cb: (dark: boolean) => void): void
  }
  /** 宿主账号（由宿主的提供者实现） */
  account: {
    user(): { avatar: string; nickname: string; type: string } | null
  }
  device: {
    /** 设备 id（按插件区分） */
    id(): string
  }
  /** 前台应用上下文 */
  context: {
    activeFolder(): Promise<string>
    activeBrowserUrl(): Promise<string>
    activeWindow(): Promise<{ id: number; title: string; app: string; appPath: string; pid: number; x: number; y: number; width: number; height: number } | null>
  }
  dialog: {
    open(options?: Record<string, unknown>): string[] | undefined
    save(options?: Record<string, unknown>): string | undefined
    /** 异步版本：所有平台都能用（web 上同步版做不到真正的文件选择） */
    openAsync(options?: Record<string, unknown>): Promise<string[] | undefined>
    saveAsync(options?: Record<string, unknown>): Promise<string | undefined>
  }
  shell: {
    openPath(path: string): Promise<string>
    trash(path: string): Promise<void>
    showInFolder(path: string): void
    openExternal(url: string): Promise<void>
    beep(): void
  }
  clipboard: {
    writeText(text: string): boolean
    writeImage(image: string | Uint8Array | NativeImageLike): boolean
    writeFiles(paths: string | string[]): boolean
    readFiles(): FileEntry[] | null
  }
  input: {
    /** 隐藏面板，把内容粘贴到之前的应用里 */
    sendText(text: string): boolean
    sendFiles(paths: string | string[]): boolean
    sendImage(image: string | Uint8Array | NativeImageLike): boolean
    typeText(text: string): boolean
    startDrag(paths: string | string[]): void
    keyTap(key: string, ...modifiers: string[]): void
    mouseMove(x: number, y: number): void
    mouseClick(x: number, y: number): void
    mouseDoubleClick(x: number, y: number): void
    mouseRightClick(x: number, y: number): void
  }
  screen: {
    displays(): DisplayInfo[]
    primaryDisplay(): DisplayInfo
    cursor(): Point
    nearestDisplay(p: Point): DisplayInfo
    matchingDisplay(r: Rect): DisplayInfo
    toDipPoint(p: Point): Point
    toScreenPoint(p: Point): Point
    toDipRect(r: Rect): Rect
    toScreenRect(r: Rect): Rect
    captureDisplay(displayId?: number): Promise<Array<{ display: DisplayInfo; image: NativeImageLike }>>
    /** 交互式框选截图，返回 PNG Data URL */
    captureRegion(): Promise<string>
    captureRegion(cb: (dataUrl: string) => void): void
    pickColor(): Promise<{ hex: string; rgb: string }>
    pickColor(cb: (c: { hex: string; rgb: string }) => void): void
    captureSources(options?: Record<string, unknown>): Promise<Array<{ id: string; type: 'screen' | 'window'; name: string; thumbnail: NativeImageLike; appIcon?: NativeImageLike }>>
  }
  schedule: {
    request(schedule: Schedule): Promise<void>
    list(): ScheduleInfo[]
    remove(code: string): void
    onTrigger(cb: (action: { code: string }) => void | Promise<void>): void
  }
  ai: {
    chat(options: AiOptions): AiPromise<AiMessage>
    chat(options: AiOptions, onChunk: (chunk: AiMessage) => void): AiPromise<void>
    models(): Promise<Array<{ id: string; label: string; icon: string; cost?: number; vision?: boolean }>>
  }
  tools: {
    register(name: string, handler: (params: Record<string, any>, ctx?: ToolContext) => unknown): void
  }
  media: {
    ffmpeg(args: string[], options?: ((p: FfmpegProgress) => void) | { onProgress?: (p: FfmpegProgress) => void; onLog?: (text: string) => void }): FfmpegProcess
  }
  image: {
    /** sharp 兼容函数 */
    sharp(...args: any[]): any
  }
  billing: {
    isPurchased(): boolean | string
    purchase(options: { goodsId: string; outOrderId?: string; attach?: string }, cb?: () => void): void
  }
  browser: {
    automate(): Automation
    idle(): Array<{ id: number; url: string; title: string; width: number; height: number; x: number; y: number }>
    setProxy(config: { mode?: string; pacScript?: string; proxyRules?: string; proxyBypassRules?: string }): void
    clearCache(): void
  }
}
