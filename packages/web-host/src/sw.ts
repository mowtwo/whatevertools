// Service Worker：无依赖的普通脚本（编译后就是 dist/sw.js，网站原样部署）。
// 拦截 <scope>plugins/<id>/<路径>，从 IndexedDB 取插件文件；html 注入运行时加载器；
// <scope>plugins/<id>/__whatevertools.config.json 按安装记录和宿主配置现场合成。
// 库结构跟 idb.ts 一致，改动时两边一起改。
;(() => {
  const sw = self as any
  const DB_VERSION = 1
  const CONFIG_FILE = '__whatevertools.config.json'
  const scopePath = () => new URL(sw.registration.scope).pathname
  const TYPES: Record<string, string> = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', cjs: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8', css: 'text/css; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
    xml: 'application/xml; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    bmp: 'image/bmp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', pdf: 'application/pdf',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
  }

  sw.addEventListener('install', () => sw.skipWaiting())
  sw.addEventListener('activate', (e: any) => e.waitUntil(sw.clients.claim()))
  sw.addEventListener('fetch', (e: any) => {
    const req: Request = e.request
    if (req.method !== 'GET') return
    const url = new URL(req.url)
    const prefix = scopePath() + 'plugins/'
    if (url.origin !== location.origin || !url.pathname.startsWith(prefix)) return
    e.respondWith(serve(url, prefix).catch((err: any) => text(500, `[whatevertools] ${err?.message ?? err}`)))
  })

  let dbp: Promise<IDBDatabase> | null = null
  function openDb(): Promise<IDBDatabase> {
    return (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(`whatevertools-host:${scopePath()}`, DB_VERSION)
      r.onupgradeneeded = () => {
        for (const s of ['files', 'records', 'meta']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s)
      }
      r.onsuccess = () => {
        const db = r.result
        db.onversionchange = () => {
          db.close()
          dbp = null
        }
        resolve(db)
      }
      r.onerror = () => reject(r.error)
    }).catch((e) => {
      dbp = null
      throw e
    }))
  }
  async function get(store: string, key: string): Promise<any> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const r = db.transaction(store, 'readonly').objectStore(store).get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  }

  const text = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }

  async function serve(url: URL, prefix: string): Promise<Response> {
    const rest = url.pathname.slice(prefix.length)
    const slash = rest.indexOf('/')
    const id = dec(slash < 0 ? rest : rest.slice(0, slash))
    const rec = await get('records', id)
    if (!rec) return text(404, `[whatevertools] 没有安装插件 ${id}`)
    const base = prefix + encodeURIComponent(id) + '/'
    const rel = slash < 0 ? '' : rest.slice(slash + 1).split('/').map(dec).join('/')
    if (!rel) return Response.redirect(new URL(base + rec.main, url).href + url.search, 302)
    if (rel === CONFIG_FILE) {
      const host = (await get('meta', 'config')) ?? {}
      const cfg = { ...host.boot, manifestFiles: rec.manifestFiles, apiName: host.apiName, compat: host.compat, identity: host.identity, files: rec.files, preloadMode: 'cjs' }
      return new Response(JSON.stringify(cfg), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
    }
    const file = await get('files', `${id}/${rec.gen}/${rel}`)
    if (!file) return text(404, `[whatevertools] 插件 ${id} 里没有 ${rel}`)
    const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()
    const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' }
    if (ext === 'html' || ext === 'htm') {
      const host = (await get('meta', 'config')) ?? {}
      const html = injectWebLoader(new TextDecoder().decode(file.data), { name: host.runtimeName ?? 'whatevertools', runtimeSrc: host.runtimeUrl, base, configUrl: CONFIG_FILE })
      return new Response(html, { headers })
    }
    return new Response(file.data, { headers })
  }

  // 下面这段照抄 packages/cli/src/web.ts 的 injectWebLoader，保持行为一致（cli 只能在 Node 里用）
  interface WebLoaderOptions {
    name: string
    runtimeSrc: string
    base: string
    configUrl: string
  }
  function injectWebLoader(html: string, o: WebLoaderOptions): string {
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
})()
