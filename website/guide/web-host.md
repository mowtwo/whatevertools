# 给网站加插件

两种方式：

1. **固定插件**：`wt pack --target web` 把插件打成静态站点，多个插件打成带入口页的站点，部署到任何静态托管。
2. **动态安装**：网站引入 `@whatevertools/web-host`，用户在浏览器里安装 `.upx` 插件包，每个插件跑在自己的 iframe 里。

## 动态安装

<!--@include: ../../packages/web-host/README.md{9,}-->

## 在自己的页面里启动运行时

```ts
import { boot } from '@whatevertools/web/full'   // 带 uTools 兼容层和默认适配器

const rt = await boot({
  manifestFiles: { 'plugin.json': pluginJson },
  files: { 'index.html': 1234, 'preload.js': 567 },   // 插件文件清单（相对路径 → 字节数）
  base: '/plugins/my-plugin/',
  apiName: 'acme',
  compat: [{ type: 'utools' }],
  preloadMode: 'cjs',                                // preload 在浏览器里直接按 CommonJS 执行，不用预先打包
  fileDialogs: { openDialog: 'enter' },
})
await rt.start()
```
