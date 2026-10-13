# WhateverTools 跨平台缺口审计（只读，未修改任何文件）

**注意：审计期间代码在被并发修改。** 15:05 新增了 `packages/core/src/panel.ts`（`PanelAdapter` + `panel:<op>` hook），`host.ts`、`shell.ts`、`windows.ts` 也改成经 `host.panel()` 调用。下面的行号以约 15:05 的快照为准，其中 `host.ts` 当时为 673 行。

**每条格式：** 现状(file:line) → 建议的 adapter / hook → 要实现的平台（E=electron，W=web，T=tauri）→ 优先级

## A. 宿主编排（总体架构）
- **A1** `WhateverToolsHost` 的编排逻辑全在 electron 包里：插件表、start/enter/out、request/reply、permit、dispatch（`electron/src/main/host.ts:77-610`）。web 在 `web/src/index.ts:53-148` 另写了一套子集。→ 在 core 建 `PluginHost` 引擎，加 `HostTransport` 适配器（emit/request/stream 到插件视图），hook 用 `plugin:*`。E/W/T。**P0**
- **A2** 宿主推给插件的事件，在宿主侧拦不到。`host.emit`（host.ts:403）直接 `wc.send`。只有 `event:pluginEnter`（host.ts:~357）走了 hook，dbPull / pluginOut / pluginDetach / subInputChange 都绕过了。→ 所有宿主推送统一走 `event:<name>`。E/W/T。**P0**
- **A3** `PanelAdapter` 已进 core，但 `View/Prefs` 是 `unknown`。Electron 的 `webPreferences()` 仍是唯一的视图配置（host.ts:240-250），web 和 tauri 没有面板实现。→ 定义平台无关的 `ViewSpec`（url、preload、isolation、partition、zoom、throttling）。W/T。**P0**
- **A4** 超时全部写死：mainPush 300ms（shell.ts:149）、定时任务 10 分钟（schedule.ts:159）、工具 10 分钟（mcp.ts:134）、等工具注册 15s（mcp.ts:131）。→ 加 `HostOptions.timeouts`。**P2**
- **A5** `dispatch` 遇到窗口类型不符时静默返回 false，且没有 hook（host.ts:524）。另外 `window.hideMain` / `showMain` 允许 detach 窗口调用（apis.ts:46-47），旧文档 §5 说只有主窗口能调。**P2**
- **A6** hooks.ts:1-12 的命名空间说明过时：列了没用到的 `launcher:match`，却漏了 `entry:`、`source:`、`provider:`、`panel:`、`window:` 和兼容层自己的前缀。**P2**

## B. 生命周期
- **B1** 就绪握手写死 15s，没有 hook，也不往外报（host.ts:339）。→ `lifecycle:start`。**P1**
- **B2** 缺后台自动退出：旧平台在主窗隐藏后默认 3 分钟退出插件（legacy-api §0），这里没有。→ core `LifecycleManager` 的 idle 策略 + `lifecycle:idle`。E/W/T。**P1**
- **B3** kill 路径用写死的 50ms + `BrowserWindow.fromWebContents`（host.ts:366-381）。→ `lifecycle:kill` + `PanelAdapter.destroyView`。**P1**
- **B4** 插件主视图和自定义窗口都没处理崩溃（`render-process-gone`）和卡死（`unresponsive`），只有截图窗口处理了（capture.ts:47）。崩溃后不通知、不重启。→ `onViewGone` + `lifecycle:crash`。E/W/T。**P1**
- **B5** `pluginSetting.single` 解析了（manifest.ts:168）但没人用，始终复用同一个 mainWc（host.ts:311）。→ 实例策略 + `lifecycle:instance`。**P1**
- **B6** `requestSingleInstanceLock` 之后，second-instance 只是切换面板，argv 被丢掉（app.ts:32,65）。→ `AppInstanceAdapter` + `app:second-instance`。E/T。**P1**
- **B7** 退出流程靠全局变量 `__whatevertoolsQuitting`（app.ts:37、shell.ts:91）和 `before-quit` 里的 flushSync（host.ts:132），web 没有对应的落盘。→ `AppLifecycleAdapter` + `app:quit`。**P1**
- **B8** 临时目录只在 wc 销毁时清理（plugin.ts:109）。web 的 `/temp` 持久化进 IndexedDB 后永远不清，旧文档要求“进程结束或应用退出时清空”。**P2**
- **B9** 定时任务触发时在后台启动插件，没有生命周期 hook；宿主没运行时也无法唤醒（schedule.ts:152-173）。**P2**

## C. 窗口管理
- **C1** core 的 `WindowCapability.createSync` 直接收 Electron 的构造参数（capabilities.ts:154）。窗口方法白名单就是 Electron 的 API 名（apis.ts:229-254，`WINDOW_METHODS` / `WEBCONTENTS_METHODS`），tauri 只能去模拟 Electron。→ core 定义中立的 `WindowAdapter`（尺寸、frame、透明、置顶级别、skipTaskbar 等），Electron 方法名映射放到兼容层。T/W。**P0**
- **C2** 宿主侧建窗策略只在 electron（windows.ts:9-66：`OPTION_KEYS` 过滤、preload 路径校验、`window:create` hook）。web 用 `window.open`（web caps.ts:199-262），不经过 `window:create`。→ 建窗策略收进 core。**P0**
- **C3** 覆盖层判定 `isOverlay` / `coversDisplay` 只在 electron，依赖 Electron 的 screen（windows.ts:17-27）。core 只有 `windowCallNeedsOverlay`（apis.ts:263）。→ core 提供 `classifyWindowOptions`。W/T。**P1**
- **C4** `window:<method>` 和 `window:webContents.<method>` 这两类 hook 只有 electron 有（windows.ts:86），web 的窗口方法调用拦不到。**P1**
- **C5** 分离窗口：参数写死（shell.ts:458）；分离后子输入框丢了（`top` 算出来又被 void 掉，465 行）；`reattach` 在接口里声明了但没实现；只能用 Cmd/Ctrl+D 触发（shell.html:153）；web 没有分离。→ 实现 `PanelAdapter.detach/reattach`，加 `panel:detach.options` hook。**P1**
- **C6** 主面板几何参数写死：宽 800、头部 56、列表最高 600、距顶 20%（shell.ts:42-43,121,308）。launcher 默认置顶且不进任务栏（shell.ts:79-80）。→ `PanelOptions` + `panel:position`。**P2**
- **C7** `hideMain(focusPrev)` 的焦点归还只在 macOS 上用 `app.hide()` 实现（input.ts:42），shell 的 hide 忽略这个参数。测试开关 `WHATEVERTOOLS_HEADLESS` 散在 shell.ts:85,218,300。→ `FocusAdapter.restorePrevious`。E/T。**P1**
- **C8** findInPage 只有 electron，web 和 tauri 没有。**P2**

## D. 主题 / 语言 / 缩放
- **D1** `themeChange` 只在 `PlatformEvent` 里声明（capabilities.ts:325），从来没发出过。electron 和 web 都没实现 `SystemCapability.onThemeChange`（capabilities.ts:291），`WhateverToolsApi` 也没有 `onThemeChange`。→ 加 `ThemeAdapter`（isDark / onChange / setSource）：electron 用 `nativeTheme` 的 updated 事件，web 用 matchMedia。hook 用 `theme:change`，并补上 API 和兼容映射。E/W/T。**P0**
- **D2** 宿主没有主题设置，从不设 `nativeTheme.themeSource`，插件页的 prefers-color-scheme 无法跟随宿主手动选的主题。web iframe 需要注入 color-scheme 才行。→ `theme:source`。**P1**
- **D3** 界面文字全部写死中文：权限标题（permissions.ts:22-56）、默认权限弹窗（host.ts:649+）、托盘菜单（app.ts:106,113）、shell 和 settings 页面、错误信息。没有 locale 接口。→ `LocaleAdapter` + 文案表 + `i18n:` hook。**P1**
- **D4** 缩放：没有按插件保存缩放比例，也没有快捷键。自定义窗口只透传 zoomFactor（windows.ts:49），shim 用 CSS zoom 模拟（shim-electron:111）。→ `view:zoom`。**P2**

## E. 开发者支持 / 诊断
- **E1** 开发模式只有 `devPlugins` 加 `development.main`（host.ts:36），没有监听文件、热重载或自动重启。web 的 isDev 写死 false（web index.ts:107）。→ `DevAdapter` + `dev:reload`。**P1**
- **E2** 没有给插件主视图开 DevTools 的入口或快捷键。→ `PanelAdapter.openDevTools`。E/T。**P1**
- **E3** 日志只有 electron 的 `HostOptions.log`（host.ts:196）。不收集渲染进程的 console 和插件报错，web 没有日志。→ core `LogSink` + `log:<level>`。**P1**
- **E4** 运行时看不到每个插件的能力支持情况，CLI 只有静态扫描（cli/report.ts）。**P2**

## F. 插件管理
- **F1** 插件只能用 Node fs 从目录加载（host.ts:207-228），web 只能通过配置把 JSON 传进来。→ `PluginLoader` + `PluginSource`（目录 / 压缩包 / URL / 商店）+ `plugin:load` hook。E/W/T。**P0**
- **F2** 没有卸载、启用、禁用、更新、重载。`scheduler.load` 和 `mcp.refresh` 没有对应的反向操作，卸载时的数据保留策略（旧文档 §3）也没做。→ `PluginManager` + `plugin:install|uninstall|enable|disable|update`。**P1**
- **F3** uTools plugin.json 的解析放在 core（manifest.ts:113-175），包括 pluginSetting、mainPush/mainHide、development、`main` 必须是 .html 等。uTools 自己的校验规则（每个功能最多 5 条指令、指令名字符限制，legacy §1）哪里都没做。→ core 只保留中立的 manifest；在 core 建 `ManifestLoader` 注册表，由 compat-utools 提供 plugin.json 的加载和校验；hook 用 `manifest:parse`。**P0**
- **F4** 插件 id 由目录名或 package.json 推出来（manifest.ts:156-158），可能撞名，也没有签名或完整性校验。**P2**
- **F5** `engines` 只检查 whatevertools 版本，插件无法声明“需要某项能力”，所以没法在 web 上拒绝装不能跑的插件。**P2**

## G. 搜索 / 入口 / 唤起
- **G1** 不支持拼音和首字母搜索。`scoreText` 只处理 ASCII（entries.ts:171），`textScorer` 只能通过 electron 的 HostOptions 传入（host.ts:63,111），没有默认实现。→ compat-utools 注册一个默认拼音打分器，加 `entry:score`。E/W/T。**P1**
- **G2** 排序固定（entries.ts:154），没有按使用频率学习，也没有 `entry:rank` hook。**P1**
- **G3** web 完全没有 EntryRegistry 和 SourceRegistry，直接进入 startFeature，from 写成 'web'（web index.ts:142）。所以 web 上 regex、files、img 类型的入口都用不了，也做不了 web 启动器。**P1**
- **G4** mainPush 的编排在 shell 里：最多 300ms、最多 10 条（shell.ts:141-156）。→ 移到 core，面板只负责渲染。**P1**
- **G5** 前台窗口检测只有 AppleScript（shell.ts:14-41）。而且直接调 `providers.context.activeWindow`，传的 pluginId 是空的，绕过了 callProvider，所以 `provider:context.activeWindow` 这个 hook 不生效。Windows/Linux 没有实现。**P1**
- **G6** 往主输入框拖放和粘贴只在 electron 实现（shell.html:129-152；shell.ts:103 用了 `fs.statSync`），web 没有。**P1**
- **G7** `readSelection` 用模拟复制加还原剪贴板实现，但只还原文字和图片，原来剪贴板里的文件、HTML、RTF 会丢（source-platform.ts:43-57），也没有 hook。**P1**
- **G8** 通知点击直接调 `host.enter`，from 写成 'main'、type 写成 'text'（system.ts:35-45），绕过了 SourceRegistry 和 `source:enter`。web 忽略 `clickFeatureCode`（web caps.ts:179）。→ 注册 `notification` 来源 + `NotificationAdapter.onClick`。**P1**
- **G9** 深链 / URL scheme：`EmitMeta` 注释里提到 'url'（entries.ts:60），但没有注册协议，也没有处理 open-url。→ `DeepLinkAdapter` + `url` 来源。E/T/W。**P1**
- **G10** 托盘写死在 app.ts:99-118（Electron 的 Tray 和 Menu，中文菜单）。注册了 `tray` 来源但 setup 是空的（app.ts:75），菜单拦不到。→ `TrayAdapter` + `tray:menu`。E/T。**P1**
- **G11** 指令快捷键表 `Hotkeys` 只在 electron，用 fs 存储（data.ts:104-131）。web 没有快捷键，冲突也不会反馈到 UI。→ 移到 core，存储走 HostStore，加 `shortcut:register`。**P1**
- **G12** launch.open 的候选查找逻辑在 electron 的 data.ts:53-93。web 没有 `redirectSync`，规格表却写 web 是 partial（apis.ts:140）。→ core 提供 redirect 解析。**P1**
- **G13** 功能自己的 `Feature.icon` 和 `explain` 没用上，搜索结果只显示插件 logo（shell.ts:166,260）。**P2**
- **G14** 超级面板用 Alt+Shift+P 快捷键代替长按右键（compat sources.ts:9）。→ 加可选的全局鼠标 provider。**P2**
- **G15** 没有剪贴板监听。→ `ClipboardWatchAdapter` + `clipboard:change`。**P2**
- **G16** 没有文件关联和“用…打开”（open-file / argv 里的文件）。**P2**

## H. 权限（目标 3）
- **H1** 权限编排只在 electron：permit、同一权限同时只问一次、“仅本次 + 作用域”的处理、`scopeRoot`（用了 fs.statSync）、saveGrants、pushGrants（host.ts:432-503,626）。web 用 `confirm()` 重写了一套，只有“始终允许”和“关掉”两种结果（web caps.ts:142-150）。→ core `PermissionManager` + `PermissionPrompter` 适配器 + `GrantStore`。hook：`permission:check`（改结论）、`permission:prompt`（自定义界面）、`permission:change`。E/W/T。**P0**
- **H2** core 的 `scopeMatches` 用了 Node 的 `process.platform`（permissions.ts:124-125）。浏览器（依赖 shim 的初始化顺序）和 tauri 上会出问题。→ 平台通过构造参数传入。**P0**
- **H3** 同步弹窗询问依赖阻塞式 IPC：electron 用 sendSync 等待 main 的对话框（caps.ts:58），web 用 `confirm()`，tauri 没有同步 IPC。→ 设计上改成异步优先：先 `permissions.request()` 预授权，或在安装 / 进入时就授予声明过的权限。tauri 上 `checkSync` 不能弹窗。**P0**
- **H4** 授权的持久化：electron 存 permissions.json（host.ts:102,481），web 存 localStorage（web index.ts:73）。→ 统一的 `GrantStore` 适配器（见 I1）。**P0**
- **H5** 插件页发起的浏览器权限请求（摄像头、麦克风、定位、通知、读剪贴板、HID、串口）没有设 `session.setPermissionRequestHandler`，Electron 默认全部放行，也没映射到 whatevertools 权限。→ `SecurityAdapter.onWebPermissionRequest` + `permission:web.*`，并新增 media.camera / media.microphone / geolocation 等权限 id。E/T。**P0（安全）**
- **H6** guard.ts:7 自己写明不是安全边界。guard.ts:8 提到的 strict 模式没实现，所有插件都是 `contextIsolation:false`、`sandbox:false`（host.ts:244-246）。→ 按插件设 `IsolationPolicy`；strict 模式复用 web 的 shim。**P1**
- **H7** 通过 launch.open 传过来的文件路径没有临时授权（data.ts:80-86）。**P2**
- **H8** 设置页改权限时不支持按作用域撤销，`whatevertools-settings:set` 不传 scopes（shell.ts:513）。**P2**
- **H9** web 的 fs.read/write 默认放行，策略写死（web index.ts:77）。**P2**

## I. 存储 / 路径 / 数据
- **I1** 宿主状态存得很散：permissions.json、hotkeys.json、machine-id、mcp-key（host.ts:102,117,140；mcp.ts:33）、每个插件的 features.json 和 schedules.json（plugin.ts:69,76；schedule.ts:57），都直接用 Node fs。web 则是一堆 localStorage key（web caps.ts:80-81）。→ core `HostStore`（带命名空间的 KV）：Node 用文件，web 用 IndexedDB，tauri 用 store 插件。**P0**
- **I2** 目录布局写死（plugin.ts:48-50：`plugins/<id>`、`plugin-data/<id>`、`os.tmpdir()/whatevertools/<id>`），默认数据目录在 host.ts:98。→ `PathsAdapter` + `paths:resolve`（便于做便携模式）。**P1**
- **I3** 数据库后端按平台写死：electron 用 FileBackend（plugin.ts:52），web 用 IndexedDB（web index.ts:70）。宿主无法注入后端（`PluginRuntime` 支持传入，但宿主从来没传），tauri 需要 db-tauri。→ `HostOptions.db(pluginId)`。**P1**
- **I4** 同步的接线写了两遍（host.ts:151-168 和 web index.ts:101-105），web 还把 `'\u0000storage/'` 写成了字面量。→ core `SyncManager`。**P1**
- **I5** 设备 id 语义不一致：electron 用 machine-id 加 sha256，web 每个插件随机生成一个，web 的同步还拿这个按插件生成的 id 当设备 id（system.ts:71、web caps.ts:121、web index.ts:103）。→ `DeviceAdapter`。**P2**
- **I6** 没有数据导出 / 备份 / 导入。**P2**
- **I7** 附件不参与同步（sync.ts:2）。web VFS 没有调用 `storage.persist()`，可能被浏览器回收。**P2**

## J. 定时任务 / 动态功能
- **J1** 调度引擎（cron 解析、每分钟轮询、计数）只在 electron（schedule.ts:1-174）。web 存 localStorage，只支持一次性定时，刷新页面就丢，不支持 cron，而且用 `confirm()` 代替 schedule 权限（web caps.ts:294-308）。→ core `Scheduler` + `TimerAdapter` + `schedule:fire`。**P1**
- **J2** 动态功能的存储和校验只在 electron（data.ts:33-52）。web 不校验，允许和静态功能撞 code。→ core `FeatureStore`。**P1**

## K. 系统集成
- **K1** `input.keyTap` 不看 `providers.input.keyTap`（input.ts:82）。`mouse*` 不管有没有配 provider 都直接抛错（input.ts:83-86）。paste/type 只在配置了 provider 时才走 callProvider（input.ts:52,57,64,72），所以单靠 `provider:input.*` hook 补不上实现。→ 一律走 callProvider，内置实现作为 fallback。**P0（hook 目标）**
- **K2** 没有检查和引导 OS 级权限：辅助功能（模拟按键）、屏幕录制、AppleScript 自动化。这些没授权时会静默失败（screen.ts:20 只在报错信息里提了一句）。→ `SystemPermissionAdapter`。E/T。**P1**
- **K3** shim-node 无视 `NetworkCapability`，http/https 被直接屏蔽（shim-node index.ts:230）。有 `ProcessCapability` 时 exec/execFile 仍不支持。tauri 需要这些。**P1**
- **K4** `afterHide` 用 macOS 的 `app.hide()` 加固定 200ms（input.ts:40-45）。**P2**
- **K5** 当前文件夹和当前浏览器 URL 只有 macOS AppleScript 实现（system.ts:85-104），Windows 没有。**P2**
- **K6** 缺开机自启（`AutostartAdapter`）、宿主自更新（`UpdaterAdapter`）、可选遥测（`TelemetrySink`），launcher 的 macOS dock 策略也是写死的（app.ts:96）。**P2**

## L. MCP / AI
- **L1** MCP 服务只在 electron，用 node:http（mcp.ts），JSON-RPC 逻辑和传输层混在一起。端口 3530 写死，没有 stdio 传输，没有 hook。web 的 `tools.register` 是空实现（web caps.ts:292），规格表却写 partial。→ core `McpServer` + `McpTransport`，hook 用 `mcp:tools.list`、`mcp:tools.call`、`mcp:auth`。**P1**
- **L2** `listChanged` 写死 false。只在运行时 registerTool、没在 plugin.json 里声明的工具不会暴露。进度流开了就扔掉（mcp.ts:132），session id 发了但不跟踪。**P2**
- **L3** 没有内置 AI provider（如 OpenAI 兼容）和配置界面，也没有按插件的额度统计。**P2**

## M. 安全 / 隔离
- **M1** 所有插件页都从 `file://` 加载，用的是默认 session（host.ts pluginUrl）。所以所有插件共享 localStorage、IndexedDB、cookies，没有按插件分区。→ `ViewSpec.partition` + 自定义协议 `whatevertools-plugin://<id>/`（新建 `ProtocolAdapter`：electron 用 protocol.handle，tauri 用自定义协议，web 用独立源或 iframe sandbox）。**P0**
- **M2** 自定义窗口加载 http(s) 远程页面时也注入了桥接 preload（windows.ts:48-49），远程页面因此拿到 `window.whatevertools` / `window.utools` 和该插件的全部授权。→ 默认只给插件自己源的页面注入 API。**P0（安全）**
- **M3** 导航防护只在 electron，且拦不到（host.ts:277-298）。→ `nav:navigate` / `nav:open`；web 和 tauri 也要实现。**P1**
- **M4** 插件页没有 CSP，也没有 `security:csp` hook（只有 shell 和 settings 页面带 meta CSP）。**P2**
- **M5** `browser` 权限标了支持作用域，但 `browser.automate` 不检查 goto 的域名（index.ts:355）。**P2**

## N. 能力上报 / 身份（目标 3）
- **N1** `supports()` 查的是静态表（apis.ts:21 只有 `{electron, web}`，没有 tauri 列；electron caps.ts:175；web caps.ts:104），不反映实际情况。已经对不上的有：
  - web 的 dialog.*、screen.capture / selectRegion / pickColor / sources 标 partial，但根本没有对应 cap。
  - web 的 searchInput.* 标 emulated，但没有 subInput。
  - web 的 launch.open 和 tools.register 标 partial，实际不可用或是空实现。
  - electron 新版剪贴板后端不能读写文件，clipboard.readFiles / writeFiles 仍报 native。
  - electron 的 input.* 在 Linux 上依赖 xdotool。
  - ai.* 在没配 provider 时也报 emulated。

  → 改为运行时计算：min(静态上限, 适配器探测, provider 是否存在)，加 `supports:<name>` hook，表改成按平台字符串索引。**P0**
- **N2** 不在 APIS 里的东西 `supports()` 一律返回 false：shim 模块（web 上的 fs 是虚拟的）、事件、窗口方法（web 静默忽略 setAlwaysOnTop 等，caps.ts:250）。**P1**
- **N3** `Identity.env` 以 Electron 为中心（`electron?/chrome?/node?`，apis.ts:205）。web 的 arch 是 'unknown'（web index.ts:106）。shim-node 写死 `os.arch()='x64'`、`release='0.0.0'`、`hostname='localhost'`（shim-node index.ts:168-171）。→ 改为 `env.engines[]`，系统能力层提供 arch 和 locale。**P1**
- **N4** mock 身份默认是 'whatevertools'（apis.ts:215-226）。伪装成 uTools 时用的默认值应该由 compat-utools 提供。**P2**
- **N5** 所有 API 的 `since` 都是 0.1.0，没有 deprecated 字段，`RUNTIME_VERSION` 和 package.json 版本各写一份。**P2**

## O. 打包 / 界面
- **O1** launcher 和 standalone 只在 electron 运行时用 mode 区分（app.ts）。没有打包工具；web 需要的预打包 preload 和文件清单（web index.ts:113-134）也没有工具生成。→ `whatevertools build --target electron|web|tauri`。**P1**
- **O2** launcher 的搜索框 / 结果 / 子输入 / 候选界面是 electron 专用的 shell.html，配专门的 `whatevertools-shell:*` IPC。→ 共享的 `@whatevertools/shell-ui` + PanelAdapter 桥接。**P1**
- **O3** 设置页（权限、快捷键、复制 MCP 配置）是 electron 专用 HTML（shell.ts:484-531），不能扩展。→ `SettingsAdapter` + `settings:sections`。launcher 配置 `~/.whatevertools/config.json`（launcher main.ts:24）在界面里改不了。**P1**
- **O4** whatevertools.json.standalone 里的 appId / productName 没用上，web 只读了 startFeature。**P2**

## P. uTools 命名泄漏（应该只出现在 compat-utools）

**core**
- `apis.ts:24-26` 的 `ApiSpec.legacy` 字段，每条规格都带 uTools 旧名；`LEGACY_API_MAP` 在 apis.ts:172，`findApi` 接受旧名（175）；group 'ubrowser'（163-166）。
- `capabilities.ts:158-168`：`subInput`、`outPluginSync`、`setExpandHeightSync`；259 行注释写的是 ubrowser；278-281：`redirectSync`、`hotkeySettingSync`、`getHotkeySync`；290：`isDarkColorsSync`；306-313：`bulkDocsSync`、`postAttachmentSync`、`replicateStateSync`；325：事件名 pluginEnter / pluginOut / pluginDetach / dbPull / subInputChange；333：请求名 scheduleTrigger / mainPush / mainPushSelect。
- `manifest.ts:16-18,70,76-78,113-175`：mainPush、mainHide、pluginSetting、legacy、development，以及 plugin.json / pluginName 的解析。
- `panel.ts:20-28`：`subInput`。
- `sync.ts:6`：注释提到 replicateStateFromCloud。
- `providers.ts:28`：goodsId / outOrderId / attach 是 uTools 支付的字段。
- `apis.ts:229-254`：Electron BrowserWindow 方法名（这是 Electron 泄漏进 core，不是 uTools）。

**api**
- `types.ts:9`：`EnterAction.type` 写死成 uTools 的 6 种类型（core 那边入口类型是开放的）；58 行注释提到 ubrowser。
- `ubrowser.ts:26,28`：文件名和报错信息。
- `index.ts:92,132-137,297`：事件和请求名。

**electron**
- 直接依赖 compat-utools：host.ts:18,114,192 默认注册 uTools 的入口和来源；app.ts:46 `require('@whatevertools/compat-utools')`；preload/index.ts:7,30 `createUtoolsCompat`。
- `protocol.ts:52-55`：`CompatLayer.type: 'utools'` 是封闭类型。
- `types.ts:20`：EnterAction 的类型联合。
- `host.ts:87` 的 `ubrowsers`；services/ubrowser.ts 里的 `UBrowsers` 类、`__ubrowserRun`（caps.ts:375 调用）。
- 报错里用旧名：input.ts:83-86（simulateMouse*）、data.ts:39（setFeature）、schedule.ts:80-83（requestSchedule）、windows.ts:38（createBrowserWindow）、system.ts:75（getPath）。
- 发出的事件名：shell.ts:116,148,188,471,477，schedule.ts:159。

**web**
- `index.ts:4,18,111`：createUtoolsCompat 和 `type: 'utools'`。
- `caps.ts:300`：scheduleTrigger。

**launcher**
- `apps/launcher/src/main.ts:30` 默认启用 utools 兼容层。作为应用层配置可以接受。

**建议的修法：**
- core 提供 `CompatRegistry.register(name, { factory, aliases, entryTypes, sources, manifestLoader, identityMock })`，各平台遍历注册表注入，不再直接 import compat-utools。
- core 里统一改用中立名：subInput→searchInput、outPlugin→exit、pluginEnter/Out→enter/leave、mainPush→searchPush、dbPull→db.pull、scheduleTrigger→schedule.trigger、ubrowser→automation、replicateState→syncState、isDarkColors→isDark。

## 汇总：core 需要新增的 adapter 和 hook

**Adapter（17 个）**
- 宿主编排与生命周期：PluginHost/HostTransport、PluginLoader/Manager、LifecycleManager（idle / 实例 / 崩溃）
- 权限：PermissionManager + Prompter + GrantStore
- 存储：HostStore、PathsAdapter
- 窗口与焦点：WindowAdapter（中立参数）、FocusAdapter
- 系统集成：Theme、Locale、LogSink、Tray、DeepLink、NotificationAdapter（含点击路由）
- 安全：SecurityAdapter（导航 / CSP / 浏览器权限请求 / 隔离）、ProtocolAdapter（插件独立源）
- MCP：McpTransport

**Hook 命名空间（15 个）**
- 新增（13 个）：`plugin:` `lifecycle:` `permission:` `theme:` `i18n:` `log:` `nav:` `tray:` `shortcut:` `notify:` `mcp:` `schedule:` `supports:`
- 需要搬进 core 并写进 hooks.ts 文档（2 个）：`window:`（目前只有 electron 有）、`panel:`（刚新增，文档还没写）

**我认为最该先做的 P0：**
- 安全两项：M1（插件同源共享存储）、M2（远程页面拿到插件 API）
- H5：Electron 默认放行摄像头、麦克风等浏览器权限请求
- H2：core 用了 Node 的 `process.platform`
- N1：`supports()` 和实际实现不一致
- K1：input 的 provider hook 走不通

 whatevertools 跨平台缺口审计完成：约 110 条缺口，P0 约 20 条，重点是插件同源隔离、远程页面注入 API 和能力上报失真。
