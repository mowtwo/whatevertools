# Legacy uTools Plugin API — Reimplementation Reference

Source: `.claude/skills/utools-plugin-dev/references/` (api-reference/*.md, development/*.md).
Purpose: exact surface for re-implementing the `window.utools` API in a different Electron host.
Conventions:
- Signatures copied verbatim from the docs. "(unspecified)" = the docs do not say.
- "sync" = returns a plain value; "Promise" = returns a Promise.
- Window types: `main` (plugin main view in the search-box window), `detach` (main view moved to a
  standalone window), `custom` (window created via `createBrowserWindow`). See `getWindowType()`.
- Unless a section says otherwise, which window types may call an API is (unspecified); assume all.

---

## 0. Runtime / Architecture

| Component | Version |
| --- | --- |
| Electron | 34.5.8 |
| Chromium | 132 |
| Node.js | 20.19.1 |

- Plugin main UI runs in an Electron `BrowserView` attached to the uTools search-box main window.
- "Detach" moves the `BrowserView` into a standalone window (`onPluginDetach` fires).
- When the plugin goes to background, the `BrowserView` is removed from the main window and kept alive
  (background state). After the main window hides, the plugin may auto-exit after a user-set time
  (default 3 minutes).
- Custom windows = Electron `BrowserWindow` created by `utools.createBrowserWindow()`, managed by runtime.
- `window.utools` is available in the frontend AND in preload.
- Frontend cannot access Node.js / third-party Node modules directly; only via preload-exposed `window.xxx`.
- Lifecycle order:
  1. Plugin loaded -> `onPluginReady` (optional; runtime awaits callback/Promise before entering).
  2. Then one of: user enters -> `onPluginEnter`; schedule fires -> `onScheduleTrigger`;
     AI agent call -> registered tool handler runs.
  3. User leaves -> `onPluginOut(isKill)`.
- Each event listener should be registered only once per plugin ("每个插件应用仅需注册一次事件监听").
  Behavior on re-registration (replace vs. append): (unspecified).

### Plugin directory (deliverable)

```text
plugin/
├─ plugin.json      # required
├─ preload.js       # optional, declared in plugin.json
├─ index.html       # required (plugin.json main)
├─ logo.png         # required (plugin.json logo)
├─ index.js / assets/   # optional build output
└─ node_modules/    # optional, deps for preload.js
```

- Dev tool packs the chosen build output dir as plugin root.
- Recommended source layout: `public/` (plugin.json, index.html, logo, extra html entries),
  `bridge/` (preload scripts, e.g. `bridge/foo_preload.js`), `src/`, `dist/` (output = plugin root).

---

## 1. plugin.json

```ts
interface PluginJson {
  /** Required. Relative path (to plugin.json), must be a .html file. */
  main: string;
  /** Required. Relative path to logo file. */
  logo: string;
  /** Optional. Relative path to a .js preload; must live inside plugin dir (same dir or subdir). */
  preload?: string;
  /** Optional. Default runtime behavior. */
  pluginSetting?: {
    /** Single-instance mode. Default true. */
    single?: boolean;
    /** Initial height (DIP). Default 544. Changeable via utools.setExpandHeight(). */
    height?: number;
  };
  /** Required. minLength 1. */
  features: Feature[];
  /** Optional. AI-agent tool declarations (MCP + ai() function calling). */
  tools?: Record<string, ToolDeclaration>;
}

interface Feature {
  /** Required. Unique within plugin; passed to plugin as action.code. */
  code: string;
  description?: string;
  /** .png/.jpg/.svg relative path. (setFeature also accepts jpeg/webp and Base64 Data URL.) */
  icon?: string;
  platform?: Platform | Platform[];
  /** true: plugin may continuously push dynamic results into search results (see onMainPush). */
  mainPush?: boolean;
  /** true: when triggered from a non-search-box entry (hotkey, panel...), don't show main window.
   *  Entering via search box still shows the window regardless. */
  mainHide?: boolean;
  /** Required. minLength 1. string = "function command" (type "text"); object = "match command". */
  cmds: Array<string | Cmd>;
}

type Platform = "win32" | "darwin" | "linux";

type Cmd = RegexCmd | OverCmd | ImgCmd | FilesCmd | WindowCmd;

interface RegexCmd {
  type: "regex";
  label: string;            // required
  match: string;            // regex literal as string, e.g. "/^https?:\\/\\/\\S+$/i"
  minLength?: number;       // min chars
  maxLength?: number;       // max chars
}

interface OverCmd {
  type: "over";
  label: string;
  exclude?: string;         // regex literal string; text matching it is excluded
  minLength?: number;
  maxLength?: number;       // default max 10000
}

interface ImgCmd {
  type: "img";
  label: string;
}

interface FilesCmd {
  type: "files";
  label: string;
  fileType?: "file" | "directory";
  extensions?: string[];    // e.g. ["png","jpg"]; mutually exclusive with match
  match?: string;           // regex literal string on file/folder NAME; mutually exclusive with extensions
  minLength?: number;       // min file count
  maxLength?: number;       // max file count
}

interface WindowCmd {
  type: "window";
  label: string;
  match: {
    app: string[];          // required; any-of app names, e.g. ["Finder.app","explorer.exe"]
    title?: string;         // regex literal string on window title
  };
}

interface ToolDeclaration {
  description: string;                 // required
  inputSchema: object;                 // required JSON Schema, not null;
                                       // no-arg: { "type": "object", "additionalProperties": false }
  outputSchema?: object;               // optional JSON Schema; absent = output not declared
}
```

Notes:
- All paths are relative to plugin.json's directory.
- Function command (string cmd) naming: 1–80 chars (recommend ≤20); forbidden: control/invisible chars,
  `\ / : * ? " < > |`, names consisting only of emoji/whitespace. Match-command `label` uses same rules.
- Chinese commands automatically searchable by pinyin and initials (no config).
- Plugin must have at least one function command (string cmd).
- Max 5 function commands per feature; extras ignored.
- `match` regex strings are JSON strings: backslashes must be JSON-escaped (`\s` -> `\\s`).
  Format is a JS regex literal with slashes and flags (`"/.../i"`, `"/.../im"`).
- Regexes that match anything are ignored by uTools (e.g. `/\.*/`, `/(.)+/`, `/[\s\S]*/`).
- `files`: if neither `extensions` nor `match` -> matches all files.
- `img`: matches pasted or dragged-in images.
- `window`: matches the current active system window.
- `tools`: names unique; recommended lowercase `snake_case`; every declared tool must be registered via
  `utools.registerTool()` with the identical name.
- Fields NOT documented in the source docs (treat as unspecified): plugin `name`/`pluginName`, `version`,
  `description`, `author`, `homepage`, `development` (e.g. dev `main` URL), `platform` at plugin level.
  Note: `utools.redirect([pluginName, label])` references a plugin name, but its source field is unspecified.

Minimal:
```json
{ "main": "index.html", "logo": "logo.png", "features": [{ "code": "hello", "cmds": ["你好"] }] }
```

---

## 2. Preload Rules

- Declared by `plugin.json.preload` (main view) or `webPreferences.preload` (custom window).
- Executed before the window's page loads.
- Module system: **CommonJS** (`require`). Node v20.19.1.
- Can use: Node built-ins (`fs`, `path`, `os`, `child_process`, ...), third-party Node modules (npm or
  source), own modules (`require("./libs/x.js")`), Electron renderer APIs (`clipboard`, `nativeImage`,
  `ipcRenderer`, ...), and `window.utools` / `utools` global.
- Exposes APIs by assigning onto `window` (recommended single namespace `window.services`). The frontend
  then reads `window.services` directly -> the preload and page share the same `window` object.
  contextIsolation setting: (unspecified); documented behavior implies a shared `window` (no
  `contextBridge` used). nodeIntegration in page: off (frontend "cannot directly access Node.js").
- npm deps for preload: a separate `package.json` next to preload.js with `"type": "commonjs"`,
  `npm install` there; or bundle with webpack.
- Custom-window preloads follow the same rules; they also receive IPC from parent via
  `require("electron").ipcRenderer.on(channel, (event, ...args) => {})`.
- Main-view preload receives messages from child windows (`utools.sendToParent`) via `ipcRenderer.on`.
- Guidance (not enforced): least exposure; never expose raw `fs`/`child_process`/Node objects to frontend.

---

## 3. Storage Rules

| Data | Mechanism | Lifetime | Synced |
| --- | --- | --- | --- |
| User data | `utools.db` / `utools.dbStorage` | long-term | yes (if user enabled sync) |
| App data | `utools.getPluginLocalDataPath()` dir | long-term; NOT deleted on uninstall | no |
| Temp data | `utools.getPluginTempPath()` dir | cleared when plugin process ends or app exits | no |
| User files | `utools.getPath(name)` / `showSaveDialog` | user-managed | no |

- Both plugin dirs are auto-created if missing; per-plugin.
- DB data stored locally by default; synced to cloud across devices when uTools sync is enabled.
- Not for DB: logs, caches, search indexes, temp data, binaries, operation logs, downloads.

---

## 4. Events

```ts
function onPluginReady(callback: () => void | Promise<void>): void;
function onPluginEnter(callback: (action: PluginEnterAction) => void): void;
function onPluginOut(callback: (isKill: boolean) => void): void;
function onScheduleTrigger(callback: (action: ScheduleTriggerAction) => void): void;
function onMainPush(
  callback: (action: MainPushAction) => MainPushResult[],
  onSelect?: (action: PluginEnterAction) => boolean | undefined
): void;
function onPluginDetach(callback: () => void): void;
function onDbPull(callback: (docs: DbDoc[]) => void): void;

interface PluginEnterAction {
  code: string;                                   // feature.code
  type: "text" | "img" | "files" | "regex" | "over" | "window";
  payload: string | MatchFile[] | MatchWindow;
  from: "main" | "panel" | "hotkey" | "redirect";
  option?: { text?: string };                     // only when entered via an onMainPush result
}

interface MainPushAction {
  code: string;
  type: "text" | "img" | "files" | "regex" | "over" | "window";
  payload: string | MatchFile[] | MatchWindow;
}

interface MainPushResult {
  icon?: string;    // relative path
  text: string;
  title?: string;   // hover tooltip
}

interface MatchFile {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  path: string;     // absolute
}

interface MatchWindow {
  id: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  appPath: string;
  pid: number;
  app: string;
}

interface ScheduleTriggerAction {
  code: string;     // Schedule.code from requestSchedule
}
```

Payload by `type`:
| type | payload |
| --- | --- |
| `text` | `string` — the function-command name that was triggered |
| `regex` | `string` — matched text |
| `over` | `string` — matched text |
| `img` | `string` — image as Base64 Data URL |
| `files` | `MatchFile[]` |
| `window` | `MatchWindow` |

`from` values: `main` = search box; `panel` = super panel; `hotkey` = global hotkey;
`redirect` = another plugin via `utools.redirect()`.

Notes:
- `onPluginReady`: runtime waits for callback completion (awaits returned Promise) before entering.
- `onPluginOut(isKill)`: `true` = plugin process ends; `false` = hidden to background, process alive.
  Docs warn: don't close custom windows in `onPluginOut` (auto-exit would kill in-use windows).
- `onScheduleTrigger`: if plugin not running, runtime starts it then fires the event. Result recording:
  normal completion = success; throw or rejected Promise = failure (updates successCount / failureCount /
  lastExecuteAt / lastStatus). So the host must await a returned Promise (return type is declared
  `void` but rejected Promises count).
- `onMainPush`: requires `feature.mainPush: true`. `callback` called when search box requests push
  content; its return list shown as search results (sync return per signature). `onSelect` called when user
  picks a result, with a `PluginEnterAction` whose `option.text` = chosen result text; only a return of
  `true` enters the plugin and fires `onPluginEnter` (with `option`).
- `onPluginDetach`: user detaches plugin from main search window into standalone window.
- `onDbPull`: fired when docs synced from another device arrive; `docs` = synced docs.

---

## 5. Window

```ts
function createBrowserWindow(
  url: string,
  options?: BrowserWindowConstructorOptions,
  callback?: Function
): BrowserWindow;
function sendToParent(channel: string, ...args: any[]): void;
function getWindowType(): "main" | "detach" | "custom";
function hideMainWindow(isFocusPrevWindow?: boolean): boolean;
function showMainWindow(): boolean;
function setExpandHeight(height: number): boolean;
function setSubInput(
  onChange: (details: { text: string }) => void,
  placeholder?: string,
  isFocus?: boolean
): boolean;
function removeSubInput(): boolean;
function setSubInputValue(text: string): boolean;
function subInputFocus(): boolean;
function subInputBlur(): void;
function subInputSelect(): boolean;
function findInPage(text: string, options?: FindInPageOptions): void;
function stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
function outPlugin(isKill?: boolean): void;

interface FindInPageOptions {
  forward?: boolean;    // default true
  findNext?: boolean;   // default false; "start new session" — docs say true on first find, false to continue
  matchCase?: boolean;  // default false
}
```

Notes / window-type rules:
- `getWindowType`: `main` = search-box main window; `detach` = detached standalone; `custom` = custom window.
- `hideMainWindow(isFocusPrevWindow = true)`: hides search-box main window and the plugin running in it;
  detached plugins unaffected. Returns `false` if caller is not the search-box main window.
  (Doc heading names the param `isRestorePreWindow`; signature uses `isFocusPrevWindow`.)
- `showMainWindow()`: `false` if caller is not the search-box main window.
- `setExpandHeight(height)`: DIP; `false` if caller is not the search-box main window.
- `setSubInput(onChange, placeholder?, isFocus = true)`: replaces main input with a sub-input; `onChange`
  fires on every text change with `{ text }`. Returns `false` when called from a custom window.
- `removeSubInput` / `setSubInputValue` / `subInputFocus` / `subInputSelect`: `false` from custom window.
- `subInputBlur()`: blur sub-input and focus the plugin; returns void.
- `subInputSelect()`: focus sub-input and select all.
- `stopFindInPage(action)`: default `clearSelection` (per prose; param typed required).
- `outPlugin(isKill = false)`: `false` -> back to background (fast resume); `true` -> terminate plugin.

### 5.1 createBrowserWindow

- `url`: HTML path relative to plugin root; may include query string (`"foo.html?params=xxx"`).
- `options.webPreferences.preload`: preload path; docs example uses plugin-root-relative names
  (`"test_preload.js"`, `"foo_preload.js"` — built from `bridge/` into output root). Exact resolution base:
  (unspecified; examples imply relative to plugin root). Only `preload` is documented under webPreferences.
- `callback`: invoked once the custom window's page has finished loading. Typical: `win.show()`,
  `win.setAlwaysOnTop(...)`, `win.webContents.send(...)`. Note callback references `win` returned
  synchronously — so the window object must be returned before callback fires.
- Returned `BrowserWindow`: most props/methods match Electron, but **instance event listening on
  BrowserWindow and webContents is NOT supported** (no `on/once/...`).
- Which window types may create windows: (unspecified); custom windows can create custom windows
  (sendToParent targets "the window that created the current window, which may be main view or another
  custom window").
- Recommended: `show: false` then `win.show()` in callback to avoid white flash.
- Closing: page may call `window.close()` unless created with `closable: false` (custom-window doc spells it
  `closeable`); or parent closes via `win.close()`.
- To reopen main UI from a custom window use `utools.redirect([pluginName, cmdLabel])`.
- Transparent window mouse events: use near-transparent real background, e.g. `"rgba(255,255,255,0.01)"`.
- Perf note: `focusable: false` may cause Chromium to throttle rendering; `backgroundThrottling: false`
  doesn't fully avoid it.
- Full-screen overlay example uses `fullscreen` on Windows; `setAlwaysOnTop(true, "screen-saver")` in try/catch.

```ts
interface BrowserWindowConstructorOptions {
  show?: boolean;                  // default true
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  x?: number;
  y?: number;
  center?: boolean;                // default false
  resizable?: boolean;             // default true
  movable?: boolean;               // default true
  maximizable?: boolean;           // default true
  minimizable?: boolean;           // default true
  closable?: boolean;              // default true
  frame?: boolean;                 // default true
  hasShadow?: boolean;             // default true
  roundedCorners?: boolean;        // default true
  alwaysOnTop?: boolean;           // default false
  focusable?: boolean;             // default true
  skipTaskbar?: boolean;           // default false
  enableLargerThanScreen?: boolean;// default false
  fullscreenable?: boolean;        // default true
  fullscreen?: boolean;            // default false
  opacity?: number;                // 0.0–1.0, default 1.0
  backgroundColor?: string;
  transparent?: boolean;           // default false
  titleBarStyle?: string;
  acceptFirstMouse?: boolean;      // macOS, default false
  webPreferences?: { preload?: string };
}
```
- Also used in docs examples but not in the interface: `autoHideMenuBar: true`. Status: (unspecified).

Returned window — method whitelist:

```ts
interface BrowserWindow {
  id: number;
  webContents: WebContents;
  show(): void;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  close(): void;
  isFocused(): boolean;
  isDestroyed(): boolean;
  isVisible(): boolean;
  focus(): void;
  blur(): void;
  setResizable(resizable: boolean): void;
  isResizable(): boolean;
  setSize(width: number, height: number, animate?: boolean): void;      // DIP; animate macOS
  getSize(): [width: number, height: number];
  setPosition(x: number, y: number, animate?: boolean): void;            // DIP; animate macOS
  getPosition(): [x: number, y: number];
  setBounds(bounds: Rectangle, animate?: boolean): void;                 // animate macOS
  getBounds(): Rectangle;
  setContentBounds(bounds: Rectangle): void;
  getContentBounds(): Rectangle;
  getNormalBounds(): Rectangle;
  setContentSize(width: number, height: number): void;
  getContentSize(): [width: number, height: number];
  setMinimumSize(width: number, height: number): void;
  getMinimumSize(): [width: number, height: number];
  setMaximumSize(width: number, height: number): void;
  getMaximumSize(): [width: number, height: number];
  setEnabled(enable: boolean): void;
  isEnabled(): boolean;
  maximize(): void;
  unmaximize(): void;
  isMaximized(): boolean;
  minimize(): void;
  restore(): void;
  isMinimized(): boolean;
  isNormal(): boolean;
  setFullScreen(flag: boolean): void;
  isFullScreen(): boolean;
  setFullScreenable(fullscreenable: boolean): void;
  isFullScreenable(): boolean;
  setClosable(closable: boolean): void;
  isClosable(): boolean;
  setAlwaysOnTop(flag: boolean, level?: string): void;                   // level per Electron, e.g. 'screen-saver'
  isAlwaysOnTop(): boolean;
  moveTop(): void;
  setTitle(title: string): void;
  getTitle(): string;
  setAspectRatio(aspectRatio: number, extraSize?: Size): void;
  setBackgroundColor(backgroundColor: string): void;
  getBackgroundColor(): string;
  setHasShadow(hasShadow: boolean): void;
  hasShadow(): boolean;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  setSkipTaskbar(skip: boolean): void;
  setMenuBarVisibility(visible: boolean): void;
  isMenuBarVisible(): boolean;
  setProgressBar(
    progress: number,                                                    // 0–1; <0 removes
    options?: { mode?: 'none' | 'normal' | 'indeterminate' | 'error' | 'paused' }
  ): void;
  setVisibleOnAllWorkspaces(                                             // macOS, Linux
    visible: boolean,
    options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean }
  ): void;
  isVisibleOnAllWorkspaces(): boolean;
  setContentProtection(enable: boolean): void;                           // Windows, macOS
  isContentProtected(): boolean;
  setKiosk(flag: boolean): void;
  isKiosk(): boolean;
  flashFrame(flag: boolean): void;
  focusOnWebView(): void;
  blurWebView(): void;
  capturePage(
    rect?: Rectangle,
    options?: { stayHidden?: boolean /* default true */; stayAwake?: boolean /* default false */ }
  ): Promise<NativeImage>;
  reload(): void;
  reloadIgnoringCache(): void;
  loadURL(url: string): Promise<void>;                                   // remote page
  loadFile(filePath: string): Promise<void>;                             // relative to plugin root
  isLoading(): boolean;
  stop(): void;
}
```

webContents whitelist:

```ts
interface WebContents {
  id: number;
  send(channel: string, ...args: any[]): void;   // received in window preload via ipcRenderer.on(channel)
  capturePage(
    rect?: Rectangle,
    options?: { stayHidden?: boolean /* default true */; stayAwake?: boolean /* default false */ }
  ): Promise<NativeImage>;
  openDevTools(options?: {
    mode: 'left' | 'right' | 'bottom' | 'undocked' | 'detach';
    activate?: boolean;
    title?: string;
  }): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  isDevToolsFocused(): boolean;
  toggleDevTools(): void;
  executeJavaScript<T>(code: string, userGesture?: boolean /* default false */): Promise<T>;
  insertCSS(css: string, options?: { cssOrigin?: 'user' | 'author' /* default 'author' */ }): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
  insertText(text: string): Promise<void>;
  copy(): void;
  cut(): void;
  paste(): void;
  pasteAndMatchStyle(): void;
  delete(): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  unselect(): void;
  replace(text: string): void;
  replaceMisspelling(text: string): void;
  copyImageAt(x: number, y: number): void;
  findInPage(
    text: string,
    options?: { forward?: boolean /* true */; findNext?: boolean /* false */; matchCase?: boolean /* false */ }
  ): number;
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
  isLoading(): boolean;
  isLoadingMainFrame(): boolean;
  isWaitingForResponse(): boolean;
  stop(): void;
  isDestroyed(): boolean;
  isCrashed(): boolean;
  isFocused(): boolean;
  isPainting(): boolean;
  isOffscreen(): boolean;
  startPainting(): void;
  stopPainting(): void;
  isBeingCaptured(): boolean;
  isCurrentlyAudible(): boolean;
  isAudioMuted(): boolean;
  setAudioMuted(muted: boolean): void;
  getTitle(): string;
  getURL(): string;
  getUserAgent(): string;
  setUserAgent(userAgent: string): void;
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
  getBackgroundThrottling(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
  getFrameRate(): number;
  setFrameRate(fps: number): void;
  getWebRTCIPHandlingPolicy(): WebRTCIPHandlingPolicy;
  setWebRTCIPHandlingPolicy(policy: WebRTCIPHandlingPolicy): void;
  setIgnoreMenuShortcuts(ignore: boolean): void;
  getProcessId(): number;
  getOSProcessId(): number;
  getPrinters(): PrinterSync[];
  print(options?: Record<string, any>, callback?: (success: boolean, errorType?: string) => void): void;
  printToPDF(options: Record<string, any>): Promise<Uint8Array>;
  savePage(fullPath: string, saveType: 'HTMLOnly' | 'HTMLComplete' | 'MHTML'): Promise<void>;
  takeHeapSnapshot(filePath: string): Promise<void>;
  sendInputEvent(e: any): void;
  invalidate(): void;
  blur(): void;
  focus(): void;
  enableDeviceEmulation(): void;
  disableDeviceEmulation(): void;
}

interface PrinterSync {
  description: string;
  displayName: string;
  isDefault: boolean;
  status: number;
  options?: {
    'printer-location'?: string;
    'printer-make-and-model'?: string;
    'system_driverinfo'?: string;
  };
}

type WebRTCIPHandlingPolicy =
  | 'default'
  | 'default_public_interface_only'
  | 'default_public_and_private_interfaces'
  | 'disable_non_proxied_udp';
```
- `Rectangle`, `Size`, `NativeImage`: see §8 (Screen).

### 5.2 sendToParent / window IPC

| Direction | Send | Receive |
| --- | --- | --- |
| parent -> custom window | `win.webContents.send(channel, ...args)` | custom-window preload `ipcRenderer.on(channel, (event, ...args) => {})` |
| custom window -> parent | `utools.sendToParent(channel, ...args)` | parent preload `ipcRenderer.on(channel, (event, ...args) => {})` |

- `sendToParent` targets the window that created the current window (main view or another custom window).
- Called from custom windows (documented usage: "自定义窗口调用"). Behavior when called from main: (unspecified).
- Listener receives Electron `IpcRendererEvent` as first arg, then the args.

---

## 6. Dynamic Features

```ts
function getFeatures(codes?: string[]): Feature[];
function setFeature(feature: Feature): void;
function removeFeature(code: string): boolean;

interface Feature {
  code: string;
  description?: string;
  icon?: string;                 // relative path (png/jpg/jpeg/svg/webp) OR Base64 Data URL
  platform?: Platform | Platform[];
  mainHide?: boolean;
  mainPush?: boolean;
  cmds: Array<string | Cmd>;
}

interface Cmd {
  type: "regex" | "over" | "img" | "files" | "window";
  label: string;
  match?: string | MatchWindow;  // regex: text regex; files: filename regex; window: window rule; over/img: ignored
  exclude?: string;              // over only, regex
  extensions?: string[];         // files only
  minLength?: number;            // regex/over: chars; files: file count
  maxLength?: number;            // regex/over: chars; files: file count
}
```
- Same data structure as plugin.json features. Note `Cmd.match` for window is typed `MatchWindow` in this
  doc, while plugin.json uses `{ app: string[]; title?: string }`; treat window rule as the plugin.json
  shape. `fileType` is not listed in the dynamic `Cmd` type (unspecified whether accepted).
- `getFeatures()` with no arg -> all DYNAMIC features (not plugin.json ones); with codes -> those.
- `setFeature`: upsert by `code`.
- `removeFeature`: `true` removed; `false` failed or not found.

---

## 7. Database (`utools.db`, `utools.db.promises`, `utools.dbStorage`)

```ts
interface DbDoc {
  _id: string;          // create if not exists, update if exists
  _rev?: string;        // required when updating existing doc
  [key: string]: unknown;
}

interface DbResult {
  id: string;
  rev?: string;         // latest revision
  ok?: boolean;
  error?: boolean;
  name?: string;        // error name
  message?: string;     // error message
}

type State = null | 0 | 1;

// utools.db (sync)
interface Db {
  put(doc: DbDoc): DbResult;
  get(id: string): DbDoc | null;
  remove(doc: DbDoc): DbResult;
  remove(id: string): DbResult;
  bulkDocs(docs: DbDoc[]): DbResult[];
  allDocs(idStartsWith?: string): DbDoc[];
  allDocs(ids: string[]): DbDoc[];
  postAttachment(id: string, attachment: Buffer | Uint8Array, type: string): DbResult;
  getAttachment(id: string): Uint8Array | null;
  getAttachmentType(id: string): string | null;
  replicateStateFromCloud(): State;
  promises: DbPromises;
}

// utools.db.promises (async)
interface DbPromises {
  put(doc: DbDoc): Promise<DbResult>;
  get(id: string): Promise<DbDoc | null>;
  remove(doc: DbDoc): Promise<DbResult>;
  remove(id: string): Promise<DbResult>;
  bulkDocs(docs: DbDoc[]): Promise<DbResult[]>;
  allDocs(idStartsWith?: string): Promise<DbDoc[]>;
  allDocs(ids: string[]): Promise<DbDoc[]>;
  postAttachment(id: string, attachment: Buffer | Uint8Array, type: string): Promise<DbResult>;
  getAttachment(id: string): Promise<Uint8Array | null>;
  getAttachmentType(id: string): Promise<string | null>;
  replicateStateFromCloud(): Promise<State>;
}

// utools.dbStorage (sync only)
interface DbStorage {
  setItem(key: string, value: any): void;
  getItem(key: string): any;          // null if absent
  removeItem(key: string): boolean;   // true removed, false failed
}
```

Semantics:
- Revision model (CouchDB/PouchDB-like `_id`/`_rev`): on success `result.ok === true` and `result.rev`
  is the new revision; caller must store it into `doc._rev` before the next `put`.
- Errors are RETURNED, not thrown: `{ id, error: true, name, message }`. Conflict (stale/missing `_rev`
  on existing doc): error result; exact `name`/`message` values (unspecified; PouchDB convention would be
  `name: "conflict"` — not stated in docs).
- `put`: single doc max **1 MB**. Over-limit behavior: (unspecified; presumably error result).
- `get`: `null` if not found.
- `remove(doc | id)`: returns DbResult; `result.ok` on success.
- `bulkDocs`: create/update/delete in batch; delete = include doc with `_deleted: true`. Returns one
  DbResult per doc (match by `id`).
- `allDocs()`: all docs of the plugin; `allDocs("prefix/")`: id prefix filter; `allDocs([ids])`: by ids.
  Order: (unspecified). Missing ids in array form: (unspecified).
- Data is per-plugin (namespace isolation implied by "插件应用所有文档").
- Attachments: create-only (cannot update); max **10 MB** each; `type` = MIME (e.g. `image/png`).
  `getAttachment` -> `Uint8Array | null`; `getAttachmentType` -> MIME `string | null`.
  Whether attachment ids share the doc id space: (unspecified).
- `replicateStateFromCloud()`: `null` = sync disabled; `0` = cloud pull complete (local has other devices'
  latest); `1` = pulling. Check `0` before consistency work (e.g. orphan-attachment cleanup).
- `onDbPull(docs)` fires when synced docs arrive (§4).
- `dbStorage`: localStorage-like KV built on the db; same storage + sync behavior. For prefs/small state;
  not for large/high-frequency/complex data. Underlying doc id scheme: (unspecified).

---

## 8. Screen

```ts
function captureDisplay(options?: CaptureDisplayOptions): Promise<DisplayCapture[]>;
function screenCapture(): Promise<string>;
function screenCapture(callback: (image: string) => void): void;
function screenColorPick(): Promise<PickColor>;
function screenColorPick(callback: (color: PickColor) => void): void;
function getAllDisplays(): Display[];
function getPrimaryDisplay(): Display;
function getCursorScreenPoint(): Point;
function getDisplayNearestPoint(point: Point): Display;
function getDisplayMatching(rect: Rectangle): Display;
function screenToDipPoint(point: Point): Point;
function dipToScreenPoint(point: Point): Point;
function screenToDipRect(rect: Rectangle): Rectangle;
function dipToScreenRect(rect: Rectangle): Rectangle;
function desktopCaptureSources(options?: DesktopCaptureSourcesOptions): Promise<DesktopCaptureSource[]>;

interface CaptureDisplayOptions { displayId?: number; }   // omitted -> all displays
interface DisplayCapture { display: Display; image: NativeImage; }   // image in physical pixels

interface Display {
  id: number;
  bounds: Rectangle;       // DIP
  workArea: Rectangle;     // DIP, excludes taskbar etc.
  workAreaSize: Size;      // DIP
  scaleFactor: number;     // e.g. 1.25
  rotation: number;        // 0/90/180/270
  label?: string;
}

interface Rectangle { x: number; y: number; width: number; height: number; }
interface Size { width: number; height: number; }
interface Point { x: number; y: number; }

interface NativeImage {
  getSize(): Size;
  toPNG(): Buffer;
  toJPEG(quality: number): Buffer;    // 0–100
  toDataURL(): string;
  crop(rect: Rectangle): NativeImage;
  resize(options: { width?: number; height?: number; quality?: "good" | "better" | "best" }): NativeImage;
  isEmpty(): boolean;
}

interface PickColor {
  hex: string;   // "#FFFFFF"
  rgb: string;   // "rgb(255, 255, 255)"
}

interface DesktopCaptureSourcesOptions {
  types?: Array<"window" | "screen">;
  thumbnailSize?: Size;
  fetchWindowIcons?: boolean;
}

interface DesktopCaptureSource {
  id: string;            // usable as chromeMediaSourceId with getUserMedia (chromeMediaSource: "desktop")
  type: "screen" | "window";
  name: string;
  thumbnail: NativeImage;
  appIcon?: NativeImage;
}
```
- Units: DIP for window positioning / `Display.bounds` / cursor point; physical pixels for capture images.
  physical ≈ DIP × scaleFactor (per display). Use the conversion APIs, don't compute manually.
- `screenCapture`: interactive region selection; resolves Base64 Data URL. Promise form rejects on cancel.
  Callback form on cancel: (unspecified; presumably not called).
- `screenColorPick`: interactive; Promise rejects on cancel.
- `getDisplayNearestPoint`: display containing point, else nearest.
- `getDisplayMatching`: display with largest overlap area.

---

## 9. System

```ts
function getPluginLocalDataPath(): string;
function getPluginTempPath(): string;
function showNotification(body: string, clickFeatureCode?: string): void;
function showOpenDialog(options: OpenDialogOptions): string[] | undefined;
function showSaveDialog(options: SaveDialogOptions): string | undefined;
function shellOpenPath(fullPath: string): Promise<string>;
function shellTrashItem(fullPath: string): Promise<void>;
function shellShowItemInFolder(fullPath: string): void;
function shellOpenExternal(url: string): Promise<void>;
function shellBeep(): void;
function getNativeId(): string;
function getAppVersion(): string;
function getUser(): UserInfo | null;
function getPath(name: string): string;
function getFileIcon(filePath: string): string;
function getFileIconAsync(filePath: string): Promise<string>;
function readCurrentFolderPath(): Promise<string>;
function readCurrentBrowserUrl(): Promise<string>;
function isDev(): boolean;
function isMacOS(): boolean;
function isWindows(): boolean;
function isLinux(): boolean;
function isDarkColors(): boolean;

interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;      // abs dir, abs file, or file name
  buttonLabel?: string;
  filters?: FileFilter[];
  properties?: string[];     // see below
  message?: string;          // macOS
}

interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  properties?: string[];     // see below
  message?: string;          // macOS
  nameFieldLabel?: string;   // macOS
  showsTagField?: boolean;   // macOS, default true
}

interface FileFilter { name: string; extensions: string[]; }

interface UserInfo {
  avatar: string;            // URL
  nickname: string;
  type: "member" | "user";   // member = uTools member
}
```
- Dialogs are SYNC (modal). Cancel -> `undefined`.
- OpenDialog `properties`: `openFile`, `openDirectory`, `multiSelections`, `showHiddenFiles` (mac/win),
  `createDirectory` (mac), `promptToCreate` (win), `noResolveAliases` (mac), `treatPackageAsDirectory` (mac),
  `dontAddToRecent` (win).
- SaveDialog `properties`: `showHiddenFiles` (mac/win), `createDirectory` (mac), `treatPackageAsDirectory`
  (mac), `dontAddToRecent` (win), `showOverwriteConfirmation` (linux).
- `getPluginLocalDataPath` / `getPluginTempPath`: per-plugin, auto-created. Temp cleared on plugin end or
  app exit. Local data survives uninstall.
- `showNotification(body, clickFeatureCode?)`: clicking enters plugin feature with that `code`; omitted ->
  click does nothing.
- `shellOpenPath`: resolves `""` on success, error-message string on failure (doesn't reject).
- `shellOpenExternal`: http/https and other system protocols (e.g. `mailto:`).
- `getNativeId`: hashed device id, distinct per plugin.
- `getUser`: `null` if not logged in.
- `getPath(name)`: `home`, `temp`, `desktop`, `documents`, `downloads`, `music`, `pictures`, `videos`.
- `getFileIcon(x)`: x = file path, extension (e.g. `.txt`), or `"folder"`; returns Base64 Data URL.
- `readCurrentFolderPath`: only when active window is system file manager; not supported on Linux.
  Failure behavior: (unspecified).
- `readCurrentBrowserUrl`: only when active window is a browser; not on Linux; tested Windows
  Chrome/Edge/Firefox, macOS Safari/Chrome/Edge.
- `isDev`: true when installed through the uTools developer tool as a dev project.
- `isDarkColors`: uTools theme dark; docs recommend `prefers-color-scheme` in UI (so host must keep the
  page's color-scheme in sync with app theme).

---

## 10. Copy (clipboard)

```ts
function copyText(text: string): boolean;
function copyFile(filePath: string | string[]): boolean;
function copyImage(image: string | Uint8Array): boolean;
function getCopiedFiles(): CopiedFile[] | null;

interface CopiedFile {
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  name: string;
}
```
- `copyFile`: writes file paths (files or folders) to clipboard; no copy is made.
- `copyImage`: file path, Data URL, or `Uint8Array`.
- `getCopiedFiles`: `null` when clipboard has no files.

---

## 11. Input (paste into external app)

```ts
function hideMainWindowPasteText(text: string): boolean;
function hideMainWindowPasteFile(filePath: string | string[]): boolean;
function hideMainWindowPasteImage(image: string | Uint8Array): boolean;
function hideMainWindowTypeString(text: string): boolean;
function startDrag(filePath: string | string[]): void;
```
- Flow: hide search-box main window -> return focus to the previously active external window -> perform
  paste/type. Return value = operation executed, not that target accepted it.
- `false` cases: empty text; file not found; invalid image; the calling window still has focus.
- Warning: from a detached plugin or custom window, these may fail because the calling window keeps focus.
- `hideMainWindowPasteImage`: image file path, Data URL, or `Uint8Array`.
- `hideMainWindowTypeString`: simulates keystrokes (not clipboard); supports emoji/Unicode. Linux:
  falls back to `hideMainWindowPasteText` behavior.
- `startDrag`: start native file drag (use in `dragstart` handler); single path or array; files/folders.

---

## 12. Simulate

```ts
function simulateKeyboardTap(key: string, ...modifiers: string[]): void;
function simulateMouseMove(x: number, y: number): void;
function simulateMouseClick(x: number, y: number): void;
function simulateMouseDoubleClick(x: number, y: number): void;
function simulateMouseRightClick(x: number, y: number): void;
```
- Keys like `"enter"`, `"v"`, `"a"`; modifiers `shift`, `ctrl`, `alt`, `command`. Full key-name list:
  (unspecified).
- Mouse coords are **physical pixels** from screen top-left. Click = left button.

---

## 13. Redirect / Hotkeys

```ts
function redirect(label: string | [string, string], payload?: string | MatchPayload): boolean;
function redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): void;
function getCmdHotKey(cmdLabel: string): string | null;

interface MatchPayload {
  type: "img" | "files";
  data: string | string[];   // img: Base64 Data URL; files: path or paths
}
```
- `redirect("label", payload?)`: search all installed plugins having that command: 1 match -> open;
  multiple -> user chooses; none -> open plugin market searching the label.
- `redirect([pluginName, label], payload?)`: open that plugin's command directly; not installed -> market,
  guide install, then open.
- Function command: no payload. Match command: payload must satisfy target's match rule. String payload
  = text (regex/over); `MatchPayload` for img/files. Target receives `from: "redirect"`.
- Return value meaning: (unspecified).
- `redirectHotKeySetting(cmdLabel, autocopy = false)`: opens uTools global-hotkey settings for that
  command; doesn't create/modify bindings itself. `autocopy: true` -> on hotkey, uTools copies current
  selection and matches it against the (match) command. Supported hotkeys include combos, single
  `F1`–`F12`, double-tap `Ctrl`/`Alt`/`Shift`.
- `getCmdHotKey(cmdLabel)`: e.g. `"Ctrl+Shift+A"`, `"F6"`; `null` if unset.

---

## 14. Schedule

```ts
function requestSchedule(schedule: Schedule): Promise<void>;
function getSchedules(): ScheduleInfo[];
function removeSchedule(code: string): void;

interface Schedule {
  code: string;                       // stable id, delivered to onScheduleTrigger
  label: string;                      // shown to user
  trigger: number | ScheduleTrigger;  // number = one-shot Unix ms timestamp
}

interface ScheduleTrigger {
  cron: string;        // standard 5-field cron only: minute hour day month weekday
  startTime?: number;  // Unix ms; no triggers before
  endTime?: number;    // Unix ms; no triggers after, then auto-deleted
}

interface ScheduleInfo {
  code: string;
  label: string;
  trigger: number | ScheduleTrigger;
  successCount: number;
  failureCount: number;
  lastExecuteAt?: number;             // Unix ms; absent if never run
  lastStatus?: 'success' | 'failure';
}
```
- `requestSchedule` asks the USER to approve; resolve = request flow finished, NOT that it was created.
  Rejection by user -> no task. Duplicate `code` behavior: (unspecified).
- One-shot: fires once at timestamp, then auto-deleted.
- Recurring: cron within optional [startTime, endTime]; auto-deleted after endTime.
- On fire: start plugin if not running, call `onScheduleTrigger({ code })`; success/failure by callback
  completion / throw / rejected Promise.
- `removeSchedule(code)`: **throws** if task doesn't exist.

---

## 15. Payment

```ts
function isPurchasedUser(): boolean | string;
function openPurchase(options: OpenPurchaseOptions, callback?: () => void): void;

interface OpenPurchaseOptions {
  goodsId: string;      // created in uTools developer tool
  outOrderId?: string;  // third-party order no., 6–64 chars
  attach?: string;      // ≤256 chars; echoed in order query API and payment notification
}
```
- Requires payment permission enabled for the developer.
- `isPurchasedUser`: `false` = not purchased / expired; `true` = permanent license; `string` = expiry
  `"yyyy-MM-dd HH:mm:ss"`.
- `openPurchase` callback: called after successful purchase only. Cancel/failure: no callback (implied).

---

## 16. AI

```ts
function registerTool(
  name: string,
  handler: (params: Record<string, any>, ctx?: ToolContext) => any | Promise<any>
): void;

// streaming
function ai(options: AiOptions, streamCallback: (chunk: Message) => void): AiPromise<void>;
// non-streaming
function ai(options: AiOptions): AiPromise<Message>;

function allAiModels(): Promise<AiModel[]>;

interface ToolContext {
  requestId: string | number;          // MCP request id
  sendProgress?: (options: {
    progress: number;
    total?: number;
    message?: string;
  }) => Promise<void>;
}

interface AiOptions {
  model?: string;       // AiModel.id; empty = default model
  messages: Message[];
  tools?: Tool[];
}

interface Message {
  role: "system" | "user" | "assistant";
  content?: string;
  reasoning_content?: string;   // some models
}

interface Tool {
  type: "function";
  function: {
    name: string;               // must equal a registerTool name
    description: string;
    parameters: JSONSchema;
  };
}

interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
}

interface AiPromise<T> extends Promise<T> {
  abort(): void;                // cancel in-flight call
}

interface AiModel {
  id: string;
  label: string;
  icon: string;                 // URL or Data URL
  cost?: number;                // AI "energy" per call
  vision?: boolean;             // supports image input
}
```

Notes:
- `registerTool`: registered tools serve BOTH (1) `utools.ai()` function calling (auto, by name match with
  `options.tools`) and (2) MCP tools for external agents (only if also declared in `plugin.json.tools`).
- `ctx` is provided only for MCP invocations; `undefined` for `ai()` function calls.
- Handler throw / rejection -> returned to the AI as a failed tool-call result (message should be clear).
- Return values should be JSON-serializable (recommend JSON object).
- `ai()` function-calling loop: model decides to call -> host runs registered handler -> result fed back ->
  model produces final reply. Loop is internal to `ai()`; tool-call messages are not exposed in `Message`
  type (intermediate shapes: (unspecified)).
- Streaming: `streamCallback(chunk: Message)` per chunk; whether chunks are deltas or cumulative:
  (unspecified). Promise resolves `void` when done. Non-streaming resolves the final assistant `Message`
  (`result.content`).
- `abort()` behavior on the promise (reject vs. resolve): (unspecified).
- Vision: docs example passes `content` as an OpenAI-style array
  `[{ type: "text", text }, { type: "image_url", image_url: { url: "data:image/png;base64,..." } }]`
  even though `Message.content` is typed `string` — host should accept both.
- Users may configure models in uTools settings; default models need no user setup.

---

## 17. MCP

- uTools hosts a local MCP server; user enables it in Settings -> AI Settings -> MCP Service.
- Tools exposed = union of installed plugins' `plugin.json.tools` (name, description, inputSchema,
  outputSchema). Declarations read at install time.
- Invocation flow: agent calls tool -> if plugin not running, uTools starts it and initializes the tool
  execution environment -> plugin's init code calls `registerTool()` -> uTools calls handler
  `(params, ctx)` with `ctx = { requestId, sendProgress? }` -> result returned to agent.
- Host must therefore: load plugin (preload + presumably page) headlessly or in background, wait for
  `registerTool(name)` before dispatching. Exact readiness signal / timeout: (unspecified). Whether the
  main page or only preload is loaded for MCP: (unspecified).
- `sendProgress` maps to MCP progress notifications (progress/total/message) for long tasks.
- Local only; multiple plugins at once; standard MCP clients.
- MCP transport / address / port: (unspecified).

---

## 18. Sharp

```ts
function sharp(
  input?: Buffer | Uint8Array | Uint8ClampedArray | ArrayBuffer | string | Object | Array,
  options?: SharpOptions
): Sharp;

interface SharpOptions {
  raw?: SharpRaw;
  create?: SharpCreate;
  limitInputPixels?: number;
  limitInputChannels?: number;
  failOn?: 'none' | 'truncated' | 'error' | 'warning';
  animated?: boolean;
  density?: number;
  join?: SharpJoin;
}

interface SharpColor { r: number; g: number; b: number; alpha: number; }

interface SharpRaw {
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  premultiplied?: boolean;
  pageHeight?: number;
}

interface SharpCreate {
  width: number;
  height: number;
  channels: 3 | 4;
  background?: string | SharpColor;
}

interface SharpJoin {
  across?: number;
  animated?: boolean;
  shim?: number;
  background?: string | SharpColor;
}
```
- Bundled **Sharp v0.35.3**; API identical to upstream sharp (constructor, input, output, resize, composite,
  operations, colour, channel, utility). `utools.sharp(...)` ≈ `require('sharp')(...)`.
- Input `string` = local file path; `Object` = special inputs e.g. `{ text: {...} }` or `{ create: {...} }`
  (examples also use `create.noise`); `Array` = multiple inputs for joining (`options.join`).
- Commonly used: `resize rotate flip flop extract extend trim grayscale negate blur sharpen threshold
  normalize gamma median tint flatten composite jpeg png webp tiff toBuffer toFile toUint8Array metadata clone`.
- Note: `toUint8Array()` is listed as an output method (newer sharp API).

---

## 19. FFmpeg

```ts
function runFFmpeg(args: string[], onProgress?: (progress: RunFFmpegProgress) => void): FFmpegProcess;
function runFFmpeg(args: string[], options?: RunFFmpegOptions): FFmpegProcess;

interface FFmpegProcess extends Promise<void> {
  kill(): void;   // force terminate
  quit(): void;   // request graceful exit
}

interface RunFFmpegOptions {
  onProgress?: (progress: RunFFmpegProgress) => void;
  onLog?: (text: string) => void;
}

interface RunFFmpegProgress {
  bitrate: string;      // "1926 kb/s"
  fps: number;
  frame: number;
  percent?: number;     // only if total duration known
  q: number | string;
  size: string;         // "1.2 MiB"
  speed: string;        // "1.5x"
  time: string;         // "00:01:23.45"
}
```
- Provided as a separately installed extension: on first call, if not installed, uTools guides the user to
  download/install. **FFmpeg v8.1.2**, `ffmpeg` only (no `ffprobe`, no `ffplay`).
- `args` excludes the `ffmpeg` binary name. Second arg overloaded: function = onProgress; object = options.
- Promise rejects with an `Error` (`error.message`) on failure. Behavior of the promise after `kill()`/
  `quit()`: (unspecified).

---

## 20. uBrowser (`utools.ubrowser`)

Model:
- Programmable **visible** browser window (user can watch/interact). Sessions isolated per plugin;
  persistent session storage (cookies survive across runs -> logins persist).
- Chain API: each action call enqueues and returns `UBrowser`; nothing runs until `run()`. Actions execute
  in call order. Whether `utools.ubrowser` returns a fresh queue per chain: (unspecified; usage implies each
  chain starting from `utools.ubrowser` is independent).
- Selector syntax: CSS selector, or XPath (string starting with `//` in examples), iframe traversal with
  `>>` (e.g. `'#iframe1 >> #iframe2 >> #submit'`, `'#iframe1 >> //button[...]'`).

```ts
interface UBrowser {
  // --- execution ---
  run(options?: UBrowserWindowOptions): Promise<[...any[], UBrowserWindowInstance | null]>;
  run(uBrowserWindowId: number): Promise<[...any[], UBrowserWindowInstance | null]>;

  // --- navigation / environment ---
  goto(url: string, headers?: Record<string, string>, timeout?: number): UBrowser;
  userAgent(ua: string): UBrowser;
  viewport(width: number, height: number): UBrowser;
  device(options: DeviceOptions): UBrowser;

  // --- mouse ---
  click(selector: string, mouseButton?: MouseButton): UBrowser;
  click(x: number, y: number, mouseButton?: MouseButton): UBrowser;
  dblclick(selector: string, mouseButton?: MouseButton): UBrowser;
  dblclick(x: number, y: number, mouseButton?: MouseButton): UBrowser;
  mousedown(selector: string, mouseButton?: MouseButton): UBrowser;
  mousedown(x: number, y: number, mouseButton?: MouseButton): UBrowser;
  mouseup(selector: string, mouseButton?: MouseButton): UBrowser;
  mouseup(x: number, y: number, mouseButton?: MouseButton): UBrowser;
  hover(selector: string): UBrowser;
  hover(x: number, y: number): UBrowser;

  // --- keyboard / form ---
  press(key: string, ...modifiers: string[]): UBrowser;
  focus(selector: string): UBrowser;
  input(selector: string, payload: string): UBrowser;
  input(payload: string): UBrowser;
  value(selector: string, payload: string): UBrowser;
  check(selector: string, checked: boolean): UBrowser;
  scroll(selector: string, options?: ScrollIntoViewOptions): UBrowser;
  scroll(x: number, y: number): UBrowser;
  scroll(y: number): UBrowser;

  // --- files / clipboard / download ---
  file(selector: string, payload: string | Uint8Array | string[]): UBrowser;
  drop(selector: string, payload: string | Uint8Array | string[]): UBrowser;
  drop(x: number, y: number, payload: string | Uint8Array | string[]): UBrowser;
  paste(payload: string): UBrowser;
  download(url: string, savePath?: string): UBrowser;
  download(func: (...args: any[]) => string, savePath: string | null, ...funcArgs: any[]): UBrowser;

  // --- page scripting ---
  evaluate(func: (...args: any[]) => any, ...funcArgs: any[]): UBrowser;
  css(css: string): UBrowser;

  // --- waiting / control flow ---
  wait(ms: number): UBrowser;
  wait(selector: string, timeout?: number): UBrowser;
  wait(selector: string, result?: boolean): UBrowser;
  wait(selector: string, options?: { result?: boolean; timeout?: number; interval?: number }): UBrowser;
  wait(func: (...args: any[]) => boolean, timeout?: number, ...funcArgs: any[]): UBrowser;
  wait(func: (...args: any[]) => boolean, options?: { timeout?: number; interval?: number }, ...funcArgs: any[]): UBrowser;
  when(selector: string, result?: boolean): UBrowser;
  when(func: (...args: any[]) => boolean, ...funcArgs: any[]): UBrowser;
  endWhen(): UBrowser;

  // --- extraction / output ---
  markdown(selector?: string): UBrowser;
  screenshot(target?: string | ScreenshotRect, savePath?: string): UBrowser;
  pdf(options: PdfOptions, savePath?: string): UBrowser;

  // --- cookies ---
  cookies(name?: string): UBrowser;
  cookies(filter: CookieFilter): UBrowser;
  setCookies(name: string, value: string): UBrowser;
  setCookies(cookies: CookieDetails[]): UBrowser;
  removeCookies(name: string): UBrowser;
  clearCookies(url?: string): UBrowser;

  // --- window ---
  show(): UBrowser;
  hide(): UBrowser;
  devTools(mode?: 'right' | 'bottom' | 'undocked' | 'detach'): UBrowser;
}

// top-level helpers on utools
function getIdleUBrowsers(): UBrowserWindowInstance[];
function setUBrowserProxy(config: ProxyConfig): void;
function clearUBrowserCache(): void;

type MouseButton = "left" | "middle" | "right";

interface DeviceOptions {
  userAgent?: string;
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
  };
}

interface UBrowserWindowOptions {
  show?: boolean;                  // default true
  title?: string;
  width?: number;                  // default 800
  height?: number;                 // default 600
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  x?: number;
  y?: number;
  center?: boolean;                // default false
  resizable?: boolean;             // default true
  movable?: boolean;               // default true
  maximizable?: boolean;           // default true
  minimizable?: boolean;           // default true
  closable?: boolean;              // default true
  frame?: boolean;                 // default true
  hasShadow?: boolean;             // default true
  roundedCorners?: boolean;        // default true
  alwaysOnTop?: boolean;           // default false
  focusable?: boolean;             // default true
  enableLargerThanScreen?: boolean;// default false
  fullscreenable?: boolean;        // default true
  fullscreen?: boolean;            // default false
  opacity?: number;                // 0.0–1.0, default 1.0
  backgroundColor?: string;
  transparent?: boolean;           // default false
  titleBarStyle?: string;
}

interface UBrowserWindowInstance {
  id: number;      // pass to run(id) to reuse
  url: string;
  title: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface ScreenshotRect { x: number; y: number; width: number; height: number; } // origin = content top-left

interface PdfOptions {
  landscape?: boolean;             // default false
  displayHeaderFooter?: boolean;   // default false
  printBackground?: boolean;       // default false
  scale?: number;
  pageSize?: string | PdfPageSize; // default 'Letter'; A0–A6, Legal, Letter, Tabloid, Ledger
  margins?: PrintToPDFMargins;     // inches
  pageRanges?: string;
  headerTemplate?: string;
  footerTemplate?: string;
  preferCSSPageSize?: boolean;
}
interface PdfPageSize { width: number; height: number; }          // inches
interface PrintToPDFMargins { top: number; bottom: number; left: number; right: number; } // inches, default 1cm (~0.4in) each

interface CookieFilter {
  url?: string;        // empty = all URLs
  name?: string;
  domain?: string;     // domain or subdomains
  path?: string;
  secure?: boolean;
  session?: boolean;
  httpOnly?: boolean;
}

interface CookieDetails {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';  // default 'lax'
}

interface ProxyConfig {
  mode?: string;
  pacScript?: string;
  proxyRules?: string;        // e.g. 'http://127.0.0.1:7890'
  proxyBypassRules?: string;
}
```

`run()` semantics:
- `run(options?)`: create a new window (default options if none). `run(id)`: execute in existing window.
- Resolves an array: one element per **value-producing** action, in call order, then the last element is
  the `UBrowserWindowInstance` (or `null` if the window was destroyed).
  - Example: `.goto().evaluate(a).evaluate(b).run()` -> `[a, b, browser]`; `.goto().run()` -> `[browser]`.
    So actions like `goto`/`click` contribute no element. Which actions produce values (documented by
    example): `evaluate`, `markdown`, `cookies`. `screenshot`/`pdf`/`download` return values: (unspecified;
    screenshot saves to temp dir when no savePath, so likely returns the path).
- On error: Promise rejects; `error.message` set; `error.data` has the same shape as the resolve value but
  only for actions completed before the error, plus the final `UBrowserWindowInstance` (`err.data.at(-1)`).
- After `run()` completes, if the window is hidden it is **auto-destroyed**.
- `run({ show })` controls initial visibility; `.show()`/`.hide()` are queued window ops. Hidden windows
  still execute actions.

Action notes:
- `goto(url, headers?, timeout?)`: timeout ms for page load. Default timeout: (unspecified).
- `viewport`: content viewport size, not window size.
- `click(selector)` (no button): dispatches DOM click event, no real mouse. `click(selector, button)`:
  physical click — locate element, move mouse there, press+release. Requires element locatable and in
  viewport; hidden / unscrollable-into-view -> throws. Same rule for `dblclick`, `mousedown`, `mouseup`.
  Coordinate overloads `(x, y, button?)` = physical mouse at page coords.
- `press(key, ...modifiers)`: modifiers `ctrl`, `alt`, `shift`, `meta`.
- `input([selector,] payload)`: simulates user typing; no selector -> currently focused element.
- `value(selector, payload)`: directly sets value; only form elements (`input`, `textarea`, `select`).
- `check(selector, checked)`: checkbox/radio.
- `scroll(selector, ScrollIntoViewOptions?)` (`behavior` smooth|auto|instant, `block`/`inline`
  start|center|end|nearest); `scroll(x, y)`; `scroll(y)` vertical.
- `file` / `drop` payload: image Base64 Data URL, file `Uint8Array`, file path, or path array.
- `paste(payload)`: Data URL image -> pastes image; otherwise pastes text.
- `download(url, savePath?)` or `download(func, savePath|null, ...args)` where `func` runs in page and returns
  the URL. Default save location when omitted: (unspecified).
- `evaluate(func, ...args)`: runs in page context; args must be serializable (implied); return value
  appended to results.
- `css(css)`: inject CSS into page.
- `wait`: `wait(ms)`; `wait(selector)` appear; `wait(selector, false)` disappear; `wait(selector, timeoutMs)`;
  `wait(selector, {result, timeout, interval})`; `wait(func, timeout?|{timeout, interval}, ...args)` until
  page fn returns true. Defaults: `result` true, `timeout` 60000 ms, `interval` 500 ms. Timeout -> error
  (run rejects; example uses `.wait('.no-existed-element', 1000)` in try/catch).
  Overload disambiguation: 2nd arg number -> timeout; boolean -> result; object -> options.
- `when(selector, result=true)` / `when(func, ...args)` ... `endWhen()`: conditional block evaluated at
  execution time; must be paired; nestable; ops after `endWhen()` always run.
- `markdown(selector?)`: page (or element) content as Markdown string.
- `screenshot(target?, savePath?)`: PNG; target selector | rect | none (whole page window); default save
  in temp dir.
- `pdf(options, savePath?)`.
- `cookies(name?)`: current URL cookies (all if no name); `cookies(filter)`. Returns cookie array
  (shape per Electron `Cookie`, (unspecified)).
- `setCookies(name, value)` for current URL; `setCookies(CookieDetails[])` batch (may precede `goto`).
- `removeCookies(name)`: current URL, by name. `clearCookies(url?)`: given URL or current URL.
- `devTools(mode?)`: `right` | `bottom` | `undocked` | `detach`.
- `getIdleUBrowsers()`: windows not currently executing a queue; reusable via `run(id)`.
- `setUBrowserProxy(config)`: applies to all uBrowsers of the plugin (Electron `ProxyConfig` shape).
- `clearUBrowserCache()`: clears uBrowser cache data.

---

## 21. Full `window.utools` member index

```ts
interface UTools {
  // events (§4)
  onPluginReady; onPluginEnter; onPluginOut; onScheduleTrigger; onMainPush; onPluginDetach; onDbPull;
  // window (§5)
  createBrowserWindow; sendToParent; getWindowType; hideMainWindow; showMainWindow; setExpandHeight;
  setSubInput; removeSubInput; setSubInputValue; subInputFocus; subInputBlur; subInputSelect;
  findInPage; stopFindInPage; outPlugin;
  // dynamic features (§6)
  getFeatures; setFeature; removeFeature;
  // db (§7)
  db;          // incl. db.promises
  dbStorage;
  // screen (§8)
  captureDisplay; screenCapture; screenColorPick; getAllDisplays; getPrimaryDisplay;
  getCursorScreenPoint; getDisplayNearestPoint; getDisplayMatching;
  screenToDipPoint; dipToScreenPoint; screenToDipRect; dipToScreenRect; desktopCaptureSources;
  // system (§9)
  getPluginLocalDataPath; getPluginTempPath; showNotification; showOpenDialog; showSaveDialog;
  shellOpenPath; shellTrashItem; shellShowItemInFolder; shellOpenExternal; shellBeep;
  getNativeId; getAppVersion; getUser; getPath; getFileIcon; getFileIconAsync;
  readCurrentFolderPath; readCurrentBrowserUrl; isDev; isMacOS; isWindows; isLinux; isDarkColors;
  // copy (§10)
  copyText; copyFile; copyImage; getCopiedFiles;
  // input (§11)
  hideMainWindowPasteText; hideMainWindowPasteFile; hideMainWindowPasteImage; hideMainWindowTypeString;
  startDrag;
  // simulate (§12)
  simulateKeyboardTap; simulateMouseMove; simulateMouseClick; simulateMouseDoubleClick;
  simulateMouseRightClick;
  // redirect (§13)
  redirect; redirectHotKeySetting; getCmdHotKey;
  // schedule (§14)
  requestSchedule; getSchedules; removeSchedule;
  // payment (§15)
  isPurchasedUser; openPurchase;
  // AI (§16)
  registerTool; ai; allAiModels;
  // media (§18–19)
  sharp; runFFmpeg;
  // uBrowser (§20)
  ubrowser; getIdleUBrowsers; setUBrowserProxy; clearUBrowserCache;
}
```

### Window-type restriction summary (documented)

| API | Restriction / failure |
| --- | --- |
| `hideMainWindow`, `showMainWindow`, `setExpandHeight` | `false` unless caller is search-box main window |
| `setSubInput`, `removeSubInput`, `setSubInputValue`, `subInputFocus`, `subInputSelect` | `false` from custom window |
| `subInputBlur` | returns void; restriction (unspecified) |
| `hideMainWindowPaste*`, `hideMainWindowTypeString` | may fail (`false`) from detached/custom window (caller keeps focus) |
| `sendToParent` | intended for custom windows |
| everything else | (unspecified) |

### Documented error behavior summary

| API | On failure |
| --- | --- |
| `db.*` / `db.promises.*` writes | return `DbResult` with `error: true, name, message` (no throw documented) |
| `db.get`, `getAttachment`, `getAttachmentType`, `dbStorage.getItem` | `null` when missing |
| `removeSchedule` | throws if code not found |
| `screenCapture()`, `screenColorPick()` (Promise form) | reject on user cancel |
| `shellOpenPath` | resolves error string (empty string = success) |
| `showOpenDialog` / `showSaveDialog` | `undefined` on cancel |
| `ubrowser.run` | rejects; `error.data` = partial results + window instance |
| `runFFmpeg` | rejects with Error |
| tool handler | thrown error returned to AI/agent as failed tool result |
| `onScheduleTrigger` callback | throw/reject recorded as `failure` |
