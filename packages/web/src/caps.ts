// 浏览器平台的能力实现
import { findApi, type Capabilities, type DialogCapability, type ShellCapability, type DbCapability, type DisplayInfo, type DocDb, type FeatureStore, type ImageInput, type PermissionManager, type Scheduler, type WindowHandle } from '@whatevertools/core'
import type { VirtualFs } from '@whatevertools/fs-virtual'
import { imageSize } from '@whatevertools/shim-electron'
import { fromBase64 } from '@whatevertools/api'

export interface WebCapsOptions {
  pluginId: string
  pluginName: string
  /** 插件资源所在的 URL 目录（以 / 结尾） */
  base: string
  windowKind: 'main' | 'custom'
  windowId: number
  vfs: VirtualFs
  db: DocDb
  permissions: PermissionManager
  scheduler: Scheduler
  features: FeatureStore
  staticFeatureCodes: string[]
  /** preload 名 → 打包后的脚本 URL（自定义窗口用） */
  preloads: Record<string, string>
  sharp?: (...a: unknown[]) => unknown
  ai?: Capabilities['ai']
  /** 文件对话框（默认由 @whatevertools/web-files 提供） */
  dialog?: DialogCapability
  /** shell 的补充实现（openPath / showItemInFolder） */
  shell?: Partial<ShellCapability>
  /** getPath('downloads') 返回的目录 */
  downloadsDir?: string
}

const IPC = '__whatevertoolsIpc'

function detectOs(): 'darwin' | 'win32' | 'linux' | 'unknown' {
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Win/i.test(ua)) return 'win32'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'unknown'
}

function toPng(input: ImageInput, vfs: VirtualFs): Uint8Array | null {
  if (typeof input === 'string') {
    if (input.startsWith('data:')) return fromBase64(input.split(',')[1] ?? '')
    try {
      return vfs.readFileSync(input)
    } catch {
      return null
    }
  }
  if (input instanceof Uint8Array) return input
  if (input && (input as { png?: Uint8Array }).png) return (input as { png: Uint8Array }).png
  return null
}

export function createWebCaps(o: WebCapsOptions): Capabilities & { emit(name: string, ...args: unknown[]): void; request(name: string, ...args: unknown[]): Promise<unknown>; whenReady(): Promise<void> } {
  const listeners = new Map<string, Set<(...a: any[]) => void>>()
  const requests = new Map<string, (...a: any[]) => unknown>()
  let readyResolve!: () => void
  const ready = new Promise<void>((r) => (readyResolve = r))
  let clipText = ''
  let cursor = { x: 0, y: 0 }
  addEventListener('mousemove', (e) => (cursor = { x: e.screenX, y: e.screenY }), { passive: true })
  // 系统主题变化 → theme.change 事件
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => listeners.get('theme.change')?.forEach((fn) => fn(e.matches)))
  addEventListener('copy', () => (clipText = String(getSelection() ?? '')))
  addEventListener('paste', (e) => (clipText = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? clipText))

  const display = (): DisplayInfo => ({
    id: 1,
    bounds: { x: 0, y: 0, width: screen.width, height: screen.height },
    workArea: { x: (screen as any).availLeft ?? 0, y: (screen as any).availTop ?? 0, width: screen.availWidth, height: screen.availHeight },
    workAreaSize: { width: screen.availWidth, height: screen.availHeight },
    size: { width: screen.width, height: screen.height },
    scaleFactor: devicePixelRatio,
    rotation: 0,
    label: 'browser',
  })

  // 自定义窗口：window.open + postMessage
  const children = new Map<number, Window>()
  let seq = o.windowId * 1000
  const ipcListeners = new Map<string, Set<(...a: any[]) => void>>()
  addEventListener('message', (e) => {
    const d = e.data
    if (!d || d[IPC] !== true || e.origin !== location.origin) return
    // 只接受父窗口和自己打开的子窗口发来的消息
    if (e.source !== window.opener && ![...children.values()].includes(e.source as Window)) return
    ipcListeners.get(d.channel)?.forEach((fn) => fn({ senderId: d.from, sender: e.source }, ...(d.args ?? [])))
  })

  const db = o.db
  const dbCap: DbCapability = {
    putSync: (d) => db.put(d as any),
    getSync: (id) => db.get(id),
    removeSync: (d) => db.remove(d as any),
    bulkSync: (docs) => db.bulkDocs(docs as any),
    allSync: (f) => db.allDocs(f),
    putAttachmentSync: () => {
      throw Object.assign(new Error('[whatevertools] 浏览器端请用 db.async.putAttachment'), { code: 'EWTUNSUPPORTED' })
    },
    getAttachmentSync: (id) => db.getAttachmentCached(id) ?? null,
    getAttachmentTypeSync: (id) => db.getAttachmentType(id),
    syncStateSync: () => null,
    setItemSync: (k, v) => db.setItem(k, v),
    getItemSync: (k) => db.getItem(k),
    removeItemSync: (k) => db.removeItem(k),
    putAttachment: (id: string, d: Uint8Array, t: string) => db.postAttachment(id, d, t),
    getAttachment: (id) => db.getAttachment(id),
  }

  const caps = {
    platform: 'web',
    support: (name: string) => findApi(name)?.support.web ?? 'none',
    emit(name: string, ...args: unknown[]) {
      listeners.get(name)?.forEach((fn) => fn(...args))
    },
    async request(name: string, ...args: unknown[]) {
      const h = requests.get(name)
      if (!h) throw new Error(`插件没有处理 ${name}`)
      return h(...args)
    },
    whenReady: () => ready,

    system: {
      os: detectOs(),
      dataPathSync: () => '/data',
      tempPathSync: () => '/temp',
      getPathSync: (n: string) => (n === 'home' ? '/home' : n === 'temp' ? '/tmp' : n === 'downloads' && o.downloadsDir ? o.downloadsDir : `/home/${n}`),
      isDarkSync: () => matchMedia('(prefers-color-scheme: dark)').matches,
      deviceIdSync: () => {
        const k = `whatevertools:${o.pluginId}:device`
        let v = localStorage.getItem(k)
        if (!v) localStorage.setItem(k, (v = crypto.randomUUID().replace(/-/g, '')))
        return v
      },
      userSync: () => null,
      purchasedSync: () => true,
    },

    events: {
      on: (name: string, fn: (...a: any[]) => void) => {
        let s = listeners.get(name)
        if (!s) listeners.set(name, (s = new Set()))
        s.add(fn)
      },
      ready: () => readyResolve(),
      onRequest: (name: string, fn: (...a: any[]) => unknown) => void requests.set(name, fn),
    },

    permissions: {
      checkSync: (p: string, scope?: string) => o.permissions.checkSync(o.pluginId, p, scope),
      check: (p: string, scope?: string) => o.permissions.permit(o.pluginId, p, scope).then(() => true, () => false),
    },

    db: dbCap,
    fs: Object.assign(o.vfs, {
      pathForFile: (file: unknown) => {
        const f = file as File
        if (!f || typeof f.arrayBuffer !== 'function') return ''
        return o.vfs.mountLazy(`/drop/${Date.now()}-${f.name}`, async () => new Uint8Array(await f.arrayBuffer()), f.size)
      },
    }),

    clipboard: {
      readTextSync: () => clipText,
      writeTextSync: (t: string) => {
        clipText = t
        void navigator.clipboard?.writeText(t).catch(() => {})
      },
      writeImageSync: (img: ImageInput) => {
        const png = toPng(img, o.vfs)
        if (!png || !(globalThis as any).ClipboardItem) return false
        void navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })]).catch(() => {})
        return true
      },
      readFilesSync: () => [],
      readText: () => navigator.clipboard.readText(),
      writeText: (t: string) => navigator.clipboard.writeText(t),
    },

    notification: {
      show: (body: string, opts?: { title?: string }) => {
        const show = () => new Notification(opts?.title ?? o.pluginName, { body })
        if (Notification.permission === 'granted') show()
        else if (Notification.permission !== 'denied') void Notification.requestPermission().then((p) => p === 'granted' && show())
      },
    },

    shell: { openExternal: async (u: string) => void window.open(u, '_blank', 'noopener'), ...o.shell },
    dialog: o.dialog,

    screen: {
      getAllDisplaysSync: () => [display()],
      getPrimaryDisplaySync: display,
      getCursorScreenPointSync: () => cursor,
      getDisplayNearestPointSync: display,
      getDisplayMatchingSync: display,
    },

    window: {
      kind: o.windowKind,
      createSync: (url: string, options: Record<string, any>, onLoad: () => void): WindowHandle => {
        const id = ++seq
        const u = new URL(url, o.base)
        u.searchParams.set('__whatevertoolsWin', String(id))
        u.searchParams.set('__whatevertoolsParent', String(o.windowId))
        const preload = options?.webPreferences?.preload
        if (preload) u.searchParams.set('__whatevertoolsPreload', String(preload))
        const feat = [options?.width && `width=${options.width}`, options?.height && `height=${options.height}`, options?.x !== undefined && `left=${options.x}`, options?.y !== undefined && `top=${options.y}`].filter(Boolean).join(',')
        const w = window.open(u.href, `whatevertools-${id}`, feat || 'popup')
        if (!w) throw new Error('[whatevertools] 浏览器拦截了弹出窗口')
        children.set(id, w)
        w.addEventListener('load', () => onLoad())
        const closedFns: Array<() => void> = []
        const timer = setInterval(() => {
          if (w.closed) {
            clearInterval(timer)
            children.delete(id)
            closedFns.forEach((f) => f())
          }
        }, 500)
        const call = (target: 'win' | 'wc', method: string, args: any[]): unknown => {
          if (method === 'isDestroyed') return w.closed
          if (w.closed) throw new Error('Object has been destroyed')
          if (target === 'wc') {
            if (method === 'send') return void w.postMessage({ [IPC]: true, channel: args[0], args: args.slice(1), from: o.windowId }, location.origin)
            if (method === 'executeJavaScript') return Promise.resolve((w as any).eval(String(args[0])))
            if (method === 'getURL') return w.location.href
            if (method === 'openDevTools' || method === 'invalidate' || method === 'setBackgroundThrottling') return
            throw Object.assign(new Error(`[whatevertools] 浏览器端不支持 webContents.${method}`), { code: 'EWTUNSUPPORTED' })
          }
          switch (method) {
            case 'close': case 'destroy': return w.close()
            case 'focus': case 'show': case 'showInactive': return w.focus()
            case 'blur': case 'hide': return w.blur()
            case 'isVisible': return !w.closed
            case 'isFocused': return w.document.hasFocus()
            case 'getBounds': return { x: w.screenX, y: w.screenY, width: w.outerWidth, height: w.outerHeight }
            case 'setBounds': {
              const b = args[0] ?? {}
              if (b.x !== undefined) w.moveTo(b.x, b.y ?? w.screenY)
              if (b.width !== undefined) w.resizeTo(b.width, b.height ?? w.outerHeight)
              return
            }
            case 'setPosition': return w.moveTo(args[0], args[1])
            case 'setSize': return w.resizeTo(args[0], args[1])
            case 'getPosition': return [w.screenX, w.screenY]
            case 'getSize': return [w.outerWidth, w.outerHeight]
            case 'setTitle': w.document.title = String(args[0]); return
            case 'getTitle': return w.document.title
            case 'loadURL': return Promise.resolve(void (w.location.href = String(args[0])))
            // 浏览器做不到的窗口外观控制：静默忽略（支持程度在规格表里标为 partial）
            case 'setAlwaysOnTop': case 'setIgnoreMouseEvents': case 'setVisibleOnAllWorkspaces': case 'moveTop': case 'setSkipTaskbar': case 'setOpacity': case 'setHasShadow': case 'setResizable': return
            default:
              throw Object.assign(new Error(`[whatevertools] 浏览器端不支持窗口方法 ${method}`), { code: 'EWTUNSUPPORTED' })
          }
        }
        return {
          id,
          webContentsId: id,
          callSync: call,
          call: async (t, m, a) => call(t, m, a),
          onClosed: (fn) => void closedFns.push(fn),
        }
      },
      setPanelHeightSync: () => true,
      exitSync: () => {},
    },

    ipc: {
      sendToParent: (channel: string, args: unknown[]) => {
        window.opener?.postMessage({ [IPC]: true, channel, args, from: o.windowId }, location.origin)
      },
      on: (channel: string, fn: (...a: any[]) => void) => {
        let s = ipcListeners.get(channel)
        if (!s) ipcListeners.set(channel, (s = new Set()))
        s.add(fn)
      },
      off: (channel: string, fn: (...a: any[]) => void) => void ipcListeners.get(channel)?.delete(fn),
    },

    image: {
      sharp: o.sharp,
      fromPathSync: (p: string) => {
        try {
          const png = o.vfs.readFileSync(p)
          return { png, ...imageSize(png) }
        } catch {
          return null
        }
      },
    },

    ai: o.ai,
    tools: { register: () => {} },

    // 定时任务和动态功能用 core 的引擎（存储在 localStorage）；页面开着时才会触发
    schedule: {
      request: async (s: any) => {
        if (!o.permissions.checkSync(o.pluginId, 'schedule', s?.label)) return
        try {
          o.scheduler.add(o.pluginId, s)
        } catch (e) {
          console.warn('[whatevertools] 定时任务没有创建：', (e as Error).message)
        }
      },
      listSync: () => o.scheduler.list(o.pluginId),
      removeSync: (code: string) => o.scheduler.remove(o.pluginId, code),
    },

    features: {
      getSync: (codes?: string[]) => o.features.list(o.pluginId, codes),
      setSync: (f: any) => o.features.set(o.pluginId, f, o.staticFeatureCodes),
      removeSync: (code: string) => o.features.remove(o.pluginId, code),
    },
  }
  return caps as any
}
