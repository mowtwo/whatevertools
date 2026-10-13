// Node 专用：读文件、解包到目录、把插件目录打成 upx
import fs from 'node:fs'
import path from 'node:path'
import { PackageError } from './errors'
import { createUpx, openPackage, type PluginManifestInfo } from './package'

export async function readPackageFile(file: string): Promise<Uint8Array> {
  const b = await fs.promises.readFile(file)
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}

export interface ExtractOptions {
  /** 目标目录非空时是否覆盖写入 */
  overwrite?: boolean
}

/** 解包到 destDir；拒绝逃出目录的条目 */
export async function extractPackage(src: Uint8Array | string, destDir: string, opts: ExtractOptions = {}): Promise<{ dir: string; manifest: PluginManifestInfo }> {
  const bytes = typeof src === 'string' ? await readPackageFile(src) : src
  const pkg = await openPackage(bytes, { name: typeof src === 'string' ? path.basename(src) : undefined })
  const root = path.resolve(destDir)
  if (!opts.overwrite) {
    const existing = await fs.promises.readdir(root).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))
    if (existing.length) throw new PackageError('EEXIST', `目标目录不为空：${root}（需要 overwrite）`)
  }
  // 先全部校验再写，避免写一半
  const targets: Array<[string, Uint8Array]> = []
  for (const [rel, data] of pkg.files) {
    const t = path.resolve(root, ...rel.split('/'))
    if (!t.startsWith(root + path.sep)) throw new PackageError('EUNSAFEPATH', `条目逃出目标目录：${rel}`)
    targets.push([t, data])
  }
  await fs.promises.mkdir(root, { recursive: true })
  for (const [t, data] of targets) {
    await fs.promises.mkdir(path.dirname(t), { recursive: true })
    await fs.promises.writeFile(t, data)
  }
  return { dir: root, manifest: pkg.manifest }
}

export interface PackOptions {
  /** 额外排除（相对路径，/ 分隔）；默认总是排除 *.map 和 .DS_Store */
  exclude?: (rel: string) => boolean
}

const defaultExclude = (rel: string) => rel.endsWith('.map') || rel.split('/').pop() === '.DS_Store'

/** 把插件目录打成 upx；符号链接目录跳过（防环），文件按内容收录 */
export async function packDirectory(dir: string, opts: PackOptions = {}): Promise<Uint8Array> {
  const root = path.resolve(dir)
  const files = new Map<string, Uint8Array>()
  const exec = new Set<string>()
  const walk = async (abs: string, rel: string) => {
    for (const ent of await fs.promises.readdir(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (defaultExclude(r) || opts.exclude?.(r)) continue
      const full = path.join(abs, ent.name)
      if (ent.isDirectory()) await walk(full, r)
      else if (ent.isFile() || ent.isSymbolicLink()) {
        const st = await fs.promises.stat(full).catch(() => null)
        if (!st?.isFile()) continue
        files.set(r, await readPackageFile(full))
        if (process.platform !== 'win32' && st.mode & 0o111) exec.add(r)
      }
    }
  }
  await walk(root, '')
  if (!files.has('plugin.json') && !files.has('whatevertools.json')) throw new PackageError('EMANIFEST', `${root} 下没有 plugin.json 或 whatevertools.json`)
  return createUpx(files, { executable: (p) => exec.has(p) })
}
