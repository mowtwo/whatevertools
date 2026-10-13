# 给 Electron 应用加插件

`@whatevertools/electron` 是一个完整的插件宿主：插件表、生命周期、权限询问、入口与快捷键、窗口、MCP 工具、插件包安装。你的 Electron 应用调用 `runApp`（或者直接用 `WhateverToolsHost` 自己组装界面）就有了插件生态。

```bash
npm i @whatevertools/electron @whatevertools/compat-utools
```

```ts
import { runApp } from '@whatevertools/electron'

runApp({
  mode: 'launcher',                         // 'standalone'：单个插件就是整个应用
  plugins: ['/path/to/plugin', '/path/to/pack.upx'],
  compat: [{ type: 'utools' }],             // 现有 uTools 插件直接跑
  apiName: 'acme',                          // 原生 API 注入名：window.acme
  identity: {
    runtimeName: 'acme',
    host: { name: 'Acme Launcher', version: '2026.10-beta' },
    mock: { platform: { name: 'uTools', version: '7.0.0' } },
  },
  install: { enabled: true, max: 20, deny: ['bad-*'] },
  policy: { plugins: { 'quick-union-image': { 'fs.read': ['/Users/me/Pictures'] } } },
  providers: {
    user: { get: () => ({ nickname: 'me', avatar: '', type: 'user' }) },
    ai: { models: () => [/* … */], complete: async (ctx, req, io) => { /* 调你的模型；io.callTool 调插件工具 */ } },
  },
  mcp: { enabled: true },
  timeouts: { idleExit: 3 * 60 * 1000 },    // 退到后台 3 分钟后结束插件（有窗口开着的除外）
})
```

## 你得到了什么

- **启动器**：主面板（`Alt+Shift+Space`）、超级面板、指令快捷键、URL scheme、托盘。
- **设置页**：每个插件每项权限单独设置，安装 / 卸载插件包，复制 MCP 配置。
- **插件包安装**：`host.installer.install(file)`，详见 [插件包](./packages)。
- **安全**：每个插件独立的会话分区；远程网页窗口拿不到插件 API；插件页的摄像头、定位等浏览器权限映射成插件权限。
- **特殊接口提供者**：用户信息、AI 模型、付费、设备 id 由你提供，调用经过 `provider:` hook。

## 只要宿主、不要启动器界面

```ts
import { WhateverToolsHost } from '@whatevertools/electron'

const host = new WhateverToolsHost({ compat: [{ type: 'utools' }], install: { enabled: true } })
const plugin = host.loadPlugin('/path/to/plugin')
await host.enter(plugin.id, { code: 'main', type: 'text', payload: '打开', from: 'main' })
```

入口类型、唤起来源、面板行为都可以替换，见 [hook 与权限](./hooks)。
