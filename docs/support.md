# API 支持程度（底座 v0.1.1）

由 `packages/core/src/apis.ts` 自动生成（`node scripts/gen-support.mjs`），不要手改。

支持程度：原生 = 行为一致；模拟 = 换了实现但语义一致；部分 = 只支持一部分参数或场景；占位 = 不报错但没有真实效果；— = 不支持（按宿主策略抛错或警告）。

运行时可以用 `whatevertools.supports(name)` 查询（会结合当前宿主实际配置，比如没有配置 AI 提供者时 `ai.chat` 返回 false）。

## lifecycle

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `lifecycle.onEnter` | `onPluginEnter` |  | 原生 | 模拟 |  |
| `lifecycle.onLeave` | `onPluginOut` |  | 原生 | 模拟 |  |
| `lifecycle.onReady` | `onPluginReady` |  | 原生 | 模拟 |  |
| `lifecycle.onDetach` | `onPluginDetach` |  | 模拟 | 占位 | 启动器没有分离窗口时不会触发 |
| `lifecycle.onSearchPush` | `onMainPush` |  | 模拟 | — |  |
| `lifecycle.exit` | `outPlugin` |  | 原生 | 模拟 |  |

## events

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `schedule.onTrigger` | `onScheduleTrigger` | `schedule` | 模拟 | 部分 |  |

## panel

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `panel.hide` | `hideMainWindow` |  | 原生 | — |  |
| `panel.show` | `showMainWindow` |  | 原生 | — |  |
| `panel.setHeight` | `setExpandHeight` |  | 模拟 | 占位 |  |
| `panel.input.set` | `setSubInput` |  | 模拟 | — |  |
| `panel.input.remove` | `removeSubInput` |  | 模拟 | — |  |
| `panel.input.setValue` | `setSubInputValue` |  | 模拟 | — |  |
| `panel.input.focus` | `subInputFocus` |  | 模拟 | — |  |
| `panel.input.blur` | `subInputBlur` |  | 模拟 | — |  |
| `panel.input.select` | `subInputSelect` |  | 模拟 | — |  |

## window

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `window.create` | `createBrowserWindow` | `window.create` | 原生 | 部分 | web 端用 window.open / iframe 模拟 |
| `window.sendToParent` | `sendToParent` |  | 原生 | 模拟 |  |
| `window.type` | `getWindowType` |  | 原生 | 模拟 |  |

## page

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `page.find` | `findInPage` |  | 原生 | — |  |
| `page.stopFind` | `stopFindInPage` |  | 原生 | — |  |

## system

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `system.notify` | `showNotification` | `notification` | 原生 | 模拟 |  |
| `dialog.open` | `showOpenDialog` | `dialog` | 原生 | 部分 | web：选目录且带 createDirectory 时返回下载目录；其他情况浏览器没法同步选文件，返回 undefined 并异步弹出选择器，选中的文件按 WebBootConfig.fileDialogs.openDialog 交给插件（默认作为 files 进入）。新代码请用 dialog.openAsync |
| `dialog.save` | `showSaveDialog` | `dialog` | 原生 | 模拟 | web：返回 /downloads 下的路径，写进这个路径的文件会由浏览器下载 |
| `dialog.openAsync` |  | `dialog` | 原生 | 模拟 | web：浏览器文件选择器，选中的文件放在虚拟文件系统 /picked 下（0.2.0 起） |
| `dialog.saveAsync` |  | `dialog` | 原生 | 模拟 | 同 dialog.save（0.2.0 起） |
| `shell.openPath` | `shellOpenPath` | `shell.open` | 原生 | 部分 | web：只对 /downloads 下的文件有效（重新下载） |
| `shell.trash` | `shellTrashItem` | `shell.trash` | 原生 | — |  |
| `shell.showInFolder` | `shellShowItemInFolder` | `shell.open` | 原生 | 占位 | web：浏览器管理下载位置，调用不报错也没有效果 |
| `shell.openExternal` | `shellOpenExternal` | `shell.external` | 原生 | 模拟 |  |
| `shell.beep` | `shellBeep` |  | 原生 | — |  |
| `system.appName` | `getAppName` |  | 原生 | 模拟 |  |
| `system.appVersion` | `getAppVersion` |  | 原生 | 模拟 | 返回 identity.mock.platform.version |
| `paths.get` | `getPath` |  | 原生 | 占位 |  |
| `system.fileIcon` | `getFileIcon` |  | 原生 | — |  |
| `system.fileIconAsync` | `getFileIconAsync` |  | 原生 | — |  |
| `paths.data` | `getPluginLocalDataPath` | `fs.plugin` | 原生 | 模拟 |  |
| `paths.temp` | `getPluginTempPath` | `fs.plugin` | 原生 | 模拟 |  |
| `system.isDev` | `isDev` |  | 原生 | 模拟 |  |
| `system.isMac` | `isMacOS` |  | 原生 | 模拟 |  |
| `system.isWindows` | `isWindows` |  | 原生 | 模拟 |  |
| `system.isLinux` | `isLinux` |  | 原生 | 模拟 |  |
| `system.isDark` | `isDarkColors` |  | 原生 | 模拟 |  |
| `system.onThemeChange` |  |  | 原生 | 模拟 | 宿主主题变化（跟随系统或宿主设置） |

## device

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `device.id` | `getNativeId` | `system.identity` | 模拟 | 模拟 |  |

## account

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `account.user` | `getUser` | `system.identity` | 模拟 | 模拟 | 宿主可通过 hook 提供用户信息，默认 null |

## context

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `context.activeFolder` | `readCurrentFolderPath` | `system.context` | 部分 | — |  |
| `context.activeBrowserUrl` | `readCurrentBrowserUrl` | `system.context` | 部分 | — |  |
| `context.activeWindow` |  | `system.context` | 部分 | — |  |

## clipboard

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `clipboard.writeText` | `copyText` | `clipboard.write` | 原生 | 模拟 |  |
| `clipboard.writeImage` | `copyImage` | `clipboard.write` | 原生 | 模拟 |  |
| `clipboard.writeFiles` | `copyFile` | `clipboard.write` | 原生 | — |  |
| `clipboard.readFiles` | `getCopiedFiles` | `clipboard.read` | 原生 | — |  |

## input

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `input.sendText` | `hideMainWindowPasteText` | `input.paste` | 模拟 | — |  |
| `input.sendFiles` | `hideMainWindowPasteFile` | `input.paste` | 模拟 | — |  |
| `input.sendImage` | `hideMainWindowPasteImage` | `input.paste` | 模拟 | — |  |
| `input.typeText` | `hideMainWindowTypeString` | `input.paste` | 模拟 | — |  |
| `input.startDrag` | `startDrag` | `input.drag` | 原生 | — |  |
| `input.keyTap` | `simulateKeyboardTap` | `input.simulate` | 部分 | — | 系统级按键：macOS AppleScript / Windows SendKeys / Linux xdotool，或 providers.input |
| `input.mouseMove` | `simulateMouseMove` | `input.simulate` | 占位 | — |  |
| `input.mouseClick` | `simulateMouseClick` | `input.simulate` | 占位 | — |  |
| `input.mouseDoubleClick` | `simulateMouseDoubleClick` | `input.simulate` | 占位 | — |  |
| `input.mouseRightClick` | `simulateMouseRightClick` | `input.simulate` | 占位 | — |  |

## screen

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `screen.captureRegion` | `screenCapture` | `screen.captureDisplay` | 模拟 | — |  |
| `screen.captureDisplay` | `captureDisplay` | `screen.captureDisplay` | 原生 | — |  |
| `screen.pickColor` | `screenColorPick` | `screen.captureDisplay` | 模拟 | — |  |
| `screen.captureSources` | `desktopCaptureSources` | `screen.captureDisplay` | 原生 | — |  |
| `screen.displays` | `getAllDisplays` | `screen.read` | 原生 | 模拟 |  |
| `screen.primaryDisplay` | `getPrimaryDisplay` | `screen.read` | 原生 | 模拟 |  |
| `screen.cursor` | `getCursorScreenPoint` | `screen.read` | 原生 | 部分 |  |
| `screen.nearestDisplay` | `getDisplayNearestPoint` | `screen.read` | 原生 | 模拟 |  |
| `screen.matchingDisplay` | `getDisplayMatching` | `screen.read` | 原生 | 模拟 |  |
| `screen.toDipPoint` | `screenToDipPoint` | `screen.read` | 原生 | 模拟 |  |
| `screen.toScreenPoint` | `dipToScreenPoint` | `screen.read` | 原生 | 模拟 |  |
| `screen.toDipRect` | `screenToDipRect` | `screen.read` | 原生 | 模拟 |  |
| `screen.toScreenRect` | `dipToScreenRect` | `screen.read` | 原生 | 模拟 |  |

## db

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `db.put` | `db.put` | `storage` | 原生 | 模拟 |  |
| `db.get` | `db.get` | `storage` | 原生 | 模拟 |  |
| `db.remove` | `db.remove` | `storage` | 原生 | 模拟 |  |
| `db.bulk` | `db.bulkDocs` | `storage` | 原生 | 模拟 |  |
| `db.all` | `db.allDocs` | `storage` | 原生 | 模拟 |  |
| `db.putAttachment` | `db.postAttachment` | `storage` | 原生 | 部分 |  |
| `db.getAttachment` | `db.getAttachment` | `storage` | 原生 | 模拟 |  |
| `db.getAttachmentType` | `db.getAttachmentType` | `storage` | 原生 | 模拟 |  |
| `db.syncState` | `db.replicateStateFromCloud` | `storage` | 模拟 | 模拟 | 配置了同步适配器才有意义 |
| `db.onPull` | `onDbPull` | `storage` | 模拟 | 模拟 | 配置了同步适配器才会触发 |
| `kv.set` | `dbStorage.setItem` | `storage` | 原生 | 模拟 |  |
| `kv.get` | `dbStorage.getItem` | `storage` | 原生 | 模拟 |  |
| `kv.remove` | `dbStorage.removeItem` | `storage` | 原生 | 模拟 |  |

## features

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `features.list` | `getFeatures` |  | 原生 | 模拟 |  |
| `features.set` | `setFeature` | `features` | 原生 | 模拟 |  |
| `features.remove` | `removeFeature` | `features` | 原生 | 模拟 |  |

## launch

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `launch.open` | `redirect` | `redirect` | 模拟 | — |  |

## hotkeys

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `hotkeys.openSettings` | `redirectHotKeySetting` |  | 模拟 | — |  |
| `hotkeys.get` | `getCmdHotKey` |  | 模拟 | — |  |

## schedule

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `schedule.request` | `requestSchedule` | `schedule` | 模拟 | 部分 |  |
| `schedule.list` | `getSchedules` | `schedule` | 模拟 | 部分 |  |
| `schedule.remove` | `removeSchedule` | `schedule` | 模拟 | 部分 |  |

## ai

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `ai.chat` | `ai` | `ai` | 模拟 | 模拟 | 需要宿主配置模型提供方（hook: service:ai） |
| `ai.models` | `allAiModels` | `ai` | 模拟 | 模拟 |  |
| `tools.register` | `registerTool` |  | 模拟 | — | 注册不需要权限；外部 Agent 第一次调用时按 mcp 权限询问 |

## media

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `media.ffmpeg` | `runFFmpeg` | `media.ffmpeg` | 模拟 | 部分 | 使用宿主配置或 PATH 中的 ffmpeg；web 端可接 ffmpeg.wasm |
| `image.sharp` | `sharp` | `image.sharp` | 模拟 | 部分 | electron：宿主安装的 sharp；web：@whatevertools/sharp-canvas（Canvas 实现的常用子集，不支持 AVIF 编码、ICC、动图），也可以换成 wasm 版 |

## payment

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `billing.isPurchased` | `isPurchasedUser` | `payment` | 占位 | 占位 | 默认 true，宿主可 hook |
| `billing.purchase` | `openPurchase` | `payment` | 占位 | 占位 |  |

## ubrowser

| API | uTools 旧名 | 权限 | Electron | Web | 说明 |
|---|---|---|---|---|---|
| `browser.automate` | `ubrowser` | `browser` | 部分 | — | 用隐藏的 BrowserWindow 实现常用链式指令 |
| `browser.idle` | `getIdleUBrowsers` | `browser` | 模拟 | — |  |
| `browser.setProxy` | `setUBrowserProxy` | `browser` | 模拟 | — |  |
| `browser.clearCache` | `clearUBrowserCache` | `browser` | 模拟 | — |  |

## 权限

默认询问；只有插件自己的沙盒（数据库、私有目录）默认放行。每一项都可以按插件单独设置。

| 权限 | 名称 | 说明 | 风险 | 默认 |
|---|---|---|---|---|
| `storage` | 插件数据库 | db / kv，只能访问自己的数据 | low | 允许 |
| `fs.plugin` | 插件私有目录 | 读写插件自己的数据目录和临时目录 | low | 允许 |
| `fs.read` | 读取文件 | 读取任意（或指定范围内的）本地文件 | medium | 询问 |
| `fs.write` | 写入文件 | 创建、修改、删除任意（或指定范围内的）本地文件 | high | 询问 |
| `clipboard.write` | 写入剪贴板 | clipboard.writeText / writeImage / writeFiles | low | 询问 |
| `clipboard.read` | 读取剪贴板 | 读取剪贴板里的文字、图片和文件 | medium | 询问 |
| `notification` | 系统通知 | system.notify | low | 询问 |
| `dialog` | 文件对话框 | 弹出打开/保存对话框，用户选中的路径会临时授予读写 | low | 询问 |
| `shell.open` | 打开文件 | 用系统默认程序打开文件、在访达/资源管理器中显示 | medium | 询问 |
| `shell.external` | 打开链接 | 用浏览器打开网址 | low | 询问 |
| `shell.trash` | 移到废纸篓 | shell.trash | high | 询问 |
| `screen.read` | 屏幕信息 | 显示器列表、光标位置 | low | 询问 |
| `screen.capture` | 截屏 | screen.selectRegion / capture / sources / pickColor | high | 询问 |
| `window.create` | 独立窗口 | window.create | low | 询问 |
| `window.overlay` | 覆盖层窗口 | 置顶、鼠标穿透、全屏透明、所有桌面可见 | medium | 询问 |
| `input.paste` | 粘贴到其他应用 | input.pasteText / pasteFiles / pasteImage / typeText | medium | 询问 |
| `input.simulate` | 模拟键鼠 | input.keyTap / mouseMove / mouseClick | high | 询问 |
| `input.drag` | 拖出文件 | input.startDrag | low | 询问 |
| `network` | 网络 | Node http/https/net/dgram/tls 模块（页面里的 fetch 不受影响） | medium | 询问 |
| `process.spawn` | 运行程序 | child_process / worker_threads | high | 询问 |
| `process.native` | 原生模块 | 加载 .node 原生扩展 | high | 询问 |
| `electron.raw` | 未过滤的 Electron API | require("electron") 拿到完整对象，而不是兼容白名单；只能在权限设置里显式授予，不会弹窗询问 | high | 禁止 |
| `system.identity` | 用户与设备信息 | system.user / deviceId | medium | 询问 |
| `system.context` | 前台应用上下文 | system.activeFolder / activeBrowserUrl | medium | 询问 |
| `schedule` | 定时任务 | schedule.request | low | 询问 |
| `features` | 动态功能 | features.set / remove | low | 询问 |
| `redirect` | 跳转其他插件 | launch.open，向其他插件传数据 | low | 询问 |
| `ai` | AI 模型 | ai.chat / models，消耗宿主配置的模型额度 | medium | 询问 |
| `mcp` | MCP 工具 | 把注册的工具暴露给外部 AI Agent（MCP） | medium | 询问 |
| `browser` | 自动化浏览器 | browser.automate | high | 询问 |
| `media.ffmpeg` | FFmpeg | media.ffmpeg | low | 询问 |
| `image.sharp` | Sharp | image.sharp 图像处理 | low | 询问 |
| `payment` | 付费 | billing.isPurchased / purchase | low | 询问 |
| `media.camera` | 摄像头 | 页面通过 getUserMedia 使用摄像头 | high | 询问 |
| `media.microphone` | 麦克风 | 页面通过 getUserMedia 使用麦克风 | high | 询问 |
| `geolocation` | 位置 | 页面读取地理位置 | medium | 询问 |
| `device.hardware` | 硬件设备 | WebHID / WebSerial / WebUSB / MIDI | high | 询问 |
