---
title: 快拼图 · 网页案例
---

# 快拼图 · 网页

图片拼接工具：等高 / 等宽拼接、宫格、自由网格、长图与瀑布流，图片编辑、网格预设、批量工作流。原本是 uTools 插件，**同一份代码**打包成网页后直接在浏览器里运行。

<div class="demo-frame">
  <iframe src="/demo/quick-union-image/" title="快拼图在线试用" loading="lazy"></iframe>
</div>

[全屏打开在线试用 ↗](/demo/quick-union-image/){target="_blank"} · [插件源码](https://github.com/mowtwo/utools-quick-union-image){target="_blank"}

> 在线试用的数据只存在你的浏览器里（IndexedDB）。保存图片会触发浏览器下载。

<Shots base="/cases/quick-union-image" :items="[
  { file: '01.jpg', caption: '等高拼接' },
  { file: '02.jpg', caption: '自由网格与批量设置' },
  { file: '03.jpg', caption: '拖动序号调整顺序' },
  { file: '04.jpg', caption: '生成结果' },
  { file: '05.jpg', caption: '图片编辑' },
  { file: '06.jpg', caption: '网格预设编辑' },
  { file: '07.jpg', caption: '工作流' },
  { file: '08.jpg', caption: 'AI 编排' },
]" />

## 怎么做到的

```bash
npx whatevertools check ./dist              # 用到 9 个 API：网页上 6 个完整支持，sharp 部分支持，2 个不支持（插件里都有判断）
npx whatevertools pack ./dist --target web  # 产出静态站点，部署到任何静态托管
```

| uTools 能力 | 网页上由谁补 |
|---|---|
| `utools.sharp`（拼接、缩放、圆角遮罩、编辑） | `@whatevertools/sharp-canvas`：浏览器 Canvas 实现 |
| `showSaveDialog` + 写文件 | `@whatevertools/web-files`：返回 `/downloads/…`，写完自动下载 |
| `showOpenDialog` 选图片 | `dialog.openAsync`：浏览器文件选择器（插件里加了 5 行适配，uTools 构建不受影响） |
| `require('fs')` / `path` | 虚拟文件系统 + Node 模块垫片 |
| `utools.db` / `dbStorage` | IndexedDB |

插件只改了一处：打开文件时优先用异步 API。

```ts
async function openDialog(options) {
  const native = globalThis[Symbol.for('whatevertools.api')]   // uTools 里没有，照旧走 showOpenDialog
  if (native?.dialog?.openAsync) return (await native.dialog.openAsync(options)) ?? []
  return window.utools.showOpenDialog(options) ?? []
}
```

## 网页版的限制

`check` 报告里网页不支持的两个 API：`registerTool`（MCP 工具，插件先判断再注册）和 `subInputBlur`（uTools 子输入框失焦，插件包在 try 里）。网页上没有这两个概念，不影响使用。

- **AI 编排**需要宿主配置 AI 模型提供者，在线试用没有配置。
- **MCP 工具**（给 AI Agent 调用拼图）只在桌面上有意义，网页版不注册。
- 浏览器不支持编码 **AVIF**，导出 AVIF 时会提示改用 png / jpeg / webp。
