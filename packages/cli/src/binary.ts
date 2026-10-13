// Electron 安装包：在 wt pack 产出的应用目录上调用 electron-builder（项目里自己装：npm i -D electron-builder）。
// 签名、公证凭据只从环境变量读（CSC_LINK、APPLE_API_KEY…），见 signing.ts。
import fs from 'node:fs'
import path from 'node:path'
import type { Arch, ElectronBinaryConfig, Platform, SigningConfig } from './config'
import { signingStatus, type SigningStatus } from './signing'

export interface BinaryOptions {
  /** wt pack --target electron 产出的应用目录（有 package.json 和 main.js） */
  appDir: string
  /** 安装包输出目录 */
  out: string
  platforms: Platform[]
  binary?: ElectronBinaryConfig
  sign?: SigningConfig
  log?: (s: string) => void
}

export interface BinaryResult {
  platform: Platform
  artifacts: string[]
  signing: SigningStatus
}

const DEFAULT_FORMATS: Record<Platform, string[]> = { mac: ['dmg', 'zip'], win: ['nsis', 'zip'], linux: ['AppImage', 'tar.gz'] }

// Electron 应用在开启 hardened runtime 后需要的最小 entitlements（V8 JIT、加载插件自带的原生模块）
const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
`

/** 找项目里装的 electron-builder（从当前目录、应用目录、cli 自身依次找） */
export function resolveElectronBuilder(appDir: string): string | null {
  for (const base of [process.cwd(), appDir, __dirname]) {
    try {
      return require.resolve('electron-builder', { paths: [base] })
    } catch {}
  }
  return null
}

/** png 的宽高（读 IHDR），不是 png 返回 null */
function pngSize(file: string): { w: number; h: number } | null {
  try {
    const b = fs.readFileSync(file)
    if (b.readUInt32BE(0) !== 0x89504e47) return null
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  } catch {
    return null
  }
}

function currentArch(): Arch {
  return process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
}

/** 生成 electron-builder 配置（不含凭据） */
export function builderConfig(appDir: string, o: Pick<BinaryOptions, 'binary' | 'sign' | 'log'>, statuses: Partial<Record<Platform, SigningStatus>>): Record<string, any> {
  const log = o.log ?? (() => {})
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
  const bin = o.binary ?? {}
  const arch = bin.arch ?? [currentArch()]
  const formats = { ...DEFAULT_FORMATS, ...bin.formats }
  const res = path.join(appDir, 'build')
  fs.mkdirSync(res, { recursive: true })
  const entitlements = o.sign?.mac?.entitlements ? path.resolve(o.sign.mac.entitlements) : path.join(res, 'entitlements.mac.plist')
  if (!o.sign?.mac?.entitlements) fs.writeFileSync(entitlements, ENTITLEMENTS)

  // 图标：配置给的，或者第一个插件的 logo；electron-builder 要求至少 512×512
  let icon: string | undefined
  const candidates = [bin.icon && path.resolve(bin.icon), ...['plugin', ...(fs.existsSync(path.join(appDir, 'plugins')) ? fs.readdirSync(path.join(appDir, 'plugins')).map((d) => `plugins/${d}`) : [])].map((d) => {
    const m = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(appDir, d, 'plugin.json'), 'utf8')).logo ?? JSON.parse(fs.readFileSync(path.join(appDir, d, 'whatevertools.json'), 'utf8')).logo
      } catch {
        return undefined
      }
    })()
    return m ? path.join(appDir, d, m) : undefined
  })].filter((x): x is string => !!x && fs.existsSync(x))
  for (const c of candidates) {
    const s = pngSize(c)
    if (!s || (s.w >= 512 && s.h >= 512)) {
      icon = path.join(res, 'icon' + path.extname(c))
      fs.copyFileSync(c, icon)
      break
    }
    log(`注意：图标 ${path.basename(c)} 只有 ${s.w}×${s.h}，electron-builder 要求至少 512×512，用默认图标（可以在配置 electron.binary.icon 指定）`)
  }

  const target = (p: Platform) => formats[p].map((t) => ({ target: t, arch: p === 'mac' || p === 'win' || p === 'linux' ? arch.filter((a) => (p === 'mac' ? a !== 'ia32' : a !== 'universal')) : arch }))
  const mac = statuses.mac
  const win = statuses.win
  const azure = o.sign?.win?.azure
  return {
    ...pkg.build,
    appId: bin.appId ?? pkg.build?.appId,
    productName: pkg.productName,
    copyright: bin.copyright ?? pkg.build?.copyright,
    directories: { buildResources: 'build', output: 'dist' },
    // 依赖已经在 node_modules 里拷好了，不要重新安装或编译
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    ...(icon ? { icon } : {}),
    mac: {
      ...pkg.build?.mac,
      target: target('mac'),
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements,
      entitlementsInherit: entitlements,
      identity: mac && !mac.sign ? null : typeof o.sign?.mac?.identity === 'string' ? o.sign.mac.identity : undefined,
      notarize: !!mac?.notarize,
    },
    win: {
      target: target('win'),
      ...(win?.sign && win.method === 'Azure Trusted Signing' && azure ? { azureSignOptions: { endpoint: azure.endpoint, certificateProfileName: azure.certificateProfileName, codeSigningAccountName: azure.codeSigningAccountName, ...(azure.publisherName ? { publisherName: azure.publisherName } : {}) } } : {}),
    },
    linux: { target: target('linux'), category: 'Utility' },
    ...bin.builder,
  }
}

/** 出安装包；凭据缺失时直接报错（不会悄悄出一个没签名的包） */
export async function buildBinary(o: BinaryOptions): Promise<BinaryResult[]> {
  const log = o.log ?? console.log
  const ebPath = resolveElectronBuilder(o.appDir)
  if (!ebPath) throw Object.assign(new Error('出安装包需要 electron-builder：在项目里运行 npm i -D electron-builder'), { code: 'EWTBUILDER' })
  const statuses: Partial<Record<Platform, SigningStatus>> = {}
  for (const p of o.platforms) {
    const s = signingStatus(p, o.sign)
    if (s.missing.length) throw Object.assign(new Error(`${p} 签名配置不完整：\n- ${s.missing.join('\n- ')}\n（运行 whatevertools doctor 查看详情；不想签名可以在配置里关闭）`), { code: 'EWTSIGN' })
    for (const n of s.notes) log(`注意（${p}）：${n}`)
    statuses[p] = s
  }
  const config = builderConfig(o.appDir, o, statuses)
  const eb = require(ebPath)
  const results: BinaryResult[] = []
  const env = { ...process.env }
  // mac 不签名时关掉证书自动发现，否则 electron-builder 会去钥匙串里找
  if (statuses.mac && !statuses.mac.sign) process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  try {
    for (const p of o.platforms) {
      const platform = p === 'mac' ? eb.Platform.MAC : p === 'win' ? eb.Platform.WINDOWS : eb.Platform.LINUX
      log(`出安装包：${p}（${statuses[p]!.method}${statuses[p]!.notarize ? '，公证' : ''}）`)
      const artifacts: string[] = await eb.build({ projectDir: o.appDir, targets: platform.createTarget(), config, publish: 'never' })
      fs.mkdirSync(o.out, { recursive: true })
      const moved = artifacts.filter((a) => !a.endsWith('.blockmap') && fs.existsSync(a)).map((a) => {
        const dst = path.join(o.out, path.basename(a))
        fs.copyFileSync(a, dst)
        return dst
      })
      results.push({ platform: p, artifacts: moved, signing: statuses[p]! })
    }
  } finally {
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = env.CSC_IDENTITY_AUTO_DISCOVERY
    if (env.CSC_IDENTITY_AUTO_DISCOVERY === undefined) delete process.env.CSC_IDENTITY_AUTO_DISCOVERY
  }
  return results
}
