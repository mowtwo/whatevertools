# @whatevertools/upx

读写 uTools 插件包（`.upx` = gzip 压缩的 Electron asar）和 asar 归档，Node 与浏览器通用；能识别 uTools 加密签名的 `.upxs`（不解密，直接报错）。

```ts
import { openPackage, createUpx, readAsar, writeAsar, detectPackage } from '@whatevertools/upx'
import { extractPackage, packDirectory } from '@whatevertools/upx/node' // 仅 Node

const pkg = await openPackage(bytes) // { format, files, manifest, missing }
const upx = await createUpx(pkg.files)
```

这是 [whatevertools](https://github.com/mowtwo/whatevertools) 的一部分，用法和架构见仓库 README。

MIT
