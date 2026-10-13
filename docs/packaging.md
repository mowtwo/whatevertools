# 打包与发布

`whatevertools`（简写 `wt`）把一个插件打成三种产物：

| 目标 | 产物 | 说明 |
|---|---|---|
| `utools` | 原样的 uTools 插件目录 | 不带任何运行时，校验 plugin.json；`whatevertools.json` 不会进入产物 |
| `electron` | 独立应用目录，可以继续出安装包（dmg / zip / nsis / AppImage…） | 多个插件时是一个启动器应用 |
| `web` | 静态站点 | 多个插件时根目录是入口页，每个插件一个子目录 |

插件在 `whatevertools.json` 里写 `"targets": ["utools", "electron"]` 可以声明只支持哪些目标，打包到其他目标会直接报错（比如只在桌面上有意义的悬浮挂件）。

## 配置文件

```bash
npx whatevertools init               # 生成 whatevertools.config.ts
npx whatevertools init --ci github   # 同时生成 .github/workflows/build-apps.yml
```

```ts
// whatevertools.config.ts（也可以是 .mjs / .cjs / .json）
import { defineConfig } from '@whatevertools/cli'

export default defineConfig({
  plugins: './dist',                     // 插件目录或插件包（.upx / .asar / .zip），可以多个
  targets: ['utools', 'electron', 'web'],
  out: 'release',
  name: 'acme',                          // electron / web 的注入名（window.acme）和底座名
  productName: '快拼图',
  electron: {
    install: { enabled: false },         // 打包后的应用能不能再装插件包（见 README「插件包」）
    binary: {
      formats: { mac: ['dmg', 'zip'], win: ['nsis'], linux: ['AppImage'] },
      arch: ['arm64', 'x64'],            // 默认当前机器架构
      icon: 'build/icon.png',            // 至少 512×512；不写用第一个插件的 logo
      builder: {},                       // 原样合并进 electron-builder 配置
    },
    sign: {
      mac: { identity: undefined, notarize: undefined, entitlements: undefined },
      win: { mode: 'azure', azure: { endpoint: '…', certificateProfileName: '…', codeSigningAccountName: '…' } },
    },
  },
})
```

## 命令

```bash
wt build                                  # 按配置打包所有 targets
wt build --target web,electron            # 只打这几个（也可以用环境变量 WT_TARGET）
wt build --target electron --binary       # 继续出安装包（需要项目里 npm i -D electron-builder）
wt build --binary --platform mac,win      # 指定安装包平台（跨平台构建受 electron-builder 限制，建议在 CI 矩阵里各平台分别构建）
wt doctor --target electron --binary      # 检查 Node、Electron、electron-builder 和签名凭据，缺什么列出来
wt pack <插件目录或插件包...> --target web # 不用配置文件、直接打包
```

所有命令都是非交互的：

- `--json`：stdout 只输出一行结果 JSON（`{"ok":true,...}` / `{"ok":false,"code":"…","error":"…"}`），日志都在 stderr；
- 退出码：`0` 成功，`1` 失败（包括 `doctor` 有必需项没通过），`2` 用法或配置错误；
- 环境变量：`WT_CONFIG` 指定配置文件，`WT_TARGET` 覆盖目标。

### make

```makefile
build:
	npx whatevertools build
apps:
	npx whatevertools doctor --target electron --binary
	npx whatevertools build --target electron --binary --json > release/result.json
```

## 签名和公证

证书、密码、API Key **只从环境变量读**，不要写进配置文件或提交到仓库。缺任何一项时 `wt build --binary` 直接失败，不会悄悄产出一个没签名的包；明确不想签名时在配置里关掉（`sign.mac.identity: false`、`sign.win.mode: 'none'`）。

### macOS

| 环境变量 | 说明 |
|---|---|
| `CSC_LINK` | Developer ID Application 证书（.p12 文件路径或 base64） |
| `CSC_KEY_PASSWORD` | 证书密码 |
| `APPLE_API_KEY` | App Store Connect API Key（**.p8 文件路径**） |
| `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | Key ID / Issuer ID |
| 或 `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` | 用 Apple ID 公证 |
| 或 `APPLE_KEYCHAIN_PROFILE` | `xcrun notarytool store-credentials` 存好的配置名 |

本机钥匙串里有 Developer ID Application 证书时不需要 `CSC_LINK`。开启 hardened runtime，默认 entitlements 是 Electron 需要的最小集合（JIT、可执行内存、加载插件自带的原生模块）。有公证凭据时自动公证。

### Windows

| 方式 | 环境变量 |
|---|---|
| pfx 证书 | `WIN_CSC_LINK`（或 `CSC_LINK`）+ `WIN_CSC_KEY_PASSWORD`（或 `CSC_KEY_PASSWORD`） |
| Azure Trusted Signing | `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET`，配置里写 `sign.win.azure`；需要在 Windows 上构建 |

### Linux

AppImage / deb / tar.gz 不需要代码签名。

## CI

`wt init --ci github` 生成的工作流：推送 `v*` 标签时在 macOS、Windows、Linux 上分别构建，先跑 `doctor`，再 `build --binary --json`，产物上传为 artifact 并挂到 GitHub Release。需要在仓库 Settings → Secrets 里配置：

`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_API_KEY_CONTENT`（.p8 的文件内容，工作流会写成文件）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`，或 Azure 的三个变量。没配的平台就不签名（`doctor` 会提示）。

## Vite 项目

普通 Vite 项目可以用 `@whatevertools/vite`，`vite build` 时直接产出各目标，`vite dev` 时在浏览器里模拟插件环境，见 [@whatevertools/vite](https://github.com/mowtwo/whatevertools/tree/main/packages/vite)。
