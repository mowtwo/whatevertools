// Vite 插件：
//   - vite build：把 whatevertools.json 写进产物（身份、权限说明、targets、独立应用配置），按 targets 打包成 uTools / Electron / 网页
//   - vite dev：在普通浏览器里模拟插件环境（注入 web 运行时、打包 preload、window.utools 可用），不用开 uTools 也能调界面
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite' with { 'resolution-mode': 'import' }
import { buildWebRuntime, bundlePreload, findPreloads, injectWebLoader, pack, type Target } from '@whatevertools/cli'
import type { WhateverToolsJson } from '@whatevertools/core'

export interface WhateverToolsPluginOptions {
  /** 构建完成后打包的目标；不写就读环境变量 WT_TARGET（逗号分隔），都没有则只写 whatevertools.json */
  targets?: Target | Target[]
  /** 写进产物 whatevertools.json 的内容；version 默认取 package.json */
  manifest?: WhateverToolsJson
  /** 打包输出目录，默认 <root>/release */
  out?: string
  /** 注入名 / 底座名 / 包名（electron、web 目标），默认 whatevertools */
  name?: string
  packageName?: string
  productName?: string
  /** 兼容层：utools / utools:别名 / none（默认 utools） */
  compat?: string
  hostName?: string
  hostVersion?: string
  mockPlatform?: string
  mockVersion?: string
  /** vite dev 时在浏览器里模拟插件环境，默认 true */
  devRuntime?: boolean
}

const ROUTE = '/__whatevertools/'

function readJson(f: string) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return undefined
  }
}

function listFiles(dir: string, base = dir, out: Record<string, number> = {}) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listFiles(p, base, out)
    else if (!e.name.endsWith('.map')) out[path.relative(base, p).replace(/\\/g, '/')] = fs.statSync(p).size
  }
  return out
}

function targetsOf(o: WhateverToolsPluginOptions): Target[] {
  const t = o.targets ?? (process.env.WT_TARGET ? process.env.WT_TARGET.split(',').map((s) => s.trim()).filter(Boolean) : [])
  const list = (Array.isArray(t) ? t : [t]) as Target[]
  for (const x of list) if (!['utools', 'electron', 'web'].includes(x)) throw new Error(`[whatevertools] 不认识的打包目标：${x}（可选 utools / electron / web）`)
  return list
}

export function whatevertools(options: WhateverToolsPluginOptions = {}): Plugin {
  let config: ResolvedConfig
  const name = options.name ?? 'whatevertools'
  const manifestOf = () => {
    if (!options.manifest) return undefined
    const pkg = readJson(path.join(config.root, 'package.json')) ?? {}
    return { version: pkg.version, description: pkg.description, ...options.manifest }
  }

  return {
    name: 'whatevertools',

    configResolved(c) {
      config = c
    },

    // ---------- 开发：浏览器里模拟插件环境 ----------
    configureServer(server) {
      if (options.devRuntime === false) return
      let runtime: Promise<string> | null = null
      const pluginDir = () => config.publicDir || config.root
      const send = (res: any, type: string, body: string) => {
        res.setHeader('content-type', type)
        res.setHeader('cache-control', 'no-store')
        res.end(body)
      }
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        const url = String(req.url ?? '').split('?')[0]
        if (!url.startsWith(ROUTE)) return next()
        try {
          const rest = url.slice(ROUTE.length)
          if (rest === 'runtime.js') return send(res, 'text/javascript', await (runtime ??= buildWebRuntime(name, { minify: false })))
          if (rest === 'config.json') {
            const dir = pluginDir()
            const manifestFiles: Record<string, unknown> = {}
            const pj = readJson(path.join(dir, 'plugin.json'))
            if (pj) manifestFiles['plugin.json'] = pj
            const wt = manifestOf() ?? readJson(path.join(dir, 'whatevertools.json'))
            if (wt) manifestFiles['whatevertools.json'] = wt
            const pkg = readJson(path.join(config.root, 'package.json'))
            if (pkg) manifestFiles['package.json'] = { name: pkg.name, version: pkg.version, productName: pkg.productName, description: pkg.description }
            const preloads: Record<string, string> = {}
            for (const rel of findPreloads(dir, (pj ?? wt)?.preload)) preloads[rel] = `${ROUTE}preload/${rel}`
            return send(res, 'application/json', JSON.stringify({
              manifestFiles, apiName: name, preloads, files: listFiles(dir),
              compat: options.compat === 'none' ? [] : (options.compat ?? 'utools').split(',').map((s) => ({ type: s.split(':')[0], name: s.split(':')[1] || undefined })),
              identity: { runtimeName: name, host: { name: 'vite dev', version: String(server.config.env?.MODE ?? 'development') } },
            }))
          }
          if (rest.startsWith('preload/')) return send(res, 'text/javascript', await bundlePreload(pluginDir(), rest.slice('preload/'.length)))
          res.statusCode = 404
          res.end()
        } catch (e) {
          res.statusCode = 500
          send(res, 'text/plain', String((e as Error).stack ?? e))
        }
      })
    },

    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.server || options.devRuntime === false) return html
        return injectWebLoader(html, { name, runtimeSrc: `${ROUTE}runtime.js`, base: '/', configUrl: `${ROUTE.slice(1)}config.json` })
      },
    },

    // ---------- 构建：写描述文件，按目标打包 ----------
    async closeBundle() {
      if (config.command !== 'build' || config.build.ssr) return
      const outDir = path.resolve(config.root, config.build.outDir)
      const m = manifestOf()
      if (m) fs.writeFileSync(path.join(outDir, 'whatevertools.json'), JSON.stringify(m, null, 2) + '\n')
      const out = path.resolve(config.root, options.out ?? 'release')
      for (const target of targetsOf(options)) {
        await pack({
          dir: outDir, target, out: path.join(out, target), name: options.name, packageName: options.packageName, productName: options.productName,
          compat: options.compat, hostName: options.hostName, hostVersion: options.hostVersion, mockPlatform: options.mockPlatform, mockVersion: options.mockVersion,
          log: (s) => config.logger.info(s),
        })
      }
    },
  }
}

export default whatevertools

// CommonJS 产物：让 ESM 的 `import whatevertools from '@whatevertools/vite'` 直接拿到函数
module.exports = Object.assign(whatevertools, { default: whatevertools, whatevertools })
