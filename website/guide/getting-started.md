# 快速开始

## 已经有一个 uTools 插件

不用改代码，先看它在各平台能跑到什么程度，再直接运行：

```bash
npm i -D @whatevertools/cli electron

npx whatevertools check ./dist     # 用到的 API 在 Electron / 网页上的支持程度
npx whatevertools run ./dist       # 在裸 Electron 启动器里运行，Alt+Shift+Space 打开主面板
```

打包成三种产物：

```bash
npx whatevertools pack ./dist --target utools                       # 原样输出给 uTools 发布
npx whatevertools pack ./dist --target electron --product "我的工具"  # Electron 独立应用
npx whatevertools pack ./dist --target web                          # 静态网页
```

需要长期维护时，用配置文件和 `build`：

```bash
npx whatevertools init --ci github   # 生成 whatevertools.config.ts 和 GitHub Actions
npx whatevertools build              # 按配置打包所有目标
npx whatevertools build --target electron --binary   # 出 dmg / nsis / AppImage 安装包
```

下一步：[移植 uTools 插件](./porting) · [打包与签名](./packaging)

## 写一个新插件

继续用 uTools 的写法（plugin.json + preload + 网页）就能同时发布到 uTools 和其他平台。只想要类型提示：

```bash
npm i -D @whatevertools/utools   # 只有 .d.ts，零运行时，不进打包产物
```

也可以直接用原生 API，名字更中立，换成自定义注入名的宿主也能运行：

```ts
import { getApi } from '@whatevertools/api'

const wt = getApi()
wt.lifecycle.onEnter((action) => { /* … */ })
const files = await wt.dialog.openAsync({ properties: ['openFile'] })
if (wt.supports('screen.captureRegion')) await wt.screen.captureRegion()
```

用 Vite 写界面时，加上 [Vite 插件](./vite) 就能在 `vite dev` 里直接调试插件环境。

## 想给自己的应用加插件

- Electron 应用：[给 Electron 应用加插件](./electron-host)
- 网站：[给网站加插件](./web-host)
