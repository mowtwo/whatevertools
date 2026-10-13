# @whatevertools/web-host

让任何网站在浏览器里动态安装、运行 uTools 类插件包（`.upx` / `.asar` / `.zip` / 文件夹）。插件解包后存进 IndexedDB，由 Service Worker 在 `<scope>plugins/<id>/` 下提供，每个插件跑在自己的 iframe 里；安装策略（数量上限、允许 / 禁止名单、包格式、确认）跟 Electron 宿主一致。

这是 [whatevertools](https://github.com/mowtwo/whatevertools) 的一部分，架构见仓库 README。

## 部署

需要三个静态文件，页面必须是 https 或 localhost（Service Worker 的要求）：

1. `@whatevertools/web-host/sw.js`：放在能覆盖作用域的位置，比如 `/__wt/sw.js`（作用域默认 `/__wt/`）。
2. 浏览器运行时：把 `@whatevertools/web/full` 打成 iife，全局名 `__whatevertoolsRuntime`：
   ```bash
   npx esbuild node_modules/@whatevertools/web/dist/full.js --bundle --format=iife --global-name=__whatevertoolsRuntime --minify --outfile=public/wt-runtime.js
   ```
3. 你的页面（用打包工具引入本包）。

## 用法

```ts
import { createWebHost } from '@whatevertools/web-host'

const host = createWebHost({
  swUrl: '/__wt/sw.js',
  runtimeUrl: '/wt-runtime.js',
  container: document.querySelector('#plugin-area')!,
  policy: { max: 5, deny: ['evil-*'] },             // 同 core 的 InstallPolicy
  prompt: async (c) => myDialog(`安装「${c.name}」${c.version}？`), // 默认浏览器 confirm
  apiName: 'acme',                                   // 原生 API 注入名；uTools 兼容层默认照常注入 window.utools
})
await host.ready

input.onchange = async () => {
  try {
    const rec = await host.install(input.files![0])   // File / Blob / Uint8Array；文件夹传 FileList（<input webkitdirectory>）
    host.open(rec.id, { feature: 'main' })
  } catch (e: any) {
    alert(e.message)                                  // e.code：EWTINSTALL（策略 / 取消 / 描述文件）、EWTENCRYPTED（upxs）
  }
}

host.list()                     // 已安装的插件
host.close('some-id')           // 关掉它的 iframe
await host.uninstall('some-id', { purgeData: true })
```

- `host.hooks` 上可以挂 `plugin:install`（`apply`，`args[0]` 是 `InstallCandidate`，返回 `false` 拒绝），接自己的审核或签名校验。
- 描述文件按其他平台的规则读取（`whatevertools.json` 优先，再 `plugin.json`），插件 id 一致；声明了 `targets` 且不含 `web` 的插件会被拒绝。
- 同一个 id 再装一次就是升级：新版本文件写完后才切换记录，已打开的 iframe 自动重新加载。
- preload 不需要构建：运行时用 `preloadMode: 'cjs'`，在浏览器里按 Node 规则 `require` 插件里的相对文件、JSON 和 `node_modules`。

## 限制

- iframe 和宿主页同源，插件之间、插件和宿主之间不是安全边界（存储按插件 id 分开，但恶意插件能访问 `parent`）。只装可信的插件；需要和主站隔离时，把整个宿主（页面 + 作用域）放到单独的子域名下。
- 插件文件在 IndexedDB 里，受浏览器存储配额限制。
- preload 里用到浏览器端没有的 Node 能力（原生模块、真实子进程）时会报错；需要的话接 `@whatevertools/bridge`（通过 `boot` 选项传启动配置）。

MIT
