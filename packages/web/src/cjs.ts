// 浏览器里的 CommonJS 加载器：不经过构建期打包，直接从虚拟文件系统执行 preload 和它 require 到的文件。
// 解析规则跟 Node 一致：相对 / 绝对路径补 .js / .json / index.js，裸名逐级向上找 node_modules，内置模块和 electron 交给 builtin()。

export interface CjsLoaderIo {
  readFileSync(path: string): Uint8Array
  existsSync(path: string): boolean
  /** 是不是文件（不给就用 existsSync + 读取判断） */
  isFile?(path: string): boolean
  /** 内置模块（已去掉 node: 前缀）和 electron */
  builtin(name: string): unknown
}

export interface CjsModule {
  id: string
  filename: string
  path: string
  exports: any
  loaded: boolean
  parent: CjsModule | null
  children: CjsModule[]
  paths: string[]
  require: CjsRequire
}

export interface CjsRequire {
  (id: string): any
  resolve: ((id: string) => string) & { paths(id: string): string[] | null }
  cache: Record<string, CjsModule>
  main: CjsModule | undefined
}

/** Node 内置模块名：裸名优先当内置模块（跟 Node 一样，node_modules 里的同名包不生效） */
export const NODE_BUILTINS = new Set([
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'dns/promises', 'domain', 'events',
  'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'readline/promises',
  'repl', 'stream', 'stream/promises', 'stream/web', 'string_decoder', 'sys', 'timers', 'timers/promises', 'tls', 'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
])

function normalize(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}
const dirname = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
const join = (...ps: string[]) => normalize(ps.join('/'))

export function createCjsLoader(io: CjsLoaderIo) {
  const cache: Record<string, CjsModule> = Object.create(null)
  const decoder = new TextDecoder()
  const read = (p: string) => decoder.decode(io.readFileSync(p))
  const isFile = (p: string): boolean => {
    if (io.isFile) return io.isFile(p)
    if (!io.existsSync(p)) return false
    try {
      io.readFileSync(p)
      return true
    } catch {
      return false
    }
  }

  const tryFile = (p: string) => [p, p + '.js', p + '.json'].find(isFile)
  const tryIndex = (p: string) => [join(p, 'index.js'), join(p, 'index.json')].find(isFile)

  /** package.json 的入口：exports 只认字符串 / "." / require / default 这几种简单写法，否则用 main */
  function pkgEntry(dir: string): string | undefined {
    const pj = join(dir, 'package.json')
    if (!isFile(pj)) return undefined
    let pkg: any
    try {
      pkg = JSON.parse(read(pj))
    } catch {
      return undefined
    }
    const pick = (e: any): string | undefined => {
      if (typeof e === 'string') return e
      if (Array.isArray(e)) return e.map(pick).find(Boolean)
      if (e && typeof e === 'object') return pick(e.require) ?? pick(e.node) ?? pick(e.default)
      return undefined
    }
    const ex = pkg.exports
    const fromExports = ex && typeof ex === 'object' && !Array.isArray(ex) && '.' in ex ? pick(ex['.']) : pick(ex)
    for (const entry of [fromExports, typeof pkg.main === 'string' ? pkg.main : undefined]) {
      if (!entry) continue
      const p = join(dir, entry)
      const hit = tryFile(p) ?? tryIndex(p)
      if (hit) return hit
    }
    return undefined
  }

  const tryDir = (p: string) => pkgEntry(p) ?? tryIndex(p)

  const lookupPaths = (from: string) => {
    const out: string[] = []
    for (let d = from; ; d = dirname(d)) {
      if (!d.endsWith('/node_modules')) out.push(join(d, 'node_modules'))
      if (d === '/') break
    }
    return out
  }

  const notFound = (id: string, from: string) => Object.assign(new Error(`Cannot find module '${id}' from '${from}'`), { code: 'MODULE_NOT_FOUND' })

  /** 解析结果：内置模块返回 'builtin:<名字>'，否则是绝对路径 */
  function resolve(id: string, fromDir: string): string {
    if (typeof id !== 'string' || !id) throw new TypeError(`require 的参数必须是非空字符串：${String(id)}`)
    if (id.startsWith('node:')) return 'builtin:' + id.slice(5)
    if (id === 'electron' || NODE_BUILTINS.has(id)) return 'builtin:' + id
    if (id.startsWith('./') || id.startsWith('../') || id === '.' || id === '..' || id.startsWith('/')) {
      const p = id.startsWith('/') ? normalize(id) : join(fromDir, id)
      const hit = (id.endsWith('/') ? undefined : tryFile(p)) ?? tryDir(p)
      if (hit) return hit
      throw notFound(id, fromDir)
    }
    for (const nm of lookupPaths(fromDir)) {
      const p = join(nm, id)
      const hit = tryFile(p) ?? tryDir(p)
      if (hit) return hit
    }
    throw notFound(id, fromDir)
  }

  function makeRequire(mod: CjsModule | null, dir: string): CjsRequire {
    const req = ((id: string) => load(resolve(id, dir), mod)) as CjsRequire
    const res = ((id: string) => {
      const r = resolve(id, dir)
      return r.startsWith('builtin:') ? r.slice(8) : r
    }) as CjsRequire['resolve']
    res.paths = (id: string) => (id.startsWith('node:') || NODE_BUILTINS.has(id) || id === 'electron' ? null : lookupPaths(dir))
    req.resolve = res
    req.cache = cache
    req.main = main
    return req
  }

  let main: CjsModule | undefined

  function load(resolved: string, parent: CjsModule | null, isMain = false): any {
    if (resolved.startsWith('builtin:')) return io.builtin(resolved.slice(8))
    const hit = cache[resolved]
    if (hit) {
      // 循环依赖：返回还没执行完的 exports
      if (parent && !parent.children.includes(hit)) parent.children.push(hit)
      return hit.exports
    }
    const dir = dirname(resolved)
    const mod: CjsModule = { id: isMain ? '.' : resolved, filename: resolved, path: dir, exports: {}, loaded: false, parent, children: [], paths: lookupPaths(dir), require: null! }
    mod.require = makeRequire(mod, dir)
    if (isMain) main = mod
    mod.require.main = main
    cache[resolved] = mod
    parent?.children.push(mod)
    try {
      const src = read(resolved)
      if (resolved.endsWith('.json')) {
        try {
          mod.exports = JSON.parse(src.replace(/^﻿/, ''))
        } catch (e: any) {
          throw new SyntaxError(`${resolved}: ${e?.message ?? e}`)
        }
      } else {
        const code = src.replace(/^﻿/, '').replace(/^#!.*/, '')
        const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', code + '\n//# sourceURL=' + resolved)
        fn.call(mod.exports, mod.exports, mod.require, mod, resolved, dir)
      }
      mod.loaded = true
    } catch (e) {
      delete cache[resolved]
      throw e
    }
    return mod.exports
  }

  return {
    /** 把 path（绝对路径）当作入口模块执行，返回它的 exports */
    run(path: string): any {
      const p = normalize(path)
      return load(tryFile(p) ?? tryDir(p) ?? (() => { throw notFound(path, '/') })(), null, true)
    },
    /** 从某个目录 require（默认 /） */
    require(id: string, fromDir = '/'): any {
      return load(resolve(id, normalize(fromDir)), null)
    },
    resolve,
    cache,
  }
}
