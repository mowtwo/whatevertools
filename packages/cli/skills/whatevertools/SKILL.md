---
name: whatevertools
description: 用 whatevertools 开发、移植、打包启动器类插件（uTools 风格）时使用：把 uTools 插件跑在 Electron / 网页 / 自己的平台上，写同时兼容多端的插件，配置打包（uTools 包、Electron 独立应用和安装包签名、静态网页），在宿主里接入 hook、权限、插件包安装，排查兼容问题。
version: 0.2.0
---

# whatevertools

whatevertools 是启动器类插件的通用运行时：同一个插件（plugin.json + preload + 网页）可以发布到 uTools，也可以打包成 Electron 独立应用、静态网页，或者嵌进你自己的 Electron / 网页宿主。

仓库：https://github.com/mowtwo/whatevertools · 包：`@whatevertools/*`

## 先判断任务类型

| 用户想做的事 | 去看 |
|---|---|
| 把已有 uTools 插件跑在 Electron / 网页上，或者让它同时兼容多端 | [references/porting.md](references/porting.md) |
| 打包、出安装包、签名公证、CI、make | [references/packaging.md](references/packaging.md) |
| 某个 API 在某个平台能不能用 | [references/api-support.md](references/api-support.md)（自动生成，以它为准） |
| 做宿主：在自己的 Electron 应用或网站里运行插件、hook、权限、安装插件包 | [references/hosts.md](references/hosts.md) |

## 核心概念（动手前必须知道）

- **三层 API**：插件可以用 uTools 旧 API（`window.utools`，由兼容层 `@whatevertools/compat-utools` 提供），也可以用原生 API（`window.whatevertools` 或 `getApi()`，按命名空间组织）。两者底层一样，原生 API 名字更中立。
- **Node / Electron 模块**：preload 里 `require('fs')`、`require('electron')` 在 Electron 平台是真模块（经过权限拦截），在网页平台是垫片（虚拟文件系统等）。能不能用、用到什么程度看 api-support。
- **权限**：参考 Chrome，默认询问；只有插件自己的数据库和私有目录默认放行。权限按插件、按作用域（路径前缀、域名）记录。网页平台的虚拟文件、sharp、文件对话框默认放行。
- **targets**：插件在 `whatevertools.json` 写 `"targets": ["utools", "electron"]` 声明只支持哪些目标，打包到其他目标会报错。纯桌面体验（透明置顶悬浮层、桌面挂件）不要声明 web。
- **whatevertools.json**：给兼容层看的补充描述（id、名字、版本、权限用途说明、targets、独立应用配置）。uTools 不读它，不影响 uTools 发布；原生格式插件用它代替 plugin.json（带 `main` 字段）。
- **插件包**：`.upx` 是 gzip 压缩的 asar，可以读写、安装、打包；`.upxs` 是 uTools 加密签名格式，**不能也不要尝试解密**，只能提示用户向作者索取 upx 或源码。

## 工作规则

1. **先查支持程度再写代码**：用到的每个 API 都在 references/api-support.md 里确认目标平台的支持程度（原生 / 模拟 / 部分 / 占位 / 不支持）。不支持的 API 在网页上会抛 `EWTUNSUPPORTED`（宿主可以配置成只警告）。运行时用 `whatevertools.supports(name)` 判断，不要用 `typeof utools.xxx` 猜。
2. **不要编造 API**：只用 api-support.md、仓库 README 和包里的 `.d.ts` 出现过的名字。uTools 官方 API 的行为以 uTools 官方文档为准。
3. **同步 vs 异步**：网页做不到同步弹出文件选择框。新代码用 `dialog.openAsync` / `dialog.saveAsync`（所有平台都有）；兼容旧代码时 `showSaveDialog` 在网页上返回 `/downloads/<文件名>`，写进去的文件会被浏览器下载。
4. **不给 uTools 产物增加体积**：只要类型时装 `@whatevertools/utools`（只有 `.d.ts`）；检测兼容层用 `globalThis[Symbol.for('whatevertools.api')]`，不要在 uTools 构建里引入运行时包。
5. **改宿主行为用 hook，不要改核心代码**：入口、来源、面板、窗口、权限问询、生命周期、提供者、插件安装都有 hook 点（见 hosts.md）。
6. **兼容修复做成适配器包**：给某个平台补能力（比如网页上的 sharp、文件对话框）时，放进单独的适配器包，由运行时接入、宿主可替换，不要写死在运行时里。
7. **凭据只走环境变量**：签名证书、密码、Apple / Azure 凭据不能写进配置文件或提交仓库。
8. **验证**：改完运行 `npx whatevertools check <插件目录>` 看各平台兼容报告；打包后用 `npx whatevertools doctor` 检查环境；能跑测试就跑测试。如实报告哪些没验证。

## 常用命令

```bash
npx whatevertools check ./dist                       # 用到的 API 在 electron / web 上的支持程度
npx whatevertools run ./dist                          # 在裸 Electron 启动器里运行（Alt+Shift+Space 打开主面板）
npx whatevertools init --ci github                    # 生成 whatevertools.config.ts 和 GitHub Actions
npx whatevertools build --target utools,electron,web  # 按配置打包；--binary 出安装包；--json 机器可读
npx whatevertools doctor --target electron --binary   # 检查 electron-builder 和签名凭据
npx whatevertools pack a.upx b/ --target electron --product 工具箱   # 多个插件打成一个应用
npx whatevertools skill                               # 把这个 skill 装进当前项目的 .claude/skills
```

退出码：0 成功，1 失败，2 用法或配置错误。`--json` 时 stdout 只有一行结果。
