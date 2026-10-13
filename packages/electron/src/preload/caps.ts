// Electron 平台的能力实现（渲染进程侧）：几乎都通过 IPC 交给 main，由 main 检查权限并执行
import { ipcRenderer, nativeImage } from 'electron'
import { findApi, type Capabilities, type ImageData, type WindowHandle, type Grant } from '@whatevertools/core'
import { CH, type BridgeContext, type PermResult, type WireError } from '../shared/protocol'

function rehydrate(e: WireError): Error {
  return Object.assign(new Error(e.message), { code: e.code, name: e.name && e.name !== 'Error' ? e.name : 'Error', data: e.data })
}

export function sync<T = any>(method: string, ...args: unknown[]): T {
  const r = ipcRenderer.sendSync(CH.sync, method, args)
  if (!r) throw new Error(`[whatevertools] ${method} 没有返回`)
  if (r.error) throw rehydrate(r.error)
  return r.value
}

export async function call<T = any>(method: string, ...args: unknown[]): Promise<T> {
  const r = await ipcRenderer.invoke(CH.call, method, args)
  if (r.error) throw rehydrate(r.error)
  return r.value
}

function toImage(v: any): ImageData | null {
  return v && v.__whatevertoolsImage ? { png: v.png, width: v.width, height: v.height } : null
}

function imagesDeep(v: any, depth = 0): any {
  if (!v || typeof v !== 'object' || depth > 5 || v instanceof Uint8Array) return v
  if (v.__whatevertoolsImage) return toImage(v)
  if (Array.isArray(v)) return v.map((x) => imagesDeep(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = imagesDeep(x, depth + 1)
  return out
}

/** 渲染进程的权限缓存：grant / deny 结论（无作用域）由 main 推送；带作用域的授予按路径记住 */
export class PermCache {
  grants: Record<string, Grant>
  private memo = new Map<string, boolean>()
  constructor(initial: Record<string, Grant>) {
    this.grants = initial
  }
  update(g: Record<string, Grant>) {
    this.grants = g
    this.memo.clear()
  }
  /** 只看已有结论，不询问 */
  peek(permission: string): boolean {
    return this.grants[permission]?.decision === 'grant'
  }
  check(permission: string, scope?: string): boolean {
    const g = this.grants[permission]
    if (g?.decision === 'grant') return true
    if (g?.decision === 'deny') return false
    const key = `${permission}\u0000${scope ?? ''}`
    const hit = this.memo.get(key)
    if (hit !== undefined) return hit
    const r: PermResult = ipcRenderer.sendSync(CH.perm, permission, scope)
    const ok = r?.decision === 'grant'
    if (ok) {
      if (r.cacheable) this.grants[permission] = { decision: 'grant' }
      else this.memo.set(key, true)
    }
    return ok
  }
}

type Listener = (...args: any[]) => void

export function createElectronCaps(ctx: BridgeContext, perms: PermCache, hooks?: import('@whatevertools/core').HookRegistry): Capabilities {
  const listeners = new Map<string, Set<Listener>>()
  const requestHandlers = new Map<string, (...a: any[]) => unknown>()
  const winLoad = new Map<number, () => void>()
  const winClosed = new Map<number, Array<() => void>>()
  const tools = new Map<string, (p: any, c?: any) => unknown>()
  const aiStreams = new Map<string, (chunk: unknown) => void>()

  ipcRenderer.on(CH.event, (_e, name: string, ...args: unknown[]) => {
    if (name === '__grants') return perms.update(args[0] as Record<string, Grant>)
    if (name === '__winReady') {
      const f = winLoad.get(args[0] as number)
      winLoad.delete(args[0] as number)
      return f?.()
    }
    if (name === '__winClosed') {
      const id = args[0] as number
      winClosed.get(id)?.forEach((f) => f())
      winClosed.delete(id)
      winLoad.delete(id)
      return
    }
    if (name === '__aiChunk') return aiStreams.get(args[0] as string)?.(args[1])
    listeners.get(name)?.forEach((fn) => {
      try {
        fn(...args)
      } catch (e) {
        console.error(`[whatevertools] ${name} 回调出错`, e)
      }
    })
  })

  ipcRenderer.on(CH.request, async (_e, id: string, name: string, ...args: unknown[]) => {
    try {
      let value: unknown
      if (name === 'tool') {
        const [toolName, params, meta] = args as [string, Record<string, unknown>, { requestId: string | number; progressStream?: string } | undefined]
        const h = tools.get(toolName)
        if (!h) throw new Error(`没有注册工具 ${toolName}`)
        const tctx = meta
          ? {
              requestId: meta.requestId,
              sendProgress: async (p: unknown) => {
                if (meta.progressStream) ipcRenderer.send(CH.stream, meta.progressStream, p)
              },
            }
          : undefined
        value = await h(params, tctx)
      } else {
        const h = requestHandlers.get(name)
        if (!h) throw new Error(`插件没有处理 ${name}`)
        value = await h(...args)
      }
      ipcRenderer.send(CH.reply, id, true, value === undefined ? null : JSON.parse(JSON.stringify(value)))
    } catch (err: any) {
      ipcRenderer.send(CH.reply, id, false, { message: String(err?.message ?? err), code: err?.code })
    }
  })

  const localPerm = (p: string) => {
    if (!perms.check(p)) throw Object.assign(new Error(`[whatevertools] 插件「${ctx.pluginId}」没有权限 ${p}`), { code: 'EWTPERM', permission: p })
  }

  let sharpMod: any
  const kind = ctx.windowKind

  // sharp 是原生模块，读写文件不经过 fs，单独按路径检查（插件自己的目录可读、私有目录可读写）
  const pathAllowed = (p: string, mode: 'read' | 'write') => {
    const path = require('node:path') as typeof import('node:path')
    const abs = path.resolve(p)
    const inside = (d: string) => {
      const rel = path.relative(d, abs)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    }
    if (mode === 'read' && inside(ctx.paths.dir)) return
    if (inside(ctx.paths.data) || inside(ctx.paths.temp)) return localPerm('fs.plugin')
    const perm = mode === 'read' ? 'fs.read' : 'fs.write'
    if (!perms.check(perm, abs)) throw Object.assign(new Error(`[whatevertools] 插件「${ctx.pluginId}」没有权限 ${perm}：${abs}`), { code: 'EWTPERM', permission: perm, scope: abs })
  }
  const guardSharpInput = (args: unknown[]) => {
    const input = args[0]
    if (typeof input === 'string') pathAllowed(input, 'read')
    else if (Array.isArray(input)) for (const i of input) if (typeof i === 'string') pathAllowed(i, 'read')
    return args
  }
  const guardSharp = (inst: any): any => {
    if (!inst || inst.__whatevertoolsGuarded) return inst
    const toFile = inst.toFile
    const clone = inst.clone
    const composite = inst.composite
    Object.defineProperties(inst, {
      __whatevertoolsGuarded: { value: true },
      toFile: { value: (file: string, cb?: unknown) => (pathAllowed(String(file), 'write'), toFile.call(inst, file, cb)), configurable: true },
      clone: { value: () => guardSharp(clone.call(inst)), configurable: true },
      composite: { value: (layers: Array<{ input?: unknown }>) => {
        for (const l of layers ?? []) if (typeof l?.input === 'string') pathAllowed(l.input, 'read')
        return composite.call(inst, layers)
      }, configurable: true },
    })
    return inst
  }

  return {
    platform: 'electron',
    enforcedByPlatform: true,
    support: (name) => findApi(name)?.support.electron ?? 'none',

    system: {
      os: process.platform as 'darwin' | 'win32' | 'linux',
      dataPathSync: () => sync('paths.data'),
      tempPathSync: () => sync('paths.temp'),
      getPathSync: (n) => sync('paths.get', n),
      isDarkSync: () => sync('system.isDark'),
      onThemeChange: (fn: (dark: boolean) => void) => {
        let set = listeners.get('theme.change')
        if (!set) listeners.set('theme.change', (set = new Set()))
        set.add(fn)
      },
      deviceIdSync: () => sync('device.id'),
      userSync: () => sync('account.user'),
      activeFolder: () => call('context.activeFolder'),
      activeBrowserUrl: () => call('context.activeBrowserUrl'),
      activeWindow: () => call('context.activeWindow'),
      purchasedSync: () => sync('billing.isPurchased'),
      openPurchase: (o) => call('billing.purchase', o),
    },

    events: {
      on: (name, fn) => {
        let set = listeners.get(name)
        if (!set) listeners.set(name, (set = new Set()))
        set.add(fn)
      },
      listening: (name) => ipcRenderer.send(CH.stream, '__listen', name),
      ready: () => ipcRenderer.send(CH.ready),
      onRequest: (name, fn) => void requestHandlers.set(name, fn),
    },

    permissions: {
      checkSync: (p, scope) => perms.check(p, scope),
    },

    db: {
      putSync: (doc) => sync('db.put', doc),
      getSync: (id) => sync('db.get', id),
      removeSync: (d) => sync('db.remove', d),
      bulkSync: (docs) => sync('db.bulk', docs),
      allSync: (f) => sync('db.all', f),
      putAttachmentSync: (id, data, type) => sync('db.putAttachment', id, data, type),
      getAttachmentSync: (id) => sync('db.getAttachment', id),
      getAttachmentTypeSync: (id) => sync('db.getAttachmentType', id),
      syncStateSync: () => sync('db.syncState'),
      setItemSync: (k, v) => sync('kv.set', k, v),
      getItemSync: (k) => sync('kv.get', k),
      removeItemSync: (k) => sync('kv.remove', k),
      putAttachment: (id, data, type) => call('db.putAttachment', id, data, type),
      getAttachment: (id) => call('db.getAttachment', id),
    },

    clipboard: {
      writeTextSync: (t) => void sync('clipboard.writeText', t),
      writeImageSync: (img) => sync('clipboard.writeImage', img),
      writeFilesSync: (p) => sync('clipboard.writeFiles', p),
      readFilesSync: () => sync<Array<{ path: string; name: string; isFile: boolean; isDirectory: boolean }> | null>('clipboard.readFiles') ?? [],
    },

    dialog: {
      showOpenDialogSync: (o) => sync('dialog.open', o),
      showSaveDialogSync: (o) => sync('dialog.save', o),
    },

    notification: { show: (body, o) => void sync('system.notify', body, o?.clickFeatureCode) },

    shell: {
      openPath: (p) => call('shell.openPath', p),
      showItemInFolder: (p) => void sync('shell.showInFolder', p),
      trashItem: (p) => call('shell.trash', p),
      openExternal: (u) => call('shell.openExternal', u),
      beep: () => void sync('shell.beep'),
    },

    screen: {
      getAllDisplaysSync: () => sync('screen.displays'),
      getPrimaryDisplaySync: () => sync('screen.primaryDisplay'),
      getCursorScreenPointSync: () => sync('screen.cursor'),
      getDisplayNearestPointSync: (p) => sync('screen.nearestDisplay', p),
      getDisplayMatchingSync: (r) => sync('screen.matchingDisplay', r),
      screenToDipPointSync: (p) => sync('screen.toDipPoint', p),
      dipToScreenPointSync: (p) => sync('screen.toScreenPoint', p),
      screenToDipRectSync: (r) => sync('screen.toDipRect', r),
      dipToScreenRectSync: (r) => sync('screen.toScreenRect', r),
    },

    capture: {
      captureDisplay: async (id) => imagesDeep(await call('screen.captureDisplay', { displayId: id })),
      selectRegion: async () => toImage(await call('screen.captureRegion'))!,
      pickColor: () => call('screen.pickColor'),
      desktopSources: async (o) => imagesDeep(await call('screen.captureSources', o)),
    },

    window: {
      // 主界面可能被分离成独立窗口，类型要实时取
      get kind() {
        return kind === 'custom' ? 'custom' : sync<'main' | 'detach'>('window.type')
      },
      createSync: (url, options, onLoad) => {
        const { id, wcId } = sync('window.create', url, options)
        winLoad.set(id, onLoad)
        const h: WindowHandle = {
          id,
          webContentsId: wcId,
          callSync: (target, method, args) => imagesDeep(sync('__win', id, target, method, args)),
          call: async (target, method, args) => imagesDeep(await call('__win', id, target, method, args)),
          onClosed: (fn) => {
            const list = winClosed.get(id) ?? []
            list.push(fn)
            winClosed.set(id, list)
          },
        }
        return h
      },
      hidePanelSync: (f) => sync('panel.hide', f),
      showPanelSync: () => sync('panel.show'),
      setPanelHeightSync: (h) => sync('panel.setHeight', h),
      panelInput: {
        setSync: (placeholder, focus) => sync('panel.input.set', placeholder, focus),
        removeSync: () => sync('panel.input.remove'),
        setValueSync: (t) => sync('panel.input.setValue', t),
        focusSync: () => sync('panel.input.focus'),
        blurSync: () => void sync('panel.input.blur'),
        selectSync: () => sync('panel.input.select'),
      },
      exitSync: (k) => void sync('lifecycle.exit', k),
      findSync: (t, o) => void sync('page.find', t, o),
      stopFindSync: (a) => void sync('page.stopFind', a),
    },

    ipc: {
      sendToParent: (channel, args) => {
        call('window.sendToParent', channel, ...args).catch((e) => console.error('[whatevertools] sendToParent', e))
      },
      on: (channel, fn) => void ipcRenderer.on(channel, fn as any),
      off: (channel, fn) => void ipcRenderer.removeListener(channel, fn),
    },

    input: {
      pasteTextSync: (t) => sync('input.sendText', t),
      pasteFilesSync: (p) => sync('input.sendFiles', p),
      pasteImageSync: (img) => sync('input.sendImage', img),
      typeStringSync: (t) => sync('input.typeText', t),
      startDragSync: (p) => void sync('input.startDrag', p),
      keyTap: (key, mods) => call('input.keyTap', key, ...mods),
      mouseMove: (x, y) => void sync('input.mouseMove', x, y),
      mouseClick: (x, y, button, double) => void sync(button === 'right' ? 'input.mouseRightClick' : double ? 'input.mouseDoubleClick' : 'input.mouseClick', x, y),
    },

    image: {
      get sharp() {
        return (...a: unknown[]) => {
          localPerm('image.sharp')
          if (!sharpMod) {
            // 渲染进程的提供者：宿主可以在 rendererHooks 里用 provider:image.sharp 换成别的实现
            const load = () => {
              try {
                return require('sharp')
              } catch (e: any) {
                throw new Error(`[whatevertools] 宿主没有安装 sharp：${e.message}`)
              }
            }
            sharpMod = hooks ? hooks.runApply('provider:image.sharp', { plugin: ctx.pluginId }, null, [], load) : load()
          }
          return guardSharp(sharpMod(...guardSharpInput(a)))
        }
      },
      wrap: (img) => nativeImage.createFromBuffer(Buffer.from(img.png)),
      fileIconSync: (p) => sync('system.fileIcon', p),
      fileIcon: (p) => call('system.fileIconAsync', p),
    },

    media: {
      runFFmpeg: (args, io) => {
        localPerm('media.ffmpeg')
        return runFfmpeg(sync<string>('__ffmpegPath', args) || 'ffmpeg', args, io)
      },
    },

    ai: {
      models: () => call('ai.models'),
      complete: async (req, io) => {
        const streamId = `ai${Math.random().toString(36).slice(2)}`
        if (io.onChunk) aiStreams.set(streamId, io.onChunk)
        // 工具调用由 main 通过 tool 请求回到这里，先把 ai 的工具处理函数放进同一张表
        const onAbort = () => call('__aiAbort', streamId).catch(() => {})
        io.signal.addEventListener('abort', onAbort)
        try {
          return await call('ai.chat', { ...req, streamId, stream: !!io.onChunk })
        } finally {
          aiStreams.delete(streamId)
          io.signal.removeEventListener('abort', onAbort)
        }
      },
    },

    tools: {
      register: (name, handler) => {
        tools.set(name, handler)
        ipcRenderer.send(CH.stream, '__tool', name)
      },
    },

    browser: {
      run: (steps, target) => call('__ubrowserRun', steps, target),
      idle: () => sync('browser.idle'),
      setProxy: (c) => void sync('browser.setProxy', c),
      clearCache: () => void sync('browser.clearCache'),
    },

    schedule: {
      request: (s) => call('schedule.request', s),
      listSync: () => sync('schedule.list'),
      removeSync: (code) => void sync('schedule.remove', code),
    },

    features: {
      getSync: (codes) => sync('features.list', codes),
      setSync: (f) => void sync('features.set', f),
      removeSync: (code) => sync('features.remove', code),
      launchSync: (label, payload) => sync('launch.open', label, payload),
      openHotkeySettingsSync: (label, autocopy) => void sync('hotkeys.openSettings', label, autocopy),
      hotkeySync: (label) => sync('hotkeys.get', label),
    },
  }
}

// ffmpeg：在插件进程里直接启动（宿主配置的路径或 PATH 里的 ffmpeg），解析 stderr 里的进度
function runFfmpeg(bin: string, args: string[], io: { onProgress?: (p: any) => void; onLog?: (t: string) => void }) {
  const { spawn } = require('node:child_process') as typeof import('node:child_process')
  const child = spawn(bin, ['-hide_banner', ...args], { stdio: ['pipe', 'ignore', 'pipe'] })
  let duration = 0
  let tail = ''
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`无法启动 ffmpeg（${bin}）：${e.message}`)))
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (text: string) => {
      io.onLog?.(text)
      tail = (tail + text).slice(-4000)
      const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(text)
      if (d) duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])
      const m = /frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+q=\s*([-\d.]+)\s+size=\s*(\S+)\s+time=\s*(\S+)\s+bitrate=\s*(\S+)\s+speed=\s*(\S+)/.exec(text)
      if (m && io.onProgress) {
        const t = /(\d+):(\d+):([\d.]+)/.exec(m[5])
        const sec = t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : 0
        io.onProgress({ frame: Number(m[1]), fps: Number(m[2]), q: Number(m[3]), size: m[4], time: m[5], bitrate: m[6], speed: m[7], percent: duration ? Math.min(100, (sec / duration) * 100) : undefined })
      }
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(tail.trim().split('\n').pop() || `ffmpeg 退出码 ${code}`))))
  })
  return { done, kill: () => child.kill('SIGKILL'), quit: () => child.stdin?.write('q') }
}
