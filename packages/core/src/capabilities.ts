// 平台能力接口。API 层（@whatevertools/api）和模块垫片（@whatevertools/shim-node、@whatevertools/shim-electron）只依赖这些接口，
// 每个平台（electron / web / bridge / 以后的 tauri）提供自己能做到的那部分。
//
// 约定：
// - 标注 Sync 的方法必须同步返回（旧 API 是同步的）。做不到同步的平台可以不提供，API 层会按「不支持」处理，
//   或者用缓存 / 同步 XHR（bridge）模拟。
// - 方法缺失 = 不支持；Capabilities.support() 用来报告支持程度，供插件通过 supports() 查询。
// - 二进制统一用 Uint8Array；图片在能力层用 ImageData（PNG 字节 + 尺寸）传递，API 层再包装成 NativeImage 形状。
import type { Support } from './apis'

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

export interface DisplayInfo {
  id: number
  bounds: Rect
  workArea: Rect
  workAreaSize: Size
  size?: Size
  scaleFactor: number
  rotation: number
  label?: string
  internal?: boolean
}

/** 能力层的图片：PNG 字节 */
export interface ImageData {
  png: Uint8Array
  width: number
  height: number
}

/** 旧 API 接受的图片输入：文件路径、Data URL、图片字节，或能力层图片 */
export type ImageInput = string | Uint8Array | ImageData

// ---------- 文件系统（Node fs 的子集，shim-node 用它拼出 fs 模块） ----------

export interface FsStat {
  size: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
  atimeMs: number
  mode: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

export interface FsDirent { name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }

export interface FsCapability {
  readFileSync?(path: string): Uint8Array
  writeFileSync?(path: string, data: Uint8Array, opts?: { append?: boolean; mode?: number }): void
  statSync?(path: string, opts?: { lstat?: boolean }): FsStat | null
  readdirSync?(path: string): FsDirent[]
  mkdirSync?(path: string, opts?: { recursive?: boolean }): void
  rmSync?(path: string, opts?: { recursive?: boolean; force?: boolean }): void
  renameSync?(from: string, to: string): void
  copyFileSync?(from: string, to: string): void
  realpathSync?(path: string): string
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array, opts?: { append?: boolean; mode?: number }): Promise<void>
  stat(path: string, opts?: { lstat?: boolean }): Promise<FsStat | null>
  readdir(path: string): Promise<FsDirent[]>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  watch?(path: string, onChange: (event: 'rename' | 'change', filename: string | null) => void, opts?: { recursive?: boolean }): () => void
  /** 用户交给插件的文件（拖入、选择）在这个平台上的路径；web 端会把 File 放进虚拟文件系统后返回虚拟路径 */
  pathForFile?(file: unknown): string
}

// ---------- 剪贴板 ----------

export interface ClipboardCapability {
  readTextSync?(): string
  writeTextSync?(text: string): void
  readImageSync?(): ImageData | null
  writeImageSync?(image: ImageInput): boolean
  /** 剪贴板里的文件：路径，或平台已经查好的完整条目 */
  readFilesSync?(): Array<string | { path: string; name: string; isFile: boolean; isDirectory: boolean }>
  writeFilesSync?(paths: string[]): boolean
  readHTMLSync?(): string
  writeHTMLSync?(html: string): void
  readText?(): Promise<string>
  writeText?(text: string): Promise<void>
  readImage?(): Promise<ImageData | null>
  writeImage?(image: ImageInput): Promise<boolean>
}

// ---------- 对话框 / 通知 / shell ----------

export interface DialogCapability {
  showOpenDialogSync?(options: Record<string, unknown>): string[] | undefined
  showSaveDialogSync?(options: Record<string, unknown>): string | undefined
  showOpenDialog?(options: Record<string, unknown>): Promise<string[] | undefined>
  showSaveDialog?(options: Record<string, unknown>): Promise<string | undefined>
  /** 简单消息框（权限问询等也用它） */
  showMessageBox?(options: { message: string; detail?: string; buttons: string[]; type?: string }): Promise<number>
}

export interface NotificationCapability {
  /** clickFeatureCode：点击通知后进入插件的哪个功能 */
  show(body: string, opts?: { title?: string; clickFeatureCode?: string }): void
}

export interface ShellCapability {
  openPath?(path: string): Promise<string>
  showItemInFolder?(path: string): void
  trashItem?(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  beep?(): void
}

// ---------- 屏幕 / 截图 ----------

export interface ScreenCapability {
  getAllDisplaysSync(): DisplayInfo[]
  getPrimaryDisplaySync(): DisplayInfo
  getCursorScreenPointSync?(): Point
  getDisplayNearestPointSync?(p: Point): DisplayInfo
  getDisplayMatchingSync?(r: Rect): DisplayInfo
  screenToDipPointSync?(p: Point): Point
  dipToScreenPointSync?(p: Point): Point
  screenToDipRectSync?(r: Rect): Rect
  dipToScreenRectSync?(r: Rect): Rect
}

export interface CaptureCapability {
  captureDisplay?(displayId?: number): Promise<Array<{ display: DisplayInfo; image: ImageData }>>
  /** 交互式框选，取消时 reject */
  selectRegion?(): Promise<ImageData>
  pickColor?(): Promise<{ hex: string; rgb: string }>
  desktopSources?(opts: Record<string, unknown>): Promise<Array<{ id: string; type: 'screen' | 'window'; name: string; thumbnail: ImageData; appIcon?: ImageData }>>
}

// ---------- 窗口 / 进程间通信 ----------

/** 一个由平台创建的窗口；method 是旧 API 白名单里的方法名 */
export interface WindowHandle {
  readonly id: number
  readonly webContentsId: number
  callSync(target: 'win' | 'wc', method: string, args: unknown[]): unknown
  call(target: 'win' | 'wc', method: string, args: unknown[]): Promise<unknown>
  /** 平台通知窗口关闭 */
  onClosed(fn: () => void): void
}

export interface WindowCapability {
  kind: 'main' | 'detach' | 'custom'
  /** 创建窗口，页面加载完成后调用 onLoad */
  createSync?(url: string, options: Record<string, unknown>, onLoad: () => void): WindowHandle
  hidePanelSync?(focusPrev: boolean): boolean
  showPanelSync?(): boolean
  setPanelHeightSync?(height: number): boolean
  /** 面板输入框 */
  panelInput?: {
    setSync(placeholder: string, focus: boolean): boolean
    removeSync(): boolean
    setValueSync(text: string): boolean
    focusSync(): boolean
    blurSync(): void
    selectSync(): boolean
  }
  exitSync?(kill: boolean): void
  findSync?(text: string, opts?: Record<string, unknown>): void
  stopFindSync?(action: string): void
}

/** 窗口之间的消息：对应 ipcRenderer.on / webContents.send / sendToParent */
export interface IpcCapability {
  sendToParent(channel: string, args: unknown[]): void
  /** 收到父窗口（webContents.send）或子窗口（sendToParent）的消息 */
  on(channel: string, listener: (event: { senderId: number; sender: unknown }, ...args: unknown[]) => void): void
  off(channel: string, listener: (...args: any[]) => void): void
  /** 插件直接用 ipcRenderer.send / invoke 的场景（发给宿主），默认不支持 */
  send?(channel: string, args: unknown[]): void
  invoke?(channel: string, args: unknown[]): Promise<unknown>
}

// ---------- 输入 ----------

export interface InputCapability {
  pasteTextSync?(text: string): boolean
  pasteFilesSync?(paths: string[]): boolean
  pasteImageSync?(image: ImageInput): boolean
  typeStringSync?(text: string): boolean
  startDragSync?(paths: string[]): void
  keyTap?(key: string, modifiers: string[]): Promise<void> | void
  mouseMove?(x: number, y: number): void
  mouseClick?(x: number, y: number, button: 'left' | 'right', double: boolean): void
}

// ---------- 进程 / 网络（shim-node 用） ----------

export interface SpawnedProcess {
  pid?: number
  onStdout(fn: (data: Uint8Array) => void): void
  onStderr(fn: (data: Uint8Array) => void): void
  onExit(fn: (code: number | null, signal: string | null) => void): void
  write(data: Uint8Array): void
  closeStdin(): void
  kill(signal?: string): void
}

export interface ProcessCapability {
  spawn(command: string, args: string[], opts?: { cwd?: string; env?: Record<string, string>; shell?: boolean }): SpawnedProcess
  execSync?(command: string, opts?: { cwd?: string; input?: string }): Uint8Array
  env?(): Record<string, string>
  cwd?(): string
}

export interface NetworkCapability {
  /** 不受 CORS 限制的请求（shim-node 的 http/https 用它） */
  fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>
}

// ---------- 多媒体 / 图像 ----------

export interface ImageCapability {
  /** sharp 兼容对象（electron 用 node 版 sharp，web 可接 wasm 版） */
  sharp?: (...args: unknown[]) => unknown
  /** nativeImage 的基础能力 */
  decode?(data: Uint8Array): ImageData
  fromPathSync?(path: string): ImageData | null
  resize?(image: ImageData, size: Partial<Size>): ImageData
  crop?(image: ImageData, rect: Rect): ImageData
  toJPEG?(image: ImageData, quality: number): Uint8Array
  /** 把能力层图片包成平台原生对象（electron 用 nativeImage）；不提供时 API 层用内置的 NativeImage 兼容类 */
  wrap?(image: ImageData): unknown
  /** 文件图标（Data URL） */
  fileIconSync?(path: string): string
  fileIcon?(path: string): Promise<string>
}

export interface FfmpegProgress { bitrate: string; fps: number; frame: number; percent?: number; q: number | string; size: string; speed: string; time: string }

export interface MediaCapability {
  runFFmpeg(args: string[], io: { onProgress?: (p: FfmpegProgress) => void; onLog?: (text: string) => void }): { done: Promise<void>; kill(): void; quit(): void }
}

// ---------- AI / 工具 / 自动化浏览器 ----------

export interface AiCapability {
  models(): Promise<Array<{ id: string; label: string; icon: string; cost?: number; vision?: boolean }>>
  complete(
    req: { model?: string; messages: unknown[]; tools?: unknown[] },
    io: { onChunk?: (chunk: unknown) => void; callTool: (name: string, args: unknown) => Promise<unknown>; signal: AbortSignal },
  ): Promise<unknown>
}

export interface ToolsCapability {
  /** 告诉平台插件注册了一个工具；平台把调用转给 handler */
  register(name: string, handler: (params: Record<string, unknown>, ctx?: { requestId: string | number; sendProgress?: (p: { progress: number; total?: number; message?: string }) => Promise<void> }) => unknown): void
}

export interface BrowserCapability {
  /** 执行 ubrowser 的指令队列，返回 [...结果, 窗口信息] */
  run(steps: Array<{ op: string; args: unknown[] }>, target: Record<string, unknown> | number | undefined): Promise<unknown[]>
  idle?(): unknown[]
  setProxy?(config: Record<string, unknown>): void
  clearCache?(): void
}

// ---------- 定时任务 / 动态功能 / 跳转 ----------

export interface ScheduleCapability {
  request(schedule: Record<string, unknown>): Promise<void>
  listSync(): unknown[]
  removeSync(code: string): void
}

export interface FeaturesCapability {
  getSync(codes?: string[]): unknown[]
  setSync(feature: Record<string, unknown>): void
  removeSync(code: string): boolean
  launchSync?(label: string | [string, string], payload?: unknown): boolean
  openHotkeySettingsSync?(cmdLabel: string, autocopy: boolean): void
  hotkeySync?(cmdLabel: string): string | null
}

// ---------- 系统信息 ----------

export interface SystemCapability {
  os: 'darwin' | 'win32' | 'linux' | 'unknown'
  dataPathSync(): string
  tempPathSync(): string
  getPathSync?(name: string): string
  isDarkSync(): boolean
  onThemeChange?(fn: (dark: boolean) => void): void
  deviceIdSync?(): string
  userSync?(): { avatar: string; nickname: string; type: string } | null
  activeFolder?(): Promise<string>
  activeBrowserUrl?(): Promise<string>
  activeWindow?(): Promise<Record<string, unknown> | null>
  /** 付费状态（宿主自行接入） */
  purchasedSync?(): boolean | string
  openPurchase?(options: Record<string, unknown>): Promise<boolean>
}

// ---------- 数据库 ----------

/** 同步 API 用的数据库接口（引擎在 core/db.ts，平台决定它跑在哪个进程） */
export interface DbCapability {
  putSync(doc: unknown): unknown
  getSync(id: string): unknown
  removeSync(docOrId: unknown): unknown
  bulkSync(docs: unknown[]): unknown
  allSync(filter?: string | string[]): unknown
  putAttachmentSync?(id: string, data: Uint8Array, type: string): unknown
  getAttachmentSync?(id: string): Uint8Array | null
  getAttachmentTypeSync(id: string): string | null
  syncStateSync(): null | 0 | 1
  setItemSync(key: string, value: unknown): void
  getItemSync(key: string): unknown
  removeItemSync(key: string): boolean
  /** 异步版本（db.promises），不提供时 API 层用同步版本包一层 */
  putAttachment?(id: string, data: Uint8Array, type: string): Promise<unknown>
  getAttachment?(id: string): Promise<Uint8Array | null>
}

// ---------- 事件 / 权限 ----------

export type PlatformEvent =
  | 'enter' | 'leave' | 'detach' | 'db.pull' | 'panel.input' | 'themeChange'

export interface EventsCapability {
  on(name: PlatformEvent, fn: (...args: any[]) => void): void
  /** 插件注册了某个事件回调（平台可能据此决定是否推送） */
  listening?(name: string): void
  /** 页面和 onPluginReady 都完成 */
  ready(): void
  /** 需要回复的请求：schedule.trigger、searchPush、searchPush.select */
  onRequest(name: string, fn: (...args: any[]) => unknown): void
}

export interface PermissionCapability {
  /** 同步判定（可能触发问询并阻塞） */
  checkSync(permission: string, scope?: string): boolean
  check?(permission: string, scope?: string): Promise<boolean>
}

// ---------- 汇总 ----------

export interface Capabilities {
  /** 平台名：electron / web / bridge / tauri ... */
  platform: string
  /** 权限已由平台在调用时检查（electron 在 main 里检查），API 层不再重复检查 */
  enforcedByPlatform?: boolean
  /** 能力在这个平台上的支持程度（用于 supports() 查询） */
  support(name: string): Support
  system: SystemCapability
  events: EventsCapability
  permissions: PermissionCapability
  db?: DbCapability
  fs?: FsCapability
  clipboard?: ClipboardCapability
  dialog?: DialogCapability
  notification?: NotificationCapability
  shell?: ShellCapability
  screen?: ScreenCapability
  capture?: CaptureCapability
  window?: WindowCapability
  ipc?: IpcCapability
  input?: InputCapability
  process?: ProcessCapability
  network?: NetworkCapability
  image?: ImageCapability
  media?: MediaCapability
  ai?: AiCapability
  tools?: ToolsCapability
  browser?: BrowserCapability
  schedule?: ScheduleCapability
  features?: FeaturesCapability
}

