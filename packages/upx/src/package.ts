// 插件包：识别格式、解开为文件表、读取清单；以及生成 upx
import { looksLikeAsar, readAsar, writeAsar, type WriteAsarOptions } from './asar'
import { EncryptedPackageError, PackageError } from './errors'
import { gunzip, gzip } from './gzip'
import { readZip } from './zip'

export type PackageFormat = 'upx' | 'upxs' | 'asar' | 'zip' | 'unknown'

export interface DetectOptions {
  /** 文件名或扩展名提示（如 'foo.upxs'） */
  name?: string
}

/** 字节直方图的香农熵（bit/byte） */
function entropy(b: Uint8Array): number {
  if (!b.length) return 0
  const h = new Uint32Array(256)
  for (let i = 0; i < b.length; i++) h[b[i]]++
  let e = 0
  for (const c of h) if (c) e -= (c / b.length) * Math.log2(c / b.length)
  return e
}

const hasExt = (name: string | undefined, ext: string) => !!name && name.toLowerCase().endsWith(ext)

/** 按魔数识别包格式；upxs 没有魔数，只能靠扩展名提示或高熵判断 */
export function detectPackage(bytes: Uint8Array, opts: DetectOptions = {}): PackageFormat {
  if (bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) return 'upx'
  if (looksLikeAsar(bytes)) return 'asar'
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'
  if (bytes.length >= 64) {
    const e = entropy(bytes.subarray(0, 65536))
    if ((hasExt(opts.name, '.upxs') && e > 7) || e > 7.9) return 'upxs'
  }
  return 'unknown'
}

export interface PluginManifestInfo {
  kind: 'utools' | 'native'
  json: Record<string, any>
}

export interface PluginPackage {
  format: Exclude<PackageFormat, 'unknown' | 'upxs'>
  files: Map<string, Uint8Array>
  manifest: PluginManifestInfo
  /** 归档里登记了但读不到的文件（asar unpacked） */
  missing: string[]
}

function parseJson(files: Map<string, Uint8Array>, name: string): Record<string, any> | undefined {
  const b = files.get(name)
  if (!b) return undefined
  let j: unknown
  try {
    j = JSON.parse(new TextDecoder().decode(b).replace(/^﻿/, ''))
  } catch (e: any) {
    throw new PackageError('EMANIFEST', `${name} 不是合法 JSON：${e?.message ?? e}`)
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new PackageError('EMANIFEST', `${name} 必须是 JSON 对象`)
  return j as Record<string, any>
}

const MANIFESTS = ['whatevertools.json', 'plugin.json']

/** 只有一个顶层目录且其中有清单时，去掉这层前缀 */
function stripSingleRoot(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  if (MANIFESTS.some((m) => files.has(m))) return files
  const tops = new Set<string>()
  for (const p of files.keys()) {
    const i = p.indexOf('/')
    tops.add(i < 0 ? '' : p.slice(0, i))
    if (tops.size > 1) return files
  }
  const [top] = tops
  if (!top || !MANIFESTS.some((m) => files.has(`${top}/${m}`))) return files
  const out = new Map<string, Uint8Array>()
  for (const [p, d] of files) out.set(p.slice(top.length + 1), d)
  return out
}

/** 读取清单：先原生 whatevertools.json（需 main），再 uTools plugin.json */
function readManifest(files: Map<string, Uint8Array>): PluginManifestInfo {
  const native = parseJson(files, 'whatevertools.json')
  if (native && native.main) return { kind: 'native', json: native }
  const utools = parseJson(files, 'plugin.json')
  if (utools) return { kind: 'utools', json: utools }
  throw new PackageError('EMANIFEST', '包里没有找到插件清单（plugin.json 或带 main 字段的 whatevertools.json）')
}

/** 打开插件包：upx / asar / zip；upxs 抛 EncryptedPackageError */
export async function openPackage(bytes: Uint8Array, opts: DetectOptions = {}): Promise<PluginPackage> {
  const format = detectPackage(bytes, opts)
  let files: Map<string, Uint8Array>
  let missing: string[] = []
  const fromAsar = (b: Uint8Array) => {
    const a = readAsar(b)
    missing = a.list().filter((e) => e.unpacked).map((e) => e.path)
    return a.files()
  }
  switch (format) {
    case 'upxs':
      throw new EncryptedPackageError()
    case 'upx': {
      const inner = await gunzip(bytes)
      if (!looksLikeAsar(inner)) throw new PackageError('EBADUPX', 'upx 解压后不是 asar 归档')
      files = fromAsar(inner)
      break
    }
    case 'asar':
      files = fromAsar(bytes)
      break
    case 'zip':
      files = await readZip(bytes)
      break
    default:
      if (hasExt(opts.name, '.upxs')) throw new EncryptedPackageError()
      throw new PackageError('EUNKNOWNFORMAT', '无法识别的包格式（支持 upx / asar / zip）')
  }
  files = stripSingleRoot(files)
  return { format, files, manifest: readManifest(files), missing }
}

/** 生成 upx：gzip(asar) */
export async function createUpx(files: Map<string, Uint8Array> | Record<string, Uint8Array>, opts?: WriteAsarOptions): Promise<Uint8Array> {
  return gzip(writeAsar(files, opts))
}
