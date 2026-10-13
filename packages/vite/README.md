# @whatevertools/vite

[whatevertools](https://github.com/mowtwo/whatevertools) 的 Vite 插件。普通的 Vite 项目（React、Vue、原生都行）加上它：

- `vite build`：把 `whatevertools.json`（身份、权限说明、支持的目标、独立应用配置）写进产物，并按需打包成 uTools 插件、Electron 独立应用或网页；
- `vite dev`：在普通浏览器里模拟插件环境——注入运行时、把 `public/preload.js` 打包成浏览器脚本、`window.utools` 直接可用，不用开 uTools 也能调界面。

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import whatevertools from '@whatevertools/vite'

export default defineConfig({
  base: './',
  plugins: [
    whatevertools({
      manifest: { id: 'my-plugin', name: '我的插件', targets: ['utools', 'electron', 'web'] },
      // 不写 targets 时读环境变量：WT_TARGET=web,electron vite build
      targets: ['utools'],
      name: 'acme', // electron / web 目标的注入名和包名
    }),
  ],
})
```

uTools 的 `plugin.json` 和 `preload.js` 照常放在 `public/`。产物在 `release/<目标>/`。

| 选项 | 说明 |
|---|---|
| `targets` | `utools` / `electron` / `web`，可多个；默认读 `WT_TARGET` |
| `manifest` | 写进 `dist/whatevertools.json`，`version` 默认取 package.json |
| `out` | 打包输出目录，默认 `release` |
| `name` / `packageName` / `productName` | 注入名、包名、应用名 |
| `compat` | `utools`（默认）/ `utools:别名` / `none` |
| `devRuntime` | `vite dev` 时是否模拟插件环境，默认 `true` |

MIT
