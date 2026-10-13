// 只有 UTools.* 类型，不声明全局变量（插件想自己声明 window.utools 是否可选时引用这个）
// 用法：/// <reference types="@whatevertools/utools/namespace" />

export {}

declare global {
  namespace UTools {
    type Platform = 'win32' | 'darwin' | 'linux'

    interface Rectangle { x: number; y: number; width: number; height: number }
    interface Size { width: number; height: number }
    interface Point { x: number; y: number }

    interface Display {
      id: number
      bounds: Rectangle
      workArea: Rectangle
      workAreaSize: Size
      scaleFactor: number
      rotation: number
      label?: string
    }

    interface NativeImage {
      getSize(): Size
      toPNG(): Uint8Array
      toJPEG(quality: number): Uint8Array
      toDataURL(): string
      crop(rect: Rectangle): NativeImage
      resize(options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): NativeImage
      isEmpty(): boolean
    }

    interface MatchFile { isFile: boolean; isDirectory: boolean; name: string; path: string }
    interface MatchWindow { id: number; title: string; x: number; y: number; width: number; height: number; appPath: string; pid: number; app: string }

    interface PluginEnterAction {
      code: string
      type: 'text' | 'img' | 'files' | 'regex' | 'over' | 'window'
      payload: any
      from: 'main' | 'panel' | 'hotkey' | 'redirect'
      option?: { text?: string }
    }
    interface MainPushAction { code: string; type: PluginEnterAction['type']; payload: any }
    interface MainPushResult { icon?: string; text: string; title?: string }

    interface DbDoc { _id: string; _rev?: string; [key: string]: any }
    interface DbResult { id: string; rev?: string; ok?: boolean; error?: boolean; name?: string; message?: string }
    type ReplicateState = null | 0 | 1

    interface Db {
      put(doc: DbDoc): DbResult
      get(id: string): DbDoc | null
      remove(doc: DbDoc | string): DbResult
      bulkDocs(docs: DbDoc[]): DbResult[]
      allDocs(filter?: string | string[]): DbDoc[]
      postAttachment(id: string, attachment: Uint8Array, type: string): DbResult
      getAttachment(id: string): Uint8Array | null
      getAttachmentType(id: string): string | null
      replicateStateFromCloud(): ReplicateState
      promises: {
        put(doc: DbDoc): Promise<DbResult>
        get(id: string): Promise<DbDoc | null>
        remove(doc: DbDoc | string): Promise<DbResult>
        bulkDocs(docs: DbDoc[]): Promise<DbResult[]>
        allDocs(filter?: string | string[]): Promise<DbDoc[]>
        postAttachment(id: string, attachment: Uint8Array, type: string): Promise<DbResult>
        getAttachment(id: string): Promise<Uint8Array | null>
        getAttachmentType(id: string): Promise<string | null>
        replicateStateFromCloud(): Promise<ReplicateState>
      }
    }

    interface DbStorage {
      setItem(key: string, value: any): void
      getItem<T = any>(key: string): T | null
      removeItem(key: string): boolean
    }

    interface Feature {
      code: string
      explain?: string
      description?: string
      icon?: string
      platform?: Platform | Platform[]
      mainPush?: boolean
      mainHide?: boolean
      cmds: Array<string | Cmd>
    }
    type Cmd =
      | { type: 'regex'; label: string; match: string; minLength?: number; maxLength?: number }
      | { type: 'over'; label: string; exclude?: string; minLength?: number; maxLength?: number }
      | { type: 'img'; label: string }
      | { type: 'files'; label: string; fileType?: 'file' | 'directory'; extensions?: string[]; match?: string; minLength?: number; maxLength?: number }
      | { type: 'window'; label: string; match: { app: string[]; title?: string } }

    interface BrowserWindowOptions {
      show?: boolean; title?: string; width?: number; height?: number; minWidth?: number; minHeight?: number
      maxWidth?: number; maxHeight?: number; x?: number; y?: number; center?: boolean; resizable?: boolean
      movable?: boolean; maximizable?: boolean; minimizable?: boolean; closable?: boolean; frame?: boolean
      hasShadow?: boolean; roundedCorners?: boolean; alwaysOnTop?: boolean; focusable?: boolean; skipTaskbar?: boolean
      enableLargerThanScreen?: boolean; fullscreenable?: boolean; fullscreen?: boolean; opacity?: number
      backgroundColor?: string; transparent?: boolean; titleBarStyle?: string; acceptFirstMouse?: boolean
      autoHideMenuBar?: boolean
      webPreferences?: { preload?: string; backgroundThrottling?: boolean; [k: string]: any }
    }

    interface WebContents {
      id: number
      send(channel: string, ...args: any[]): void
      executeJavaScript<T = any>(code: string, userGesture?: boolean): Promise<T>
      capturePage(rect?: Rectangle, options?: { stayHidden?: boolean; stayAwake?: boolean }): Promise<NativeImage>
      openDevTools(options?: { mode: 'left' | 'right' | 'bottom' | 'undocked' | 'detach'; activate?: boolean; title?: string }): void
      closeDevTools(): void
      insertCSS(css: string, options?: { cssOrigin?: 'user' | 'author' }): Promise<string>
      removeInsertedCSS(key: string): Promise<void>
      setBackgroundThrottling(allowed: boolean): void
      invalidate(): void
      isDestroyed(): boolean
      getURL(): string
      getTitle(): string
      setZoomFactor(factor: number): void
      getZoomFactor(): number
      focus(): void
      [method: string]: any
    }

    interface BrowserWindow {
      id: number
      webContents: WebContents
      show(): void; showInactive(): void; hide(): void; destroy(): void; close(): void
      isFocused(): boolean; isDestroyed(): boolean; isVisible(): boolean; focus(): void; blur(): void
      setSize(width: number, height: number, animate?: boolean): void; getSize(): [number, number]
      setPosition(x: number, y: number, animate?: boolean): void; getPosition(): [number, number]
      setBounds(bounds: Partial<Rectangle>, animate?: boolean): void; getBounds(): Rectangle
      setAlwaysOnTop(flag: boolean, level?: string): void; isAlwaysOnTop(): boolean; moveTop(): void
      setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void
      setVisibleOnAllWorkspaces(visible: boolean, options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean }): void
      setFullScreen(flag: boolean): void; isFullScreen(): boolean
      setOpacity?(opacity: number): void
      loadURL(url: string): Promise<void>; loadFile(filePath: string): Promise<void>
      [method: string]: any
    }

    interface OpenDialogOptions { title?: string; defaultPath?: string; buttonLabel?: string; filters?: Array<{ name: string; extensions: string[] }>; properties?: string[]; message?: string }
    interface SaveDialogOptions extends OpenDialogOptions { nameFieldLabel?: string; showsTagField?: boolean }

    interface Schedule { code: string; label: string; trigger: number | { cron: string; startTime?: number; endTime?: number } }
    interface ScheduleInfo extends Schedule { successCount: number; failureCount: number; lastExecuteAt?: number; lastStatus?: 'success' | 'failure' }

    interface AiMessage { role: 'system' | 'user' | 'assistant'; content?: string | any[]; reasoning_content?: string }
    interface AiTool { type: 'function'; function: { name: string; description: string; parameters: object } }
    interface AiOptions { model?: string; messages: AiMessage[]; tools?: AiTool[] }
    type AiPromise<T> = Promise<T> & { abort(): void }
    interface AiModel { id: string; label: string; icon: string; cost?: number; vision?: boolean }
    interface ToolContext { requestId: string | number; sendProgress?: (o: { progress: number; total?: number; message?: string }) => Promise<void> }

    interface FFmpegProgress { bitrate: string; fps: number; frame: number; percent?: number; q: number | string; size: string; speed: string; time: string }
    type FFmpegProcess = Promise<void> & { kill(): void; quit(): void }

    interface UBrowserInstance { id: number; url: string; title: string; width: number; height: number; x: number; y: number }
    interface UBrowser {
      run(options?: Omit<BrowserWindowOptions, 'webPreferences'> | number): Promise<any[]>
      goto(url: string, headers?: Record<string, string>, timeout?: number): UBrowser
      userAgent(ua: string): UBrowser
      viewport(width: number, height: number): UBrowser
      device(options: { userAgent?: string; viewport?: { width: number; height: number; deviceScaleFactor?: number; isMobile?: boolean; hasTouch?: boolean } }): UBrowser
      click(selector: string, mouseButton?: 'left' | 'middle' | 'right'): UBrowser
      click(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): UBrowser
      dblclick(...args: any[]): UBrowser
      mousedown(...args: any[]): UBrowser
      mouseup(...args: any[]): UBrowser
      hover(...args: any[]): UBrowser
      press(key: string, ...modifiers: string[]): UBrowser
      focus(selector: string): UBrowser
      input(selector: string, payload: string): UBrowser
      input(payload: string): UBrowser
      value(selector: string, payload: string): UBrowser
      check(selector: string, checked: boolean): UBrowser
      scroll(...args: any[]): UBrowser
      file(selector: string, payload: string | Uint8Array | string[]): UBrowser
      drop(...args: any[]): UBrowser
      paste(payload: string): UBrowser
      download(...args: any[]): UBrowser
      evaluate<A extends any[]>(func: (...args: A) => any, ...args: A): UBrowser
      css(css: string): UBrowser
      wait(...args: any[]): UBrowser
      when(...args: any[]): UBrowser
      endWhen(): UBrowser
      markdown(selector?: string): UBrowser
      screenshot(target?: string | Rectangle, savePath?: string): UBrowser
      pdf(options: object, savePath?: string): UBrowser
      cookies(filter?: string | object): UBrowser
      setCookies(...args: any[]): UBrowser
      removeCookies(name: string): UBrowser
      clearCookies(url?: string): UBrowser
      show(): UBrowser
      hide(): UBrowser
      devTools(mode?: 'right' | 'bottom' | 'undocked' | 'detach'): UBrowser
    }

    interface Api {
      // 事件
      onPluginReady(callback: () => void | Promise<void>): void
      onPluginEnter(callback: (action: PluginEnterAction) => void): void
      onPluginOut(callback: (isKill: boolean) => void): void
      onScheduleTrigger(callback: (action: { code: string }) => void | Promise<void>): void
      onMainPush(callback: (action: MainPushAction) => MainPushResult[], onSelect?: (action: PluginEnterAction) => boolean | undefined): void
      onPluginDetach(callback: () => void): void
      onDbPull(callback: (docs: DbDoc[]) => void): void
      // 窗口
      createBrowserWindow(url: string, options?: BrowserWindowOptions, callback?: () => void): BrowserWindow
      sendToParent(channel: string, ...args: any[]): void
      getWindowType(): 'main' | 'detach' | 'custom'
      hideMainWindow(isFocusPrevWindow?: boolean): boolean
      showMainWindow(): boolean
      setExpandHeight(height: number): boolean
      setSubInput(onChange: (details: { text: string }) => void, placeholder?: string, isFocus?: boolean): boolean
      removeSubInput(): boolean
      setSubInputValue(text: string): boolean
      subInputFocus(): boolean
      subInputBlur(): void
      subInputSelect(): boolean
      findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): void
      stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
      outPlugin(isKill?: boolean): void
      // 动态功能
      getFeatures(codes?: string[]): Feature[]
      setFeature(feature: Feature): void
      removeFeature(code: string): boolean
      // 数据库
      db: Db
      dbStorage: DbStorage
      // 屏幕
      captureDisplay(options?: { displayId?: number }): Promise<Array<{ display: Display; image: NativeImage }>>
      screenCapture(): Promise<string>
      screenCapture(callback: (image: string) => void): void
      screenColorPick(): Promise<{ hex: string; rgb: string }>
      screenColorPick(callback: (color: { hex: string; rgb: string }) => void): void
      getAllDisplays(): Display[]
      getPrimaryDisplay(): Display
      getCursorScreenPoint(): Point
      getDisplayNearestPoint(point: Point): Display
      getDisplayMatching(rect: Rectangle): Display
      screenToDipPoint(point: Point): Point
      dipToScreenPoint(point: Point): Point
      screenToDipRect(rect: Rectangle): Rectangle
      dipToScreenRect(rect: Rectangle): Rectangle
      desktopCaptureSources(options?: { types?: Array<'window' | 'screen'>; thumbnailSize?: Size; fetchWindowIcons?: boolean }): Promise<Array<{ id: string; type: 'screen' | 'window'; name: string; thumbnail: NativeImage; appIcon?: NativeImage }>>
      // 系统
      getPluginLocalDataPath(): string
      getPluginTempPath(): string
      showNotification(body: string, clickFeatureCode?: string): void
      showOpenDialog(options: OpenDialogOptions): string[] | undefined
      showSaveDialog(options: SaveDialogOptions): string | undefined
      shellOpenPath(fullPath: string): Promise<string>
      shellTrashItem(fullPath: string): Promise<void>
      shellShowItemInFolder(fullPath: string): void
      shellOpenExternal(url: string): Promise<void>
      shellBeep(): void
      getNativeId(): string
      getAppName?(): string
      getAppVersion(): string
      getUser(): { avatar: string; nickname: string; type: 'member' | 'user' } | null
      getPath(name: 'home' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'): string
      getFileIcon(filePath: string): string
      getFileIconAsync(filePath: string): Promise<string>
      readCurrentFolderPath(): Promise<string>
      readCurrentBrowserUrl(): Promise<string>
      isDev(): boolean
      isMacOS(): boolean
      isWindows(): boolean
      isLinux(): boolean
      isDarkColors(): boolean
      // 复制
      copyText(text: string): boolean
      copyFile(filePath: string | string[]): boolean
      copyImage(image: string | Uint8Array): boolean
      getCopiedFiles(): MatchFile[] | null
      // 输入
      hideMainWindowPasteText(text: string): boolean
      hideMainWindowPasteFile(filePath: string | string[]): boolean
      hideMainWindowPasteImage(image: string | Uint8Array): boolean
      hideMainWindowTypeString(text: string): boolean
      startDrag(filePath: string | string[]): void
      simulateKeyboardTap(key: string, ...modifiers: string[]): void
      simulateMouseMove(x: number, y: number): void
      simulateMouseClick(x: number, y: number): void
      simulateMouseDoubleClick(x: number, y: number): void
      simulateMouseRightClick(x: number, y: number): void
      // 跳转 / 快捷键
      redirect(label: string | [string, string], payload?: string | { type: 'img' | 'files'; data: string | string[] }): boolean
      redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): void
      getCmdHotKey(cmdLabel: string): string | null
      // 定时任务
      requestSchedule(schedule: Schedule): Promise<void>
      getSchedules(): ScheduleInfo[]
      removeSchedule(code: string): void
      // 付费
      isPurchasedUser(): boolean | string
      openPurchase(options: { goodsId: string; outOrderId?: string; attach?: string }, callback?: () => void): void
      // AI
      registerTool(name: string, handler: (params: Record<string, any>, ctx?: ToolContext) => any): void
      ai(options: AiOptions): AiPromise<AiMessage>
      ai(options: AiOptions, streamCallback: (chunk: AiMessage) => void): AiPromise<void>
      allAiModels(): Promise<AiModel[]>
      // 多媒体
      sharp(input?: any, options?: any): any
      runFFmpeg(args: string[], onProgress?: (progress: FFmpegProgress) => void): FFmpegProcess
      runFFmpeg(args: string[], options?: { onProgress?: (progress: FFmpegProgress) => void; onLog?: (text: string) => void }): FFmpegProcess
      // 自动化浏览器
      readonly ubrowser: UBrowser
      getIdleUBrowsers(): UBrowserInstance[]
      setUBrowserProxy(config: { mode?: string; pacScript?: string; proxyRules?: string; proxyBypassRules?: string }): void
      clearUBrowserCache(): void
    }
  }
}
