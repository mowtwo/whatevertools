# 做宿主：在自己的应用 / 网站里运行插件

## Electron 宿主

```ts
import { runApp } from '@whatevertools/electron'

runApp({
  mode: 'launcher',                         // 或 'standalone'：单个插件就是整个应用
  plugins: ['/path/to/plugin', '/path/to/pack.upx'],   // 插件包直接运行（临时目录）
  compat: [{ type: 'utools' }],             // uTools 兼容层：window.utools、plugin.json、入口类型、来源
  apiName: 'acme',                          // 原生 API 注入名
  identity: {
    runtimeName: 'acme',
    host: { name: 'Acme Launcher', version: '2026.10-beta' },   // 任意字符串，插件自行解析
    mock: { platform: { name: 'uTools', version: '7.0.0' } },   // 旧插件看到的 getAppName / getAppVersion
  },
  policy: { plugins: { 'quick-union-image': { 'fs.read': ['/Users/me/Pictures'] } } },
  install: { enabled: true, max: 20, allow: ['*'], deny: ['bad-*'], confirm: true },  // 动态安装插件包
  providers: {
    user: { get: () => ({ nickname: 'me', avatar: '', type: 'user' }) },
    ai: { models: () => [/* … */], complete: async (ctx, req, io) => { /* 调你的模型，io.callTool 调插件工具 */ } },
  },
  mcp: { enabled: true },
  timeouts: { idleExit: 3 * 60 * 1000 },
})
```

- `host.installer.install(fileOrBytes)` / `uninstall(id)` / `list()`：安装 upx / asar / zip，同 id 再装是升级，记录持久化、重启自动加载。设置页有「安装插件包」按钮。
- 启动器默认允许安装（安装前弹系统对话框确认），独立应用默认不允许。

## 网页宿主

单个插件打包成网页用 `wt pack --target web`。需要在自己的页面里启动运行时时：

```ts
import { boot } from '@whatevertools/web/full'   // 带 uTools 兼容层和默认适配器
const rt = await boot({
  manifestFiles: { 'plugin.json': pluginJson },
  files: { 'index.html': 1234, 'preload.js': 567 },   // 插件文件清单（相对路径 → 字节数）
  base: '/plugins/my-plugin/',
  apiName: 'acme',
  compat: [{ type: 'utools' }],
  providers: { /* 同上 */ },
  sync: new HttpSync({ baseUrl: 'https://sync.example.com', token }),   // 可选：数据同步
  bridge: { url: 'http://127.0.0.1:3540', token },                      // 可选：本地守护进程，真实文件系统 / 子进程
  fileDialogs: { openDialog: 'enter' },   // 同步 showOpenDialog 的选择结果怎么交给插件；false 关闭文件对话框适配器
  // sharp: wasmSharp,                     // 换成 wasm 版 sharp；默认 Canvas 实现
})
await rt.start()
```

网页上的能力补齐都是可替换的适配器包：`@whatevertools/sharp-canvas`（sharp）、`@whatevertools/web-files`（文件对话框、下载）、`@whatevertools/fs-virtual`（文件系统）、`@whatevertools/db-indexeddb`（数据库）、`@whatevertools/bridge`（本地守护进程）。

网站里动态安装插件包（每个插件一个 iframe，Service Worker 从 IndexedDB 提供文件）用 `@whatevertools/web-host`，见它的 README。

## hook

所有扩展点共用 `HookRegistry`。插件进程里是访问器级别（get / set / apply / construct），宿主侧是 apply：

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
host.hooks.on('plugin:install', { apply: (c) => c.args[0].id.startsWith('trusted-') })   // 自定义安装审核
```

命名空间：`api:` `<兼容层注入名>:` `node:` `electron:` `event:` `service:` `provider:` `panel:` `window:` `entry:` `source:` `permission:` `lifecycle:` `plugin:` `schedule:` `theme:` `tray:` `log:`。

## 入口和来源

- 入口类型（关键字怎么匹配）：`host.entries.register({ type, match(cmd, input) })`。uTools 的 text / regex / over / img / files / window 由兼容层注册。
- 唤起来源（从哪里进入，即 `action.from`）：`host.sources.register({ id, setup(ctx) })`，在 `setup` 里接快捷键、URL scheme、托盘，`ctx.emit(input)` 交给匹配器或 `ctx.enter(...)` 直接进入。uTools 的 main / panel / hotkey / redirect 由兼容层注册。

## 权限 id

`storage` `fs.plugin` `fs.read` `fs.write` `clipboard.read` `clipboard.write` `notification` `dialog` `shell.open` `shell.external` `shell.trash` `screen.read` `screen.capture` `window.create` `window.overlay` `input.paste` `input.simulate` `input.drag` `network` `process.spawn` `process.native` `electron.raw` `system.identity` `system.context` `schedule` `features` `redirect` `ai` `mcp` `browser` `media.ffmpeg` `image.sharp` `payment` `media.camera` `media.microphone` `geolocation` `device.hardware`

询问时可以选「始终允许 / 仅本次 / 禁止 / 以后再说」，连续关掉 3 次自动转为禁止；路径和网址类权限带作用域。

## 错误码

`EWTPERM` 权限被拒 · `EWTUNSUPPORTED` 平台不支持 · `EWTINSTALL` 安装被策略或用户拒绝 · `EWTENCRYPTED` upxs 加密包 · `EWTCONFIG` 构建配置错误 · `EWTSIGN` 签名凭据不全 · `EWTBUILDER` 没装 electron-builder · `EWTUSAGE` / `EWTFAIL` 命令行用法错误 / 其他失败（--json 输出里的 code）
