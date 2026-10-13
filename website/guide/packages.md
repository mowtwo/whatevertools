# 插件包（upx）

| 格式 | 是什么 | 支持 |
|---|---|---|
| `.upx` | gzip 压缩的 asar 归档（uTools 的离线插件包） | 读、写、安装、打包 |
| `.asar` | Electron 归档（uTools 本地安装的插件就是这个格式） | 读、写、安装、打包 |
| `.zip` | 普通压缩包（store / deflate） | 读、安装、打包 |
| `.upxs` | uTools 加密并签名的安装包 | **不支持**：只能由 uTools 安装，请向作者索取 upx 或源码 |

> 需要独立加载、调试一个已经打成 `.upxs` 的开发者包？另有一个与核心分开的调试工具 [whatevertools Inspector](https://github.com/mowtwo/whatevertools-inspector/releases)（macOS，版本不稳定，仅针对离线开发者包，不公开解密细节，也不绕过任何付费校验）。whatevertools 核心本身仍不支持 `.upxs`。

## 兼容安装模式

加了 SDK 的平台可以动态安装任意插件包，策略可配：

```ts
install: {
  enabled: true,
  max: 10,                 // 最多装几个（升级不算新增）
  allow: ['acme-*'],       // 只允许这些 id
  deny: ['bad-*'],         // 禁止这些 id（优先于 allow）
  formats: ['upx', 'asar'],
  confirm: true,           // 安装前让用户确认（显示名字、版本、插件声明的权限用途）
}
```

- **Electron**：`host.installer.install(file)` / `uninstall(id)` / `list()`；装进数据目录，重启自动加载，同 id 再装就是升级。启动器默认允许安装，独立应用默认不允许。
- **网页**：`@whatevertools/web-host` 的 `install(file)`，文件存进 IndexedDB，由 Service Worker 提供，见 [给网站加插件](./web-host)。
- **自定义审核**：`plugin:install` hook 返回 `false` 拒绝安装，可以接签名校验、白名单服务或你自己的确认界面。

## 固定打包模式

一个或几个插件直接打成一个产物，用户拿到就能用：

```bash
# 一个 upx 打成 Electron 独立应用 / 网页
npx whatevertools pack ./translate.upx --target electron
npx whatevertools pack ./translate.upx --target web

# 几个插件打成一个「工具箱」应用（启动器模式）或一个带入口页的网站
npx whatevertools pack ocr.upx translate.upx ./my-plugin --target electron --product 工具箱 --package toolbox
npx whatevertools pack ocr.upx translate.upx --target web --product 工具箱 --package toolbox

# 打包后的应用还允许用户再装插件
npx whatevertools pack a.upx b.upx --target electron --product 工具箱 --allow-install --max-plugins 20
```

## 编程接口

```ts
import { openPackage, createUpx, readAsar, writeAsar } from '@whatevertools/upx'        // 浏览器和 Node 都能用
import { extractPackage, packDirectory } from '@whatevertools/upx/node'

const pkg = await openPackage(bytes, { name: 'x.upx' })   // { format, files, manifest }
const upx = await packDirectory('./dist')                 // 插件目录 → .upx
```
