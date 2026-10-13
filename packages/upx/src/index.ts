// 浏览器安全入口：不静态引用任何 Node 内置模块
export { readAsar, writeAsar, looksLikeAsar } from './asar'
export type { AsarArchive, AsarEntry, AsarNode, AsarFileNode, AsarDirNode, AsarLinkNode, WriteAsarOptions } from './asar'
export { gzip, gunzip } from './gzip'
export { readZip } from './zip'
export { detectPackage, openPackage, createUpx } from './package'
export type { PackageFormat, DetectOptions, PluginPackage, PluginManifestInfo } from './package'
export { EncryptedPackageError, PackageError, normalizeEntryPath } from './errors'
