# whatevertools

把启动器类插件（为 uTools 这类平台写的插件）带到任何地方：在裸 Electron 里运行、单独打包成桌面应用、打包成网页，或者接到你自己的平台上。

- **完整兼容层**：uTools 的 API、`require` 到的 Node.js 模块和 Electron 模块都能用；做不到的能力明确报告，可以 mock 或交给宿主实现。
- **平台无关的核心**：生命周期、权限、入口、调度、存储、同步等编排都在 core 里，平台只实现适配器（目前有 Electron 和 Web，接口按以后接 Tauri 设计）。
- **处处可 hook**：注入给插件的每个函数和属性都支持访问器级别（get / set / apply / construct）的拦截；宿主侧的入口、来源、面板、窗口、权限、生命周期、提供者也都有 hook 点。
- **按插件的权限**：参考 Chrome 的网站权限，默认询问；每一项权限都可以按插件单独设置。
- **版本与身份注入**：插件能拿到底座版本、宿主版本、伪装平台和插件自己的版本信息。
- **一条命令打包**：`utools`（原样输出，零运行时）、`electron`（独立应用）、`web`（静态站点）。后两者可以自定义 API 的注入名和包名。

> 状态：0.1.0，开发中。Electron 和 Web 已有完整的端到端测试；Tauri 还没有开始。

## 安装

```bash
npm i -D @whatevertools/cli electron     # 命令行：whatevertools（简写 wt）
npm i -D @whatevertools/utools           # 只要 uTools 类型提示时装这个（零运行时）
```

宿主或自定义平台按需装 `@whatevertools/electron`、`@whatevertools/web` 等，见下面的包列表。

## 快速上手

在本仓库里开发时：

```bash
pnpm install
pnpm build

# 在裸 Electron 启动器里运行插件（插件目录里有 plugin.json 或 whatevertools.json）
pnpm wt run ../your-plugin/dist
# Alt+Shift+Space 打开主面板，Alt+Shift+P 打开超级面板

# 兼容报告：插件用到的 API 在各平台的支持程度
pnpm wt check ../your-plugin/dist

# 打包
pnpm wt pack ../your-plugin/dist --target utools      # 原样输出给 uTools 发布（校验 plugin.json，不带任何运行时）
pnpm wt pack ../your-plugin/dist --target electron --name acme --product "Acme 工具"
pnpm wt pack ../your-plugin/dist --target web --name acme
```

`--name` 同时替换注入给插件的全局变量名（`window.acme`）、底座名和输出包名；uTools 兼容层默认照常注入为 `window.utools`，可以用 `--compat utools:myhost` 改名或 `--compat none` 关闭。

## 架构

```
插件代码 ──► 兼容层（@whatevertools/compat-utools：window.utools、plugin.json、6 种入口、4 种来源）
             │
             ▼
         原生 API（@whatevertools/api：window.whatevertools，按命名空间组织）
             │  只依赖能力接口
             ▼
         能力接口（core/capabilities.ts）◄── Node / Electron 模块垫片（shim-node、shim-electron）
             │
   ┌─────────┴──────────┐
 Electron 平台          Web 平台               （Tauri：以后）
 @whatevertools/electron  @whatevertools/web
   │  main 进程宿主         │  浏览器运行时
   │  继承 core 的 HostCore  │  虚拟文件系统 / IndexedDB
   ▼                       ▼
 宿主核心引擎（core/host-core.ts）：插件表、生命周期、权限管理、入口与来源、定时任务、
 动态功能、快捷键、提供者、面板操作、身份、同步
```

| 包 | 作用 |
|---|---|
| `@whatevertools/core` | 规格表、权限模型、hook 注册表、宿主核心引擎、入口与来源注册表、文档数据库引擎、同步引擎、描述文件加载器 |
| `@whatevertools/api` | 用能力接口拼出原生 API（所有平台共用），`getApi()` |
| `@whatevertools/compat-utools` | uTools 兼容层：`window.utools`、plugin.json 加载器、text / regex / over / img / files / window 入口、main / panel / hotkey / redirect 来源、拼音搜索 |
| `@whatevertools/electron` | Electron 平台：宿主、IPC、服务、preload 桥、`require` 拦截、启动器和独立应用外壳 |
| `@whatevertools/web` | 浏览器平台：能力实现、虚拟文件系统、Node / Electron 模块垫片 |
| `@whatevertools/shim-node` / `shim-electron` | 用能力接口拼出 `fs`、`path`、`os`、`child_process`……以及 `ipcRenderer`、`clipboard`、`nativeImage`…… |
| `@whatevertools/fs-virtual` | 内存常驻、可持久化到 IndexedDB 的 POSIX 文件系统 |
| `@whatevertools/bridge` / `bridge-server` | Web 端通过本地守护进程使用真实的文件系统、子进程、剪贴板和 shell（守护进程弹系统对话框问权限） |
| `@whatevertools/db-file` / `db-indexeddb` | 数据库存储适配器 |
| `@whatevertools/sync-folder` / `sync-http` | 数据同步适配器（共享文件夹；HTTP，附参考服务端） |
| `@whatevertools/utools` | 给原生 uTools 插件用的类型包：`window.utools` 的 `.d.ts`、plugin.json 的 JSON Schema，零运行时；可选的 `/runtime` 在 uTools 上实现原生 API |
| `@whatevertools/cli` | `whatevertools`（`wt`）命令：`run / check / pack`，以及启动器 |
| `apps/launcher` | 把启动器（`@whatevertools/cli` 里的 `launcher`，`wt run` 用的也是它）打包成独立桌面应用的外壳 |

## 写插件

### 继续用 uTools 的写法

现有的 uTools 插件不用改：plugin.json、preload、`window.utools` 照常工作。需要在兼容层里补充信息时，在插件目录（或上一级）放一个 `whatevertools.json`，它不会影响 uTools 的打包和发布：

```json
{
  "id": "quick-union-image",
  "name": "快拼图",
  "version": "1.2.0",
  "permissions": {
    "fs.read": { "reason": "读取你选择、拖入或粘贴的图片" },
    "mcp": { "reason": "让 AI Agent 调用拼图工具" }
  },
  "standalone": { "productName": "快拼图", "startFeature": "stitch" }
}
```

`permissions` 里的说明会出现在权限询问里；声明权限不会自动授予。

只想要类型提示时，装 `@whatevertools/utools`（只有 `.d.ts`，不进打包产物）：

```jsonc
// tsconfig.json
{ "compilerOptions": { "types": ["@whatevertools/utools"] } }
// 或者想把 window.utools 声明成可选（浏览器里调试界面）：/// <reference types="@whatevertools/utools/namespace" />
```

### 用原生 API

```ts
import { getApi } from '@whatevertools/api'

const wt = getApi() // 不依赖注入名，换成自定义名字的宿主也能运行
wt.lifecycle.onEnter((action) => { /* ... */ })
wt.panel.input.set(({ text }) => search(text), '搜索…')
const shot = await wt.screen.captureRegion()
wt.system.onThemeChange((dark) => applyTheme(dark))
```

原生格式的描述文件是 `whatevertools.json`（带 `main` 字段）：

```json
{
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "panel": { "height": 400 },
  "features": [{ "code": "hello", "cmds": ["你好", { "type": "regex", "label": "打开网址", "match": "/^https?:\\/\\//" }] }]
}
```

全部 API、uTools 旧名和各平台的支持程度见 [docs/support.md](docs/support.md)。

## 宿主

```ts
import { runApp } from '@whatevertools/electron'

runApp({
  mode: 'launcher',                         // 或 'standalone'：单个插件就是整个应用
  plugins: ['/path/to/plugin'],
  compat: [{ type: 'utools' }],             // = { module: '@whatevertools/compat-utools' }
  apiName: 'acme',                          // 原生 API 的注入名
  identity: {
    runtimeName: 'acme',
    host: { name: 'Acme Launcher', version: '2026.10-beta' },   // 任意字符串，插件自行解析
    mock: { platform: { name: 'uTools', version: '7.0.0' } },   // 旧插件看到的 getAppName / getAppVersion
  },
  policy: { plugins: { 'quick-union-image': { 'fs.read': ['/Users/me/Pictures'] } } },
  providers: {
    user: { get: () => ({ nickname: 'me', avatar: '', type: 'user' }) },
    ai: { models: () => [...], complete: async (ctx, req, io) => { /* 调你的模型，io.callTool 调插件工具 */ } },
  },
  sync: { adapter: (pluginId) => new HttpSync({ baseUrl: 'https://sync.example.com', token }) },
  mcp: { enabled: true },
  timeouts: { idleExit: 3 * 60 * 1000 },    // 退到后台 3 分钟后结束（有窗口开着的插件除外）
})
```

### hook

所有扩展点共用一个 `HookRegistry`。插件进程里是访问器级别的拦截，宿主侧是 `apply` 形式：

```ts
// 插件进程（HostOptions.rendererHooks 指定的模块里）
hooks.on('node:fs.readFileSync', { apply: (ctx, next) => (log(ctx.args[0]), next()) })
hooks.on('utools:getAppVersion', { apply: () => '7.1.0' })
hooks.on('api:identity', { get: (ctx, next) => ({ ...next(), channel: 'beta' }) })

// 宿主侧
host.hooks.on('provider:user.get', { apply: (ctx, next) => ({ ...next(), vip: true }) })
host.hooks.on('window:create', { apply: async (ctx, next) => { const r = await next(); return { ...r, options: { ...r.options, alwaysOnTop: false } } } })
host.hooks.on('panel:detach', { apply: () => undefined })              // 禁止分离窗口
host.hooks.on('source:register', { apply: (c, next) => (c.args[0].id === 'panel' ? null : next()) })  // 不要超级面板
host.hooks.on('permission:prompt', { apply: (c) => myPromptUI(c.args[0]) })
host.hooks.on('lifecycle:idle', { apply: (c) => (c.args[0] === 'desktop-widgets' ? false : true) })
```

命名空间：`api:` `<兼容层注入名>:` `node:` `electron:` `event:` `service:` `provider:` `panel:` `window:` `entry:` `source:` `permission:` `lifecycle:` `schedule:` `theme:` `tray:` `log:`，详见 `packages/core/src/hooks.ts` 的说明。

### 入口和来源

- **入口类型**（关键字怎么匹配）：`host.entries.register({ type, match(cmd, input) })`，插件的 cmds 里就能写这个 type。
- **唤起来源**（从哪里进入，即 `action.from`）：`host.sources.register({ id, setup(ctx) })`，在 `setup` 里接入快捷键、URL scheme、托盘或任何你的入口，用 `ctx.emit(input)` 交给匹配器或 `ctx.enter(...)` 直接进入。

uTools 的 6 种入口类型和 4 种来源由兼容层默认注册，可以替换或拒绝。

## 权限

- 默认询问，只有插件自己的数据库和私有目录默认放行。
- 询问时可以选「始终允许 / 仅本次 / 禁止 / 以后再说」；连续关掉 3 次自动转为禁止。
- 路径和网址类权限带作用域：「始终允许」只授予这个文件 / 这个网站。
- 用户主动交给插件的文件（对话框选中、拖入主面板）本次运行内可读写；插件自己通过跳转或剪贴板传来的路径不会被授权。
- 插件页面的浏览器权限请求（摄像头、麦克风、定位、硬件设备）也映射到插件权限。
- 每个插件一个独立的会话分区，localStorage、IndexedDB、cookie 互不可见；远程网页窗口不注入插件 API。

> 插件 preload 里的 `require` 拦截是纵深防御，不是安全边界：同进程里的恶意代码仍可能绕过。需要强隔离时要用（规划中的）严格模式。

## 测试

```bash
pnpm test:all       # 构建 + 单元测试 + Electron 端到端（功能、安全、生命周期）+ Web 端到端 + 打包产物启动
pnpm test:plugins   # 用 ../utools-quick-union-image 和 ../utools-desktop-widgets 的 dist 做验收
```

端到端测试运行在无界面模式（`WHATEVERTOOLS_HEADLESS=1`），窗口都在屏幕外，测试数据放在临时目录。

## 发布

推送 `v*` 标签时，GitHub Actions 通过 npm 可信发布（OIDC）发布所有改过版本号的包，不需要 npm token。

```bash
# 改好要发的包的 version 后
git tag v0.1.1 && git push origin v0.1.1
```

## 路线图

- Tauri 平台（窗口参数中立化、`ViewSpec`）
- 插件严格隔离模式（插件代码跑在沙箱渲染进程，只能用 API 和垫片模块）
- 界面多语言
- 分离窗口里的子输入框、收回到面板
- 插件页 CSP 策略
- 多实例插件（`panel.single: false`）

## 参考资料

`docs/reference/legacy-api.md` 是根据 uTools 公开开发文档整理的接口摘要，供实现兼容层时对照；`docs/audit/` 是三份审计报告（API 行为对照、平台扩展点、代码缺陷）及其处理情况。

## 许可证

MIT
