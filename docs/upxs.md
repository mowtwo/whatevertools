# 关于 `.upxs`（为什么不支持）

whatevertools 支持 `.upx`（gzip + asar）、`.asar`、`.zip` 这些**开放**的插件包格式，但**不支持 uTools 的 `.upxs`**。

## `.upxs` 是什么

`.upxs` 是 uTools 应用市场分发插件用的**加密**安装包。它整个文件都是密文（熵接近 8，没有任何可识别的明文或可解压流），只能由 uTools 客户端安装。`.upx` 则是未加密的插件包，whatevertools 可以直接读写。

## 为什么 whatevertools 不支持

- **它是 uTools 的分发与商业体系的一部分。** uTools 市场里有免费插件，也有会员 / 付费插件，付费校验由 uTools 的服务器负责。whatevertools 是一个平台无关的插件兼容层，不打算介入 uTools 的分发链路，更不会去绕过任何付费或会员校验。
- **格式不开放、会变。** `.upxs` 的加密细节属于 uTools，随版本变化。把它纳入支持范围意味着持续追着一个闭源、加密、随时可能变的格式跑，这和 whatevertools「面向开放格式、平台无关」的定位相悖。

## 你应该怎么做

拿到的是 `.upxs`，但想用 whatevertools 跑 / 打包 / 移植,有两条正路：

1. **找作者要 `.upx` 或源码目录。** 如果插件是你自己的，用 whatevertools 直接从源码目录或 `.upx` 走三端打包即可，根本不需要 `.upxs`。
2. **先用 uTools 安装，再用安装后的目录。** uTools 安装 `.upxs` 后，插件在本机是以**标准 asar** 落盘的；那份 asar 是开放格式，whatevertools 能正常读。

whatevertools 遇到 `.upxs` 会直接报一个明确的错误（`EncryptedPackageError`），不会尝试解密。
