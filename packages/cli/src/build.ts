// whatevertools build：按配置打包所有目标；electron 可以继续出安装包。全程非交互，适合 make / CI
import path from 'node:path'
import { pack, type Target } from './pack'
import { buildBinary, type BinaryResult } from './binary'
import type { Platform, WhateverToolsConfig } from './config'
import { hostPlatform } from './signing'

export interface BuildOptions {
  config: WhateverToolsConfig
  /** 配置文件所在目录（相对路径以它为准） */
  root: string
  targets: Target[]
  /** 出安装包（覆盖配置的 electron.binary） */
  binary?: boolean
  /** 安装包平台，默认当前平台 */
  platforms?: Platform[]
  log?: (s: string) => void
}

export interface BuildTargetResult {
  target: Target
  out: string
  binaries?: BinaryResult[]
}

export async function build(o: BuildOptions): Promise<BuildTargetResult[]> {
  const c = o.config
  const log = o.log ?? console.log
  const plugins = (Array.isArray(c.plugins) ? c.plugins : [c.plugins]).map((p) => path.resolve(o.root, p))
  const out = path.resolve(o.root, c.out ?? 'release')
  const results: BuildTargetResult[] = []
  for (const target of o.targets) {
    const r = await pack({
      dir: plugins.length > 1 ? plugins : plugins[0], target, out: path.join(out, target),
      name: c.name, packageName: c.packageName, productName: c.productName, appVersion: c.appVersion, compat: c.compat,
      hostName: c.host?.name, hostVersion: c.host?.version, mockPlatform: c.mock?.platform, mockVersion: c.mock?.version,
      install: c.electron?.install, log,
    })
    const res: BuildTargetResult = { target, out: r.out }
    const binCfg = c.electron?.binary
    // 出安装包要显式开启：--binary 或配置 electron.binary: true（写成对象只是安装包的参数）
    if (target === 'electron' && (o.binary ?? binCfg === true)) {
      res.binaries = await buildBinary({
        appDir: r.out, out: path.join(out, 'binaries'), platforms: o.platforms ?? [hostPlatform()],
        binary: typeof binCfg === 'object' ? binCfg : undefined, sign: c.electron?.sign, log,
      })
    }
    results.push(res)
  }
  return results
}
