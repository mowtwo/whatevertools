// 一次性探针：导出 uTools 运行时真实的 API 结构，写到 out/probe*.json
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, 'out')
const isChild = location.search.includes('child=1')

function src(fn) {
  try {
    const s = Function.prototype.toString.call(fn)
    return s.length > 1500 ? s.slice(0, 1500) + '…' : s
  } catch (e) {
    return 'toString failed: ' + e.message
  }
}

function describe(obj, depth = 0, seen = new Set()) {
  if (obj === null || obj === undefined) return String(obj)
  const t = typeof obj
  if (t === 'function') {
    const out = { type: 'function', length: obj.length, name: obj.name, src: src(obj) }
    if (depth < 2) {
      const props = Object.getOwnPropertyNames(obj).filter((k) => !['length', 'name', 'prototype', 'arguments', 'caller'].includes(k))
      if (props.length) out.props = Object.fromEntries(props.map((k) => [k, safe(() => describe(obj[k], depth + 1, seen))]))
    }
    return out
  }
  if (t !== 'object') return { type: t, value: t === 'string' ? obj.slice(0, 300) : obj }
  if (seen.has(obj) || depth > 3) return { type: 'object', ref: true }
  seen.add(obj)
  const keys = new Set()
  let p = obj
  const chain = []
  while (p && p !== Object.prototype) {
    chain.push(p.constructor && p.constructor.name)
    Object.getOwnPropertyNames(p).forEach((k) => k !== 'constructor' && keys.add(k))
    p = Object.getPrototypeOf(p)
  }
  return {
    type: 'object',
    chain,
    keys: Object.fromEntries([...keys].sort().map((k) => [k, safe(() => describe(obj[k], depth + 1, seen))])),
  }
}

function safe(f) {
  try {
    return f()
  } catch (e) {
    return { error: e.message }
  }
}

function write(name, data) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2))
}

function env() {
  return {
    href: location.href,
    versions: process.versions,
    platform: process.platform,
    processType: process.type,
    sandboxed: process.sandboxed,
    contextIsolated: process.contextIsolated,
    argv: process.argv,
    execPath: process.execPath,
    dirname: __dirname,
    modulePaths: module.paths,
    windowRequire: typeof window.require,
    windowProcess: typeof window.process,
    windowType: safe(() => utools.getWindowType()),
    electronKeys: safe(() => Object.keys(require('electron'))),
    ipcRendererKeys: safe(() => {
      const { ipcRenderer } = require('electron')
      const keys = new Set()
      let p = ipcRenderer
      while (p && p !== Object.prototype) {
        Object.getOwnPropertyNames(p).forEach((k) => keys.add(k))
        p = Object.getPrototypeOf(p)
      }
      return [...keys]
    }),
    globals: Object.getOwnPropertyNames(window).filter((k) => !(k in Object.getPrototypeOf(window)) && !/^on/.test(k)).slice(0, 400),
  }
}

if (isChild) {
  safe(() => write('probe-child.json', { env: env(), utools: describe(window.utools) }))
} else {
  window.probe = {
    async run() {
      const report = { at: new Date().toISOString(), env: env(), utools: describe(window.utools) }
      report.calls = {
        appVersion: safe(() => utools.getAppVersion()),
        appName: safe(() => utools.getAppName && utools.getAppName()),
        isDev: safe(() => utools.isDev()),
        nativeId: safe(() => typeof utools.getNativeId()),
        localData: safe(() => utools.getPluginLocalDataPath()),
        temp: safe(() => utools.getPluginTempPath()),
        features: safe(() => utools.getFeatures()),
      }
      write('probe.json', report)
      // 自定义窗口：返回值是什么对象、能调哪些方法
      const win = await new Promise((resolve) => {
        let w
        const timer = setTimeout(() => resolve({ w, timeout: true }), 8000)
        w = utools.createBrowserWindow(
          'index.html?child=1',
          { show: false, width: 300, height: 200, webPreferences: { preload: 'preload.js' } },
          () => {
            clearTimeout(timer)
            setTimeout(() => resolve({ w }), 1500)
          },
        )
      })
      report.window = {
        callbackFired: !win.timeout,
        returned: describe(win.w),
        id: safe(() => win.w.id),
        webContentsId: safe(() => win.w.webContents.id),
      }
      write('probe.json', report)
      safe(() => win.w.destroy())
      return '完成：' + path.join(OUT, 'probe.json')
    },
  }
}
