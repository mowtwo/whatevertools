// ubrowser：用 BrowserWindow 执行链式指令。会话按插件隔离并持久化（persist:whatevertools-ubrowser-<id>）。
// 选择器支持 CSS、XPath（以 / 或 ( 开头）和 >> 穿透同源 iframe。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, nativeImage, session } from 'electron'
import { clipboardBackend } from './clipboard-backend'
import type { CallCtx, Handler } from '../types'

interface Step { op: string; args: any[] }

const WIN_KEYS = new Set(['show', 'title', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'x', 'y', 'center', 'resizable', 'movable', 'maximizable', 'minimizable', 'closable', 'frame', 'hasShadow', 'roundedCorners', 'alwaysOnTop', 'focusable', 'enableLargerThanScreen', 'fullscreenable', 'fullscreen', 'opacity', 'backgroundColor', 'transparent', 'titleBarStyle'])

const QUERY_JS = `(() => {
  if (window.__whatevertoolsQuery) return
  const one = (root, sel) => {
    if (/^\\s*[\\/(]/.test(sel)) {
      const doc = root.ownerDocument || root
      return doc.evaluate(sel.trim(), root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    }
    return root.querySelector(sel)
  }
  window.__whatevertoolsQuery = (sel) => {
    const parts = String(sel).split('>>')
    let root = document
    for (let i = 0; i < parts.length; i++) {
      const el = one(root, parts[i].trim())
      if (!el) return null
      if (i === parts.length - 1) return el
      if (!el.contentDocument) return null
      root = el.contentDocument
    }
    return null
  }
  window.__whatevertoolsRect = (sel) => {
    const el = window.__whatevertoolsQuery(sel)
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'center' })
    let r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
    let w = el.ownerDocument.defaultView
    while (w && w !== window && w.frameElement) { const fr = w.frameElement.getBoundingClientRect(); x += fr.left; y += fr.top; w = w.parent }
    return { x, y, width: r.width, height: r.height, left: r.left, top: r.top }
  }
  window.__whatevertoolsMarkdown = (sel) => {
    const root = sel ? window.__whatevertoolsQuery(sel) : document.body
    if (!root) return ''
    const walk = (n) => {
      if (n.nodeType === 3) return n.textContent.replace(/\\s+/g, ' ')
      if (n.nodeType !== 1) return ''
      const t = n.tagName.toLowerCase()
      if (['script', 'style', 'noscript', 'template', 'svg'].includes(t)) return ''
      const inner = () => Array.from(n.childNodes).map(walk).join('')
      switch (t) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return '\\n\\n' + '#'.repeat(+t[1]) + ' ' + inner().trim() + '\\n\\n'
        case 'p': case 'div': case 'section': case 'article': return '\\n\\n' + inner().trim() + '\\n\\n'
        case 'br': return '\\n'
        case 'strong': case 'b': return '**' + inner().trim() + '**'
        case 'em': case 'i': return '*' + inner().trim() + '*'
        case 'code': return '\\u0060' + n.textContent + '\\u0060'
        case 'pre': return '\\n\\n\\u0060\\u0060\\u0060\\n' + n.textContent + '\\n\\u0060\\u0060\\u0060\\n\\n'
        case 'a': return '[' + inner().trim() + '](' + n.href + ')'
        case 'img': return '![' + (n.alt || '') + '](' + n.src + ')'
        case 'li': return '\\n- ' + inner().trim()
        case 'ul': case 'ol': return '\\n' + inner() + '\\n'
        case 'blockquote': return '\\n\\n> ' + inner().trim() + '\\n\\n'
        case 'tr': return '\\n| ' + Array.from(n.children).map((c) => walk(c).trim()).join(' | ') + ' |'
        default: return inner()
      }
    }
    return walk(root).replace(/\\n{3,}/g, '\\n\\n').trim()
  }
})()`

const fnSource = (a: any) => (a && typeof a === 'object' && typeof a.__whatevertoolsFn === 'string' ? a.__whatevertoolsFn : null)

export class UBrowsers {
  /** 插件 id → 空闲窗口 */
  private idle = new Map<string, Set<BrowserWindow>>()
  private busy = new Set<BrowserWindow>()

  constructor(private proxies = new Map<string, Electron.ProxyConfig>()) {}

  partition(pluginId: string) {
    return `persist:whatevertools-ubrowser-${pluginId}`
  }

  idleList(pluginId: string) {
    return [...(this.idle.get(pluginId) ?? [])].filter((w) => !w.isDestroyed()).map(info)
  }

  async setProxy(pluginId: string, config: Electron.ProxyConfig) {
    this.proxies.set(pluginId, config)
    await session.fromPartition(this.partition(pluginId)).setProxy(config)
  }

  async clearCache(pluginId: string) {
    const s = session.fromPartition(this.partition(pluginId))
    await s.clearCache()
    await s.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'shadercache'] })
  }

  async run(c: CallCtx, steps: Step[], target?: Record<string, any> | number) {
    const pid = c.plugin.id
    let win: BrowserWindow
    if (typeof target === 'number') {
      const found = [...(this.idle.get(pid) ?? [])].find((w) => !w.isDestroyed() && w.id === target)
      if (!found) throw new Error(`ubrowser 窗口不存在或正忙：${target}`)
      this.idle.get(pid)!.delete(found)
      win = found
    } else {
      const opts: Record<string, any> = { width: 800, height: 600, show: true }
      for (const [k, v] of Object.entries(target ?? {})) if (WIN_KEYS.has(k)) opts[k] = v
      win = new BrowserWindow({ ...opts, webPreferences: { partition: this.partition(pid), contextIsolation: true, sandbox: true, nodeIntegration: false } })
      const proxy = this.proxies.get(pid)
      if (proxy) await win.webContents.session.setProxy(proxy)
    }
    this.busy.add(win)
    tempDirFor = c.plugin.tempDir
    const results: unknown[] = []
    try {
      await execute(c, win, steps, results)
      return [...results, info(win)]
    } catch (e: any) {
      e.data = [...results, win.isDestroyed() ? null : info(win)]
      throw e
    } finally {
      this.busy.delete(win)
      if (!win.isDestroyed()) {
        // 隐藏的窗口执行完自动销毁；可见的留着，可以用 run(id) 复用
        if (!win.isVisible()) win.destroy()
        else {
          const set = this.idle.get(pid) ?? new Set()
          if (!set.has(win)) win.once('closed', () => set.delete(win))
          set.add(win)
          this.idle.set(pid, set)
        }
      }
    }
  }
}

function info(win: BrowserWindow) {
  const b = win.getBounds()
  return { id: win.id, url: win.webContents.getURL(), title: win.webContents.getTitle(), width: b.width, height: b.height, x: b.x, y: b.y }
}

async function js<T = any>(win: BrowserWindow, code: string): Promise<T> {
  await win.webContents.executeJavaScript(QUERY_JS, true)
  return win.webContents.executeJavaScript(code, true)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => Promise<boolean>, timeout: number, interval: number, what: string) {
  const end = Date.now() + timeout
  for (;;) {
    if (await check().catch(() => false)) return
    if (Date.now() > end) throw new Error(`ubrowser wait 超时：${what}`)
    await sleep(interval)
  }
}

async function point(win: BrowserWindow, args: any[]): Promise<{ x: number; y: number; rest: any[] }> {
  if (typeof args[0] === 'number') return { x: args[0], y: args[1], rest: args.slice(2) }
  const r = await js(win, `window.__whatevertoolsRect(${JSON.stringify(args[0])})`)
  if (!r || (!r.width && !r.height)) throw new Error(`ubrowser 找不到可见元素：${args[0]}`)
  return { x: Math.round(r.x), y: Math.round(r.y), rest: args.slice(1) }
}

function mouse(win: BrowserWindow, type: 'mouseDown' | 'mouseUp' | 'mouseMove', x: number, y: number, button: 'left' | 'middle' | 'right' = 'left', clickCount = 1) {
  win.webContents.sendInputEvent({ type, x, y, button, clickCount } as Electron.MouseInputEvent)
}

/** 临时文件放进插件的临时目录（插件退出时清理），而不是系统临时目录 */
let tempDirFor: string = os.tmpdir()
function tempFile(ext: string) {
  return path.join(tempDirFor, `browser-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`)
}

function payloadFiles(payload: string | Uint8Array | string[]): string[] {
  if (Array.isArray(payload)) return payload
  if (payload instanceof Uint8Array) {
    const f = tempFile('bin')
    fs.writeFileSync(f, payload)
    return [f]
  }
  if (payload.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(payload)
    const f = tempFile((m?.[1].split('/')[1] ?? 'png').replace(/\W/g, ''))
    fs.writeFileSync(f, Buffer.from(m?.[2] ?? '', 'base64'))
    return [f]
  }
  return [payload]
}

async function execute(c: CallCtx, win: BrowserWindow, steps: Step[], results: unknown[]) {
  const wc = win.webContents
  const skip: boolean[] = []
  const skipping = () => skip.some(Boolean)
  for (const { op, args } of steps) {
    if (op === 'endWhen') {
      skip.pop()
      continue
    }
    if (op === 'when') {
      if (skipping()) {
        skip.push(true)
        continue
      }
      const fn = fnSource(args[0])
      const ok = fn
        ? await js(win, `(${fn})(...${JSON.stringify(args.slice(1))})`)
        : (await js(win, `!!window.__whatevertoolsQuery(${JSON.stringify(args[0])})`)) === (args[1] ?? true)
      skip.push(!ok)
      continue
    }
    if (skipping()) continue
    if (win.isDestroyed()) throw new Error('ubrowser 窗口已关闭')
    switch (op) {
      case 'goto': {
        const [url, headers, timeout] = args
        if (!/^(https?:|about:blank$)/i.test(String(url))) throw Object.assign(new Error(`[whatevertools] browser.automate 的 goto 只支持 http / https：${url}`), { code: 'EWTPERM' })
        await c.host.permit(c.plugin, 'browser', String(url))
        const extraHeaders = headers ? Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n') : undefined
        const load = wc.loadURL(String(url), { extraHeaders })
        const limit = typeof timeout === 'number' && timeout > 0 ? timeout : 60000
        await Promise.race([load, sleep(limit).then(() => { throw new Error(`browser.automate goto 超时：${url}`) })])
        break
      }
      case 'userAgent': wc.setUserAgent(String(args[0])); break
      case 'viewport': win.setContentSize(args[0], args[1]); break
      case 'device': {
        const o = args[0] ?? {}
        if (o.userAgent) wc.setUserAgent(o.userAgent)
        if (o.viewport) {
          win.setContentSize(o.viewport.width, o.viewport.height)
          wc.enableDeviceEmulation({ screenPosition: o.viewport.isMobile ? 'mobile' : 'desktop', screenSize: { width: o.viewport.width, height: o.viewport.height }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: o.viewport.deviceScaleFactor ?? 1, viewSize: { width: o.viewport.width, height: o.viewport.height }, scale: 1 })
        }
        break
      }
      case 'click': case 'dblclick': case 'mousedown': case 'mouseup': case 'hover': {
        const domOnly = typeof args[0] === 'string' && args[1] === undefined && op !== 'hover'
        if (domOnly) {
          const ev = op === 'click' ? 'el.click()' : `el.dispatchEvent(new MouseEvent(${JSON.stringify(op)}, { bubbles: true, cancelable: true, view: window }))`
          const ok = await js(win, `(() => { const el = window.__whatevertoolsQuery(${JSON.stringify(args[0])}); if (!el) return false; ${ev}; return true })()`)
          if (!ok) throw new Error(`ubrowser 找不到元素：${args[0]}`)
          break
        }
        const { x, y, rest } = await point(win, args)
        const button = (rest[0] ?? 'left') as 'left' | 'middle' | 'right'
        mouse(win, 'mouseMove', x, y)
        if (op === 'hover') break
        if (op === 'mousedown') { mouse(win, 'mouseDown', x, y, button); break }
        if (op === 'mouseup') { mouse(win, 'mouseUp', x, y, button); break }
        const count = op === 'dblclick' ? 2 : 1
        for (let i = 1; i <= count; i++) {
          mouse(win, 'mouseDown', x, y, button, i)
          mouse(win, 'mouseUp', x, y, button, i)
        }
        break
      }
      case 'press': {
        const [key, ...mods] = args as string[]
        const modifiers = mods.map((m) => (m === 'ctrl' ? 'control' : m)) as any
        wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
        if (key.length === 1) wc.sendInputEvent({ type: 'char', keyCode: key, modifiers })
        wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
        break
      }
      case 'focus':
        await js(win, `window.__whatevertoolsQuery(${JSON.stringify(args[0])})?.focus()`)
        break
      case 'input': {
        const text = args.length > 1 ? args[1] : args[0]
        if (args.length > 1) await js(win, `window.__whatevertoolsQuery(${JSON.stringify(args[0])})?.focus()`)
        await wc.insertText(String(text))
        break
      }
      case 'value': {
        const ok = await js(win, `(() => { const el = window.__whatevertoolsQuery(${JSON.stringify(args[0])}); if (!el) return false;
          const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, 'value');
          d && d.set ? d.set.call(el, ${JSON.stringify(String(args[1]))}) : (el.value = ${JSON.stringify(String(args[1]))});
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
        if (!ok) throw new Error(`ubrowser 找不到元素：${args[0]}`)
        break
      }
      case 'check':
        await js(win, `(() => { const el = window.__whatevertoolsQuery(${JSON.stringify(args[0])}); if (!el) throw new Error('not found'); if (el.checked !== ${!!args[1]}) el.click() })()`)
        break
      case 'scroll':
        if (typeof args[0] === 'string') await js(win, `window.__whatevertoolsQuery(${JSON.stringify(args[0])})?.scrollIntoView(${JSON.stringify(args[1] ?? {})})`)
        else if (args.length >= 2) await js(win, `window.scrollTo(${Number(args[0])}, ${Number(args[1])})`)
        else await js(win, `window.scrollTo(window.scrollX, ${Number(args[0])})`)
        break
      case 'file': {
        const files = payloadFiles(args[1])
        // 上传本地文件到网页等同于读取：路径参数需要 fs.read（Data URL / 字节由插件自己提供，不需要）
        if (typeof args[1] === 'string' ? !String(args[1]).startsWith('data:') : Array.isArray(args[1])) for (const f of files) await c.host.permit(c.plugin, 'fs.read', path.resolve(f))
        const dbg = wc.debugger
        const attached = dbg.isAttached()
        if (!attached) dbg.attach('1.3')
        try {
          const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
          const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: String(args[0]) })
          if (!nodeId) throw new Error(`ubrowser 找不到文件输入框：${args[0]}`)
          await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files })
        } finally {
          if (!attached) dbg.detach()
        }
        break
      }
      case 'drop':
        throw Object.assign(new Error('[whatevertools] ubrowser.drop 暂不支持'), { code: 'EWTUNSUPPORTED' })
      case 'paste': {
        const clipboard = clipboardBackend()
        const saved = { text: await clipboard.readText(), image: await clipboard.readImage() }
        const p = String(args[0])
        if (p.startsWith('data:image')) await clipboard.writeImage(nativeImage.createFromDataURL(p))
        else await clipboard.writeText(p)
        wc.paste()
        await sleep(100)
        if (!saved.image.isEmpty()) await clipboard.writeImage(saved.image)
        else await clipboard.writeText(saved.text)
        break
      }
      case 'download': {
        const fn = fnSource(args[0])
        const url: string = fn ? await js(win, `(${fn})(...${JSON.stringify(args.slice(2))})`) : String(args[0])
        const save: string | null = args[1] ?? null
        await c.host.permit(c.plugin, 'fs.write', save ?? c.plugin.tempDir)
        const file = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`browser.automate 下载超时：${url}`)), 10 * 60 * 1000)
          wc.session.once('will-download', (_e, item) => {
            clearTimeout(timer)
            const target = save ?? path.join(c.plugin.tempDir, item.getFilename())
            item.setSavePath(target)
            item.once('done', (_e2, state) => (state === 'completed' ? resolve(target) : reject(new Error(`下载失败：${state}`))))
          })
          wc.downloadURL(url)
        })
        results.push(file)
        break
      }
      case 'evaluate': {
        const fn = fnSource(args[0])
        if (!fn) throw new Error('ubrowser.evaluate 需要一个函数')
        results.push(await js(win, `Promise.resolve((${fn})(...${JSON.stringify(args.slice(1))}))`))
        break
      }
      case 'css':
        await wc.insertCSS(String(args[0]))
        break
      case 'wait': {
        const [a, b, ...rest] = args
        if (typeof a === 'number') {
          await sleep(a)
          break
        }
        const opts = typeof b === 'number' ? { timeout: b } : typeof b === 'boolean' ? { result: b } : (b ?? {})
        const timeout = opts.timeout ?? 60000
        const interval = opts.interval ?? 500
        const fn = fnSource(a)
        if (fn) await waitFor(() => js(win, `!!(${fn})(...${JSON.stringify(typeof b === 'object' || typeof b === 'number' ? rest : [b, ...rest])})`), timeout, interval, 'function')
        else {
          const want = opts.result ?? true
          await waitFor(async () => (await js(win, `!!window.__whatevertoolsQuery(${JSON.stringify(a)})`)) === want, timeout, interval, String(a))
        }
        break
      }
      case 'markdown':
        results.push(await js(win, `window.__whatevertoolsMarkdown(${JSON.stringify(args[0] ?? null)})`))
        break
      case 'screenshot': {
        const [target, savePath] = args
        let rect: Electron.Rectangle | undefined
        if (typeof target === 'string') {
          const r = await js(win, `window.__whatevertoolsRect(${JSON.stringify(target)})`)
          if (!r) throw new Error(`ubrowser 找不到元素：${target}`)
          rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
        } else if (target && typeof target === 'object') rect = target
        const img = await wc.capturePage(rect)
        const file = savePath ?? tempFile('png')
        if (savePath) await c.host.permit(c.plugin, 'fs.write', savePath)
        fs.writeFileSync(file, img.toPNG())
        results.push(file)
        break
      }
      case 'pdf': {
        const [options, savePath] = args
        const data = await wc.printToPDF(options ?? {})
        const file = savePath ?? tempFile('pdf')
        if (savePath) await c.host.permit(c.plugin, 'fs.write', savePath)
        fs.writeFileSync(file, data)
        results.push(file)
        break
      }
      case 'cookies': {
        const a = args[0]
        const filter = typeof a === 'object' && a ? a : { url: wc.getURL(), ...(a ? { name: a } : {}) }
        results.push(await wc.session.cookies.get(filter))
        break
      }
      case 'setCookies': {
        const list = Array.isArray(args[0]) ? args[0] : [{ name: args[0], value: args[1] }]
        for (const ck of list) {
          // 在 goto 之前设置时没有当前网址：用 domain / path 拼出来
          const url = ck.url ?? (ck.domain ? `http${ck.secure ? 's' : ''}://${String(ck.domain).replace(/^\./, '')}${ck.path ?? '/'}` : wc.getURL())
          if (!url) throw new Error('setCookies：需要 url 或 domain')
          await wc.session.cookies.set({ ...ck, url })
        }
        break
      }
      case 'removeCookies':
        await wc.session.cookies.remove(wc.getURL(), String(args[0]))
        break
      case 'clearCookies': {
        const url = args[0] ?? wc.getURL()
        for (const ck of await wc.session.cookies.get({ url })) await wc.session.cookies.remove(url, ck.name)
        break
      }
      case 'show': win.show(); break
      case 'hide': win.hide(); break
      case 'devTools': wc.openDevTools({ mode: args[0] ?? 'detach' }); break
      default:
        throw new Error(`ubrowser 不支持的指令：${op}`)
    }
  }
}

export const ubrowserSvc: Record<string, Handler> = {
  __ubrowserRun: async (c, steps: Step[], target) => {
    if (!Array.isArray(steps)) throw new Error('browser.automate：指令无效')
    // 先检查协议再问权限：file: 等协议直接拒绝，不打扰用户
    for (const s of steps) if (s?.op === 'goto' && !/^(https?:|about:blank$)/i.test(String(s.args?.[0]))) throw Object.assign(new Error(`[whatevertools] browser.automate 的 goto 只支持 http / https：${s.args?.[0]}`), { code: 'EWTPERM' })
    // 按第一个要打开的网址询问（带作用域，回答「始终允许」只授予这个网站）
    const first = steps.find((s) => s?.op === 'goto')?.args?.[0]
    await c.host.permit(c.plugin, 'browser', typeof first === 'string' ? first : undefined)
    return c.host.provider(c.plugin, 'browser', 'run', [steps, target], () => c.host.ubrowsers.run(c, steps, target))
  },
  'browser.idle': (c) => c.host.ubrowsers.idleList(c.plugin.id),
  'browser.setProxy': (c, config) => c.host.ubrowsers.setProxy(c.plugin.id, config),
  'browser.clearCache': (c) => c.host.ubrowsers.clearCache(c.plugin.id),
}
