# 移植 / 多端兼容

目标：同一份插件代码继续发布到 uTools，同时能打包成 Electron 独立应用和网页。大多数 uTools 插件不用改代码，下面是需要注意的地方。

## 1. 先跑兼容报告

```bash
npx whatevertools check ./dist
```

按平台列出插件用到的每个 API 和支持程度。重点看网页列里的「部分 / 占位 / —」。

## 2. 加 whatevertools.json（不影响 uTools）

放在插件构建产物目录（或上一级），给兼容层看：

```json
{
  "id": "quick-union-image",
  "name": "快拼图",
  "version": "1.2.0",
  "targets": ["utools", "electron", "web"],
  "permissions": {
    "fs.read": { "reason": "读取你选择、拖入或粘贴的图片" },
    "mcp": { "reason": "让 AI Agent 调用拼图工具" }
  },
  "standalone": { "productName": "快拼图", "startFeature": "stitch" }
}
```

- `permissions` 只是用途说明，显示在权限询问里，不会自动授予。权限 id 见 hosts.md。
- 只在桌面上成立的插件（透明置顶悬浮层、桌面挂件、模拟键鼠）把 `targets` 写成 `["utools", "electron"]`。
- Vite 项目可以用 `@whatevertools/vite` 的 `manifest` 选项自动写这个文件。

## 3. 类型

```bash
npm i -D @whatevertools/utools   # 只有 .d.ts，零运行时，不进打包产物
```

```jsonc
// tsconfig.json
{ "compilerOptions": { "types": ["@whatevertools/utools"] } }
// 或者 window.utools 声明成可选（在普通浏览器里调界面时）：
/// <reference types="@whatevertools/utools/namespace" />
```

## 4. 网页平台的差异和改法

| 情况 | 网页上的行为 | 建议 |
|---|---|---|
| `showOpenDialog`（同步） | 返回 `undefined`，异步弹出选择器，选中的文件默认作为一次 `files` 进入（`onPluginEnter` 收到 `type: 'files'`、`from: 'dialog'`） | 改用 `dialog.openAsync`（见下方代码） |
| `showOpenDialog` 选目录且带 `createDirectory` | 返回 `['/downloads']`，写进去的文件都会下载 | 不用改 |
| `showSaveDialog` | 返回 `/downloads/<文件名>`，写入后浏览器下载 | 不用改 |
| `shellShowItemInFolder` | 不报错、没效果 | 不用改 |
| `utools.sharp` | `@whatevertools/sharp-canvas`（Canvas 实现）：resize / extend / extract / rotate / flip / flop / composite / trim / flatten / png / jpeg / webp / metadata / stats 等常用操作 | 不支持 AVIF 编码、ICC、动图（只取第一帧）；对结果要求严格时在桌面端处理 |
| SVG 输入 | 自动补 `xmlns` 后用浏览器解码 | 不用改 |
| `require('fs')` 等 | 虚拟文件系统（IndexedDB 持久化）；`/drop` `/picked` `/downloads` `/tmp` 不落盘 | 别依赖真实路径；用户文件通过拖入 / 选择获得 |
| `require('child_process')`、原生模块 | 默认不支持；宿主可以接本地 bridge 守护进程 | 用 `supports()` 判断后降级 |
| 窗口置顶、鼠标穿透、全局快捷键、屏幕截图 | 浏览器做不到 | 声明 `targets` 排除 web |
| `createBrowserWindow` | `window.open` 模拟（会被弹窗拦截影响） | 能在主界面完成的就别开新窗口 |

打开文件改成异步、同时保持 uTools 构建不变：

```ts
async function openDialog(options) {
  // whatevertools 兼容层（独立应用、网页）提供原生 API；uTools 里没有
  const native = globalThis[Symbol.for('whatevertools.api')]
  if (native?.dialog?.openAsync) return (await native.dialog.openAsync(options)) ?? []
  return window.utools.showOpenDialog(options) ?? []
}
```

## 5. Electron 平台的差异

- 每个插件一个独立的会话分区（localStorage / IndexedDB / cookie 互不可见）。
- preload 里的 `require` 拦截是纵深防御，不是安全边界。
- `pluginSetting.single: false`（多实例）暂时按单实例运行。
- 无界面测试（`WHATEVERTOOLS_HEADLESS=1`）时插件窗口固定在屏幕外。

## 6. 打包

见 packaging.md。最小用法：

```bash
npx whatevertools pack ./dist --target electron --name acme --product "Acme 工具"
npx whatevertools pack ./dist --target web --name acme
npx whatevertools pack ./dist --target utools
```

`--name` 替换注入给插件的全局变量名（`window.acme`）、底座名和包名；uTools 兼容层仍注入 `window.utools`，可以用 `--compat utools:myhost` 改名或 `--compat none` 关闭。

## 7. 常见问题

- **网页上卡住没反应**：多半是权限询问用的 `confirm()` 被挡住了（测试环境），或者调用了需要用户手势的 API（文件选择要在点击事件里同步发起）。
- **`EWTUNSUPPORTED`**：这个 API 在当前平台不支持，查 api-support.md，用 `supports()` 判断后降级。
- **`EWTPERM`**：权限被拒绝；用户可以在宿主的设置页改。
- **`EWTENCRYPTED`**：给的是 `.upxs`，只能由 uTools 安装。
- **打包报「声明只支持 …」**：插件的 `targets` 不包含这个目标。
