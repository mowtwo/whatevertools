// 编程接口（给 @whatevertools/vite、构建脚本用）；命令行入口在 index.ts
export { pack, type PackOptions, type Target } from './pack'
export { printReport, scanUsage } from './report'
export { buildWebRuntime, bundlePreload, findPreloads, injectWebLoader, shimPlugin, type WebLoaderOptions } from './web'
