// 构建配置：whatevertools.config.{ts,mts,cts,mjs,cjs,js,json}。命令行参数和环境变量（WT_CONFIG、WT_TARGET）可以覆盖。
// 证书、密码、API Key 一律不写进配置，只从环境变量读（见 doctor.ts 和 docs/packaging.md）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { InstallPolicy } from '@whatevertools/core'
import type { Target } from './pack'

export type Platform = 'mac' | 'win' | 'linux'
export type Arch = 'x64' | 'arm64' | 'universal' | 'ia32'

export interface ElectronBinaryConfig {
  /** 各平台的产物格式，默认 mac: dmg+zip，win: nsis+zip，linux: AppImage+tar.gz */
  formats?: Partial<Record<Platform, string[]>>
  /** 架构，默认当前机器的架构 */
  arch?: Arch[]
  /** 应用图标（png 1024×1024 或各平台格式），默认用第一个插件的 logo */
  icon?: string
  appId?: string
  copyright?: string
  /** 直接合并进 electron-builder 配置的字段（高级用法） */
  builder?: Record<string, unknown>
}

export interface SigningConfig {
  mac?: {
    /** 签名身份（证书名）；不写时由 electron-builder 按 CSC_LINK 或钥匙串自动选；false 表示不签名 */
    identity?: string | false
    /** 公证，默认：有 Apple 凭据的环境变量时开启 */
    notarize?: boolean
    /** entitlements 文件，默认用 Electron 需要的最小集合 */
    entitlements?: string
  }
  win?: {
    /** pfx：CSC_LINK / WIN_CSC_LINK + 密码；azure：Azure Trusted Signing；none：不签名。默认按环境变量自动判断 */
    mode?: 'pfx' | 'azure' | 'none'
    azure?: { endpoint: string; certificateProfileName: string; codeSigningAccountName: string; publisherName?: string }
  }
}

export interface WhateverToolsConfig {
  /** 插件目录或插件包（.upx / .asar / .zip），相对配置文件所在目录 */
  plugins: string | string[]
  /** 默认打包目标（命令行 --target / 环境变量 WT_TARGET 可以覆盖），默认 ['utools'] */
  targets?: Target[]
  /** 输出目录，默认 release */
  out?: string
  /** 注入名 / 底座名（electron、web），默认 whatevertools */
  name?: string
  packageName?: string
  productName?: string
  appVersion?: string
  /** 兼容层：utools / utools:别名 / none */
  compat?: string
  host?: { name?: string; version?: string }
  mock?: { platform?: string; version?: string }
  electron?: {
    /** 打包后的应用能不能再动态安装插件包 */
    install?: InstallPolicy
    /** 出安装包（wt build --binary 或这里设 true） */
    binary?: boolean | ElectronBinaryConfig
    sign?: SigningConfig
  }
}

/** 给配置文件用的类型辅助：export default defineConfig({ ... }) */
export function defineConfig(c: WhateverToolsConfig): WhateverToolsConfig {
  return c
}

export const CONFIG_FILES = ['whatevertools.config.ts', 'whatevertools.config.mts', 'whatevertools.config.cts', 'whatevertools.config.mjs', 'whatevertools.config.cjs', 'whatevertools.config.js', 'whatevertools.config.json']

export class ConfigError extends Error {
  readonly code = 'EWTCONFIG'
}

export function findConfig(cwd: string, explicit?: string): string | null {
  const given = explicit ?? process.env.WT_CONFIG
  if (given) {
    const p = path.resolve(cwd, given)
    if (!fs.existsSync(p)) throw new ConfigError(`配置文件不存在：${p}`)
    return p
  }
  for (const f of CONFIG_FILES) {
    const p = path.join(cwd, f)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** 读取配置：json 直接解析；js / ts 用 esbuild 转成 CommonJS 后加载（依赖保持外部引用） */
export async function loadConfig(file: string): Promise<WhateverToolsConfig> {
  let raw: unknown
  if (file.endsWith('.json')) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      throw new ConfigError(`配置文件解析失败：${file}\n${(e as Error).message}`)
    }
  } else {
    const esbuild = require('esbuild')
    const tmp = path.join(os.tmpdir(), `wt-config-${process.pid}-${Date.now()}.cjs`)
    try {
      await esbuild.build({ entryPoints: [file], outfile: tmp, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error', target: 'node18' })
      // 外部依赖从配置文件所在目录解析
      const Module = require('node:module')
      const local = Module.createRequire(file)
      // 项目里没装 @whatevertools/cli（npx / 全局运行）时，用正在运行的这一份
      const req = Object.assign((id: string) => {
        try {
          return local(id)
        } catch (e) {
          if (id === '@whatevertools/cli') return require('./lib')
          throw e
        }
      }, { resolve: local.resolve })
      const mod = { exports: {} as any }
      new Function('module', 'exports', 'require', '__filename', '__dirname', fs.readFileSync(tmp, 'utf8'))(mod, mod.exports, req, file, path.dirname(file))
      raw = mod.exports?.default ?? mod.exports
      if (typeof raw === 'function') raw = await (raw as () => unknown)()
    } catch (e) {
      if (e instanceof ConfigError) throw e
      throw new ConfigError(`配置文件加载失败：${file}\n${(e as Error).message}`)
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  }
  return validateConfig(raw, file)
}

export function validateConfig(raw: unknown, file = '配置'): WhateverToolsConfig {
  const problems: string[] = []
  const c = raw as WhateverToolsConfig
  if (!c || typeof c !== 'object') throw new ConfigError(`${file} 必须导出一个对象`)
  const plugins = Array.isArray(c.plugins) ? c.plugins : [c.plugins]
  if (!plugins.length || plugins.some((p) => typeof p !== 'string' || !p)) problems.push('plugins 必须是插件目录或插件包路径（字符串或字符串数组）')
  for (const t of c.targets ?? []) if (!['utools', 'electron', 'web'].includes(t)) problems.push(`targets 里有不认识的目标：${t}`)
  if (c.name !== undefined && !/^[A-Za-z_$][\w$]*$/.test(c.name)) problems.push(`name 必须是合法的 JS 标识符：${c.name}`)
  const bin = c.electron?.binary
  if (bin && typeof bin === 'object') {
    for (const a of bin.arch ?? []) if (!['x64', 'arm64', 'universal', 'ia32'].includes(a)) problems.push(`electron.binary.arch 里有不认识的架构：${a}`)
  }
  const winMode = c.electron?.sign?.win?.mode
  if (winMode === 'azure' && !c.electron?.sign?.win?.azure) problems.push('electron.sign.win.mode 为 azure 时需要 electron.sign.win.azure（endpoint、certificateProfileName、codeSigningAccountName）')
  if (problems.length) throw new ConfigError(`${file} 有误：\n- ${problems.join('\n- ')}`)
  return c
}

/** 目标：命令行 > 环境变量 WT_TARGET > 配置 > utools */
export function resolveTargets(cli: string | undefined, config?: WhateverToolsConfig): Target[] {
  const raw = cli ?? process.env.WT_TARGET
  const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : config?.targets ?? ['utools']
  for (const t of list) if (!['utools', 'electron', 'web'].includes(t)) throw new ConfigError(`不认识的打包目标：${t}（可选 utools / electron / web）`)
  return list as Target[]
}
