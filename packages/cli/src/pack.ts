// 打包：utools（原样输出，零运行时）/ electron（独立应用）/ web（静态站点）
import fs from 'node:fs'
import path from 'node:path'
import { loadManifest, nativeManifestLoader, RUNTIME_VERSION, supportsTarget, type PluginManifest } from '@whatevertools/core'
import { utoolsManifestLoader } from '@whatevertools/compat-utools'
import { printReport, scanUsage, walk } from './report'
import { buildWebRuntime, bundlePreload, findPreloads, injectWebLoader } from './web'

export type Target = 'utools' | 'electron' | 'web'

export interface PackOptions {
  dir: string
  target: Target
  out?: string
  /** 原生 API 注入名 + 底座名 + 包名（electron / web），默认 whatevertools */
  name?: string
  /** 输出包名（默认 = name 或插件 id） */
  packageName?: string
  /** 应用显示名（默认插件名） */
  productName?: string
  /** 兼容层：utools / utools:别名 / none（默认 utools） */
  compat?: string
  /** 宿主身份（任意字符串） */
  hostName?: string
  hostVersion?: string
  /** 伪装平台（给旧插件的 getAppName / getAppVersion） */
  mockPlatform?: string
  mockVersion?: string
  log?: (s: string) => void
}

/** 运行时包的目录（monorepo 里是 packages/<name>，装好的 cli 里是依赖） */
const pkgDir = (name: string) => path.dirname(require.resolve(`@whatevertools/${name}/package.json`))

/** 完整拷贝目录（包括 node_modules 和点开头的文件，preload 的依赖在里面），filter 收到相对路径 */
function copyDir(src: string, dst: string, filter: (rel: string) => boolean = () => true) {
  fs.cpSync(src, dst, {
    recursive: true,
    dereference: true,
    filter: (from) => {
      const rel = path.relative(src, from).replace(/\\/g, '/')
      return rel === '' || filter(rel)
    },
  })
}

function readJson(f: string) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return undefined
  }
}

function safeName(s: string) {
  return s.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
}

function compatLayers(spec = 'utools') {
  if (spec === 'none') return []
  return spec.split(',').map((s) => {
    const [type, name] = s.split(':')
    if (type !== 'utools') throw new Error(`不支持的兼容层：${type}`)
    return { type: 'utools' as const, name: name || undefined }
  })
}

export async function pack(o: PackOptions) {
  const log = o.log ?? console.log
  const dir = path.resolve(o.dir)
  const manifestFiles: Record<string, unknown> = {}
  for (const f of ['plugin.json', 'whatevertools.json', 'package.json']) {
    const v = readJson(path.join(dir, f)) ?? (f !== 'plugin.json' ? readJson(path.join(dir, '..', f)) : undefined)
    if (v !== undefined) manifestFiles[f] = v
  }
  const manifest = loadManifest([nativeManifestLoader, utoolsManifestLoader], { dir, files: manifestFiles })
  if (!supportsTarget(manifest, o.target)) throw new Error(`${manifest.name} 声明只支持 ${manifest.targets!.join(' / ')}，不能打包成 ${o.target}（见 whatevertools.json 的 targets）`)
  const name = o.name ?? 'whatevertools'
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`--name 必须是合法的 JS 标识符（会作为全局变量名注入）：${name}`)
  const pkgName = safeName(o.packageName ?? (o.name ? `${o.name}-${manifest.id}` : manifest.id))
  const product = o.productName ?? manifest.name
  const out = path.resolve(o.out ?? path.join(dir, '..', 'release', o.target))
  const usage = scanUsage(dir, name)
  log(`插件 ${manifest.name}（${manifest.id}@${manifest.version}）→ ${o.target}`)
  log(printReport(usage, o.target))
  if (o.target === 'utools') return packUtools(dir, out, manifest, log)
  const identity = {
    runtimeName: name,
    host: { name: o.hostName ?? product, version: o.hostVersion ?? manifest.version },
    mock: { platform: { name: o.mockPlatform ?? 'uTools', version: o.mockVersion ?? '7.0.0' }, runtime: { name, version: RUNTIME_VERSION } },
  }
  const compat = compatLayers(o.compat)
  if (o.target === 'electron') return packElectron({ dir, out: path.join(out, pkgName), manifest, name, pkgName, product, identity, compat, log })
  return packWeb({ dir, out: path.join(out, pkgName), manifest, name, pkgName, product, identity, compat, manifestFiles, log })
}

// ---------- utools ----------

function packUtools(dir: string, out: string, manifest: PluginManifest, log: (s: string) => void) {
  if (manifest.format !== 'utools') throw new Error('utools 目标需要 plugin.json（这个插件是原生格式）')
  const problems: string[] = []
  // 声明的工具必须有同名 registerTool
  const code = walk(dir, (f) => f.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  for (const t of Object.keys(manifest.tools)) {
    if (!code.includes(t)) problems.push(`tools.${t} 没有找到对应的 registerTool('${t}')`)
  }
  // 每个功能最多 5 个功能指令
  for (const f of manifest.features) if (f.cmds.filter((c) => typeof c === 'string').length > 5) problems.push(`功能 ${f.code} 的功能指令超过 5 个（多出的会被忽略）`)
  if (fs.existsSync(path.join(dir, 'whatevertools.json'))) log('注意：插件目录里的 whatevertools.json 不会进入 uTools 输出')
  fs.rmSync(out, { recursive: true, force: true })
  copyDir(dir, out, (rel) => rel !== 'whatevertools.json' && !rel.endsWith('.map'))
  for (const p of problems) log(`警告：${p}`)
  log(`已输出到 ${out}（在 uTools 开发者工具里选择这个目录下的 plugin.json 即可）`)
  return { out, problems }
}

// ---------- electron ----------

interface BuildCtx {
  dir: string
  out: string
  manifest: PluginManifest
  name: string
  pkgName: string
  product: string
  identity: Record<string, unknown>
  compat: Array<{ type: 'utools'; name?: string }>
  log: (s: string) => void
}

/** 运行时需要的包（electron 目标），按依赖顺序 */
const ELECTRON_RUNTIME = ['core', 'api', 'compat-utools', 'db-file', 'electron']

function resolvePkg(name: string): string | null {
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [pkgDir('electron'), __dirname] }))
  } catch {
    return null
  }
}

/** 递归拷贝这些包的第三方 dependencies（扁平放进 node_modules，不带它们自己的 node_modules） */
function copyThirdPartyDeps(dirs: string[], nodeModules: string) {
  const seen = new Set<string>()
  const queue = [...dirs]
  while (queue.length) {
    const from = queue.shift()!
    for (const dep of Object.keys(readJson(path.join(from, 'package.json'))?.dependencies ?? {})) {
      if (dep.startsWith('@whatevertools/') || seen.has(dep)) continue
      seen.add(dep)
      let dir: string
      try {
        dir = path.dirname(require.resolve(`${dep}/package.json`, { paths: [from] }))
      } catch {
        throw new Error(`找不到 ${dep}（${from} 的依赖），先在这个项目里安装依赖`)
      }
      copyDir(dir, path.join(nodeModules, dep), (rel) => !/^node_modules(\/|$)/.test(rel))
      queue.push(dir)
    }
  }
}

function packElectron(c: BuildCtx) {
  fs.rmSync(c.out, { recursive: true, force: true })
  copyDir(c.dir, path.join(c.out, 'plugin'), (rel) => !rel.endsWith('.map'))
  // 固定插件身份（目录名变成了 plugin，id 不能再从目录名推断）
  const fj = path.join(c.out, 'plugin', 'whatevertools.json')
  const prev = readJson(fj) ?? {}
  fs.writeFileSync(fj, JSON.stringify({ ...prev, id: c.manifest.id, name: c.manifest.name, version: c.manifest.version }, null, 2))
  // 运行时包：只拷 dist / assets / package.json；它们的第三方依赖（pinyin-pro 等）整包拷过去
  const runtimeFile = (rel: string) => rel === 'package.json' || /^(dist|assets)(\/|$)/.test(rel)
  for (const p of ELECTRON_RUNTIME) copyDir(pkgDir(p), path.join(c.out, 'node_modules', '@whatevertools', p), runtimeFile)
  copyThirdPartyDeps(ELECTRON_RUNTIME.map(pkgDir), path.join(c.out, 'node_modules'))
  // sharp（原生模块，按当前平台）
  const sharp = resolvePkg('sharp')
  if (sharp) {
    copyDir(sharp, path.join(c.out, 'node_modules', 'sharp'))
    const imgDir = path.join(path.dirname(sharp), '@img')
    const pnpmImg = path.resolve(sharp, '..', '@img')
    for (const base of [imgDir, pnpmImg]) {
      if (!fs.existsSync(base)) continue
      for (const d of fs.readdirSync(base)) copyDir(path.join(base, d), path.join(c.out, 'node_modules', '@img', d))
    }
    for (const dep of ['detect-libc', 'semver', 'color', 'color-string', 'color-convert', 'color-name', 'simple-swizzle', 'is-arrayish']) {
      const d = resolvePkg(dep) ?? (() => {
        try {
          return path.dirname(require.resolve(`${dep}/package.json`, { paths: [sharp] }))
        } catch {
          return null
        }
      })()
      if (d) copyDir(d, path.join(c.out, 'node_modules', dep))
    }
  } else c.log('注意：没有找到 sharp，打包出的应用里 image.sharp 不可用')
  const electronVersion = (() => {
    try {
      return readJson(require.resolve('electron/package.json'))?.version
    } catch {
      return undefined
    }
  })() ?? '43.7.9'
  fs.writeFileSync(path.join(c.out, 'package.json'), JSON.stringify({
    name: c.pkgName,
    productName: c.product,
    version: c.manifest.version,
    description: c.manifest.description,
    private: true,
    main: 'main.js',
    scripts: { start: 'electron .', dist: 'electron-builder' },
    devDependencies: { electron: electronVersion, 'electron-builder': '^26.0.0' },
    build: {
      appId: c.manifest.standalone.appId ?? `app.${c.name}.${c.manifest.id}`.replace(/[^a-zA-Z0-9.-]/g, '-'),
      productName: c.product,
      files: ['main.js', 'plugin/**', 'node_modules/**', 'package.json'],
      asarUnpack: ['node_modules/sharp/**', 'node_modules/@img/**'],
      mac: { category: 'public.app-category.productivity' },
    },
  }, null, 2))
  fs.writeFileSync(path.join(c.out, 'main.js'), `// 由 whatevertools pack 生成：独立应用入口
const path = require('node:path')
const { runApp } = require('@whatevertools/electron')

runApp({
  mode: 'standalone',
  plugins: [path.join(__dirname, 'plugin')],
  apiName: ${JSON.stringify(c.name)},
  compat: ${JSON.stringify(c.compat.map((x) => ({ module: '@whatevertools/compat-utools', name: x.name })))},
  identity: ${JSON.stringify(c.identity)},
  appName: ${JSON.stringify(c.product)},
  mcp: { enabled: false },
}).catch((e) => {
  console.error(e)
  require('electron').app.exit(1)
})
`)
  c.log(`已输出到 ${c.out}`)
  c.log(`  运行：cd "${c.out}" && npx electron .`)
  c.log(`  打安装包：npm install && npm run dist`)
  return { out: c.out }
}

// ---------- web ----------

interface WebCtx extends BuildCtx {
  manifestFiles: Record<string, any>
}

/** 把 require('fs') 等 Node 内置模块和 electron 指向运行时垫片 */
async function packWeb(c: WebCtx) {
  fs.rmSync(c.out, { recursive: true, force: true })
  const preloads = findPreloads(c.dir, c.manifest.preload)
  // 插件文件（preload 和 node_modules 除外：preload 会打包成浏览器脚本）
  copyDir(c.dir, c.out, (rel) => !rel.endsWith('.map') && !rel.startsWith('node_modules/') && !preloads.includes(rel.replace(/\\/g, '/')))
  // 运行时
  const runtimeFile = `${c.name}-runtime.js`
  fs.writeFileSync(path.join(c.out, runtimeFile), await buildWebRuntime(c.name))
  // preload：CommonJS → 浏览器脚本，Node / electron 模块走垫片
  const preloadMap: Record<string, string> = {}
  for (const rel of preloads) {
    const outRel = `${c.name}-preload/${rel.replace(/\.js$/, '')}.js`
    fs.mkdirSync(path.dirname(path.join(c.out, outRel)), { recursive: true })
    fs.writeFileSync(path.join(c.out, outRel), await bundlePreload(c.dir, rel))
    preloadMap[rel] = outRel
  }
  // 插件文件清单（挂进虚拟文件系统 /plugin）
  const files: Record<string, number> = {}
  for (const f of walk(c.dir, () => true)) {
    const rel = path.relative(c.dir, f).replace(/\\/g, '/')
    if (rel.startsWith('node_modules/') || rel.endsWith('.map')) continue
    files[rel] = fs.statSync(f).size
  }
  const config = {
    manifestFiles: { ...c.manifestFiles, ...(c.manifestFiles['package.json'] ? { 'package.json': { name: c.manifestFiles['package.json'].name, version: c.manifestFiles['package.json'].version, productName: c.manifestFiles['package.json'].productName } } : {}) },
    apiName: c.name, compat: c.compat, identity: c.identity, files, preloads: preloadMap,
  }
  fs.writeFileSync(path.join(c.out, `${c.name}.config.json`), JSON.stringify(config))
  // 所有 html：先跑运行时，页面原有脚本推迟到 boot 完成后按顺序执行
  for (const f of walk(c.out, (x) => x.endsWith('.html'))) {
    const rel = path.relative(c.out, f)
    const up = path.posix.relative(path.posix.dirname(rel.replace(/\\/g, '/')), '.') || '.'
    const html = injectWebLoader(fs.readFileSync(f, 'utf8'), { name: c.name, runtimeSrc: `${up}/${runtimeFile}`, base: up + '/', configUrl: `${c.name}.config.json` })
    fs.writeFileSync(f, html)
  }
  fs.writeFileSync(path.join(c.out, 'package.json'), JSON.stringify({ name: c.pkgName, version: c.manifest.version, private: true, description: `${c.product}（web）` }, null, 2))
  c.log(`已输出到 ${c.out}`)
  c.log(`  预览：npx serve "${c.out}"（需要通过 http 访问，不能直接双击 html）`)
  return { out: c.out }
}
