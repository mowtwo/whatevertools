// web 目标的构建积木：wt pack --target web 和 @whatevertools/vite 的开发服务器共用
import fs from 'node:fs'
import path from 'node:path'
import { walk } from './report'

/** 打包浏览器运行时（@whatevertools/web/full），全局名 __<name>Runtime */
export async function buildWebRuntime(name: string, opts: { minify?: boolean } = {}): Promise<string> {
  const esbuild = require('esbuild')
  const r = await esbuild.build({
    entryPoints: [require.resolve('@whatevertools/web/full')],
    bundle: true, format: 'iife', globalName: `__${name}Runtime`, platform: 'browser', target: 'es2020',
    write: false, minify: opts.minify ?? true, legalComments: 'none', logLevel: 'error',
  })
  return r.outputFiles[0].text
}

/** require 到的 Node 内置模块和 electron 交给运行时的垫片（__whatevertoolsRequire） */
export function shimPlugin() {
  const builtins = new Set(require('node:module').builtinModules.flatMap((m: string) => [m, `node:${m}`]))
  return {
    name: 'whatevertools-shims',
    setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => {
        if (args.path === 'electron' || builtins.has(args.path)) return { path: args.path, namespace: 'whatevertools-shim' }
        return undefined
      })
      build.onLoad({ filter: /.*/, namespace: 'whatevertools-shim' }, (args: any) => ({ contents: `module.exports = globalThis.__whatevertoolsRequire(${JSON.stringify(args.path)})`, loader: 'js' }))
    },
  }
}

/** preload（CommonJS，可能 require 插件目录里的其他文件和 node_modules）→ 浏览器脚本 */
export async function bundlePreload(dir: string, rel: string, opts: { minify?: boolean } = {}): Promise<string> {
  const esbuild = require('esbuild')
  const r = await esbuild.build({
    entryPoints: [path.join(dir, rel)], bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
    write: false, minify: opts.minify ?? false, plugins: [shimPlugin()], define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: `var __dirname = ${JSON.stringify('/plugin/' + path.posix.dirname(rel)).replace('/.', '')}, __filename = ${JSON.stringify('/plugin/' + rel)};` },
    logLevel: 'error',
  })
  return r.outputFiles[0].text
}

/** 插件里所有会被当作 preload 的脚本：描述文件的 preload + 代码里 webPreferences.preload 引用的文件 */
export function findPreloads(dir: string, main?: string) {
  const set = new Set<string>()
  if (main) set.add(main.replace(/^\.\//, ''))
  for (const f of walk(dir, (x) => /\.(m?js|cjs)$/.test(x))) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/preload\s*:\s*['"]([^'"]+\.js)['"]/g)) if (fs.existsSync(path.join(dir, m[1]))) set.add(m[1].replace(/^\.\//, ''))
  }
  return [...set]
}

export interface WebLoaderOptions {
  /** 注入名（运行时全局名是 __<name>Runtime） */
  name: string
  /** 运行时脚本地址 */
  runtimeSrc: string
  /** 插件资源目录（相对页面或绝对路径，以 / 结尾） */
  base: string
  /** 启动配置地址（相对 base） */
  configUrl: string
}

/**
 * 改写页面：先加载运行时并 boot，页面原有脚本（包括 type=module）推迟到 boot 完成后按原顺序执行，
 * 然后补发 DOMContentLoaded / load，最后进入插件。
 */
export function injectWebLoader(html: string, o: WebLoaderOptions): string {
  html = html.replace(/<script\b([^>]*)>/gi, (m, attrs) => (/\bdata-whatevertools\b/.test(attrs) ? m : `<script data-whatevertools-deferred${attrs.replace(/\btype\s*=\s*(['"])module\1/i, ' data-whatevertools-module').replace(/\btype\s*=\s*(['"])text\/javascript\1/i, '')} type="whatevertools/deferred">`))
  const loader = `<script data-whatevertools src="${o.runtimeSrc}"></script>
<script data-whatevertools>
(function () {
  var base = new URL(${JSON.stringify(o.base)}, location.href).href
  fetch(base + ${JSON.stringify(o.configUrl)}).then(function (r) { return r.json() }).then(function (cfg) {
    cfg.base = base
    return window.__${o.name}Runtime.boot(cfg)
  }).then(function (rt) {
    var list = document.querySelectorAll('script[type="whatevertools/deferred"]')
    var chain = Promise.resolve()
    list.forEach(function (old) {
      chain = chain.then(function () {
        return new Promise(function (done) {
          var s = document.createElement('script')
          for (var i = 0; i < old.attributes.length; i++) { var a = old.attributes[i]; if (a.name !== 'type' && a.name !== 'data-whatevertools-deferred' && a.name !== 'data-whatevertools-module') s.setAttribute(a.name, a.value) }
          if (old.hasAttribute('data-whatevertools-module')) s.type = 'module'
          if (old.src) { s.onload = s.onerror = function () { done() }; s.src = old.src } else { s.textContent = old.textContent; setTimeout(done, 0) }
          old.parentNode.replaceChild(s, old)
          if (!old.src) done()
        })
      })
    })
    // 页面脚本执行完：补发 DOMContentLoaded / load（这些事件早已过去），再让运行时进入插件
    return chain.then(function () {
      document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }))
      window.dispatchEvent(new Event('load'))
      return rt.start()
    })
  }).catch(function (e) { console.error('[${o.name}] 启动失败', e); document.body && (document.body.innerHTML = '<pre style="padding:16px;color:#b91c1c">启动失败：' + String(e && e.message || e) + '</pre>') })
})()
</script>`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${loader}`) : loader + html
}
