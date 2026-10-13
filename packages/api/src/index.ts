// whatevertools 原生 API：按能力分命名空间，名字与具体平台无关。所有平台共用这一份实现，差异只在 Capabilities。
// 旧平台形状（如 uTools）由兼容层（@whatevertools/compat-utools）基于这里的对象映射出来。
import {
  findApi, HookRegistry, permissionError,
  type Capabilities, type Identity, type PluginManifest, type Support,
} from '@whatevertools/core'
import { CompatImage, wrapImage, wrapImagesDeep } from './image'
import { createAutomation } from './ubrowser'
import { windowProxy } from './window'

export { CompatImage, wrapImage, toBase64, fromBase64, isImageData } from './image'
export type { WhateverToolsApi } from './types'
import type { WhateverToolsApi } from './types'

export interface ApiContext {
  identity: Identity
  manifest: PluginManifest
  isDev: boolean
  /** 不支持的 API：throw 抛错（默认）/ warn 打印后返回 undefined */
  unsupported?: 'throw' | 'warn'
  hooks?: HookRegistry
  log?: (msg: string, data?: unknown) => void
}

export interface ApiInstance {
  /** 注入给插件的对象（已经过 hook 包装，hook 目标前缀 api:） */
  api: WhateverToolsApi
  /** 未包装的原始对象（兼容层基于它映射，映射后的对象再单独包装） */
  raw: WhateverToolsApi
  hooks: HookRegistry
  caps: Capabilities
  /** 页面加载完成后调用：等 lifecycle.onReady 回调结束，再通知平台就绪 */
  start(): Promise<void>
}

/** 不管注入名叫什么，运行时都会把原生 API 挂在这个全局 Symbol 上 */
export const API_SYMBOL = Symbol.for('whatevertools.api')

/** 取原生 API（插件代码用它就不依赖注入名，换成自定义名字的宿主也能运行） */
export function getApi(): WhateverToolsApi {
  const api = (globalThis as any)[API_SYMBOL]
  if (!api) throw new Error('[whatevertools] 当前环境没有注入 API')
  return api
}

/** 运行时用：把 API 挂到注入名和 Symbol 上 */
export function exposeApi(name: string, api: WhateverToolsApi) {
  const g = globalThis as any
  Object.defineProperty(g, name, { value: api, writable: false, configurable: false, enumerable: false })
  if (!g[API_SYMBOL]) Object.defineProperty(g, API_SYMBOL, { value: api, writable: false, configurable: false, enumerable: false })
}

export class UnsupportedError extends Error {
  code = 'EWTUNSUPPORTED'
}

export function createApi(caps: Capabilities, ctx: ApiContext): ApiInstance {
  const hooks = ctx.hooks ?? new HookRegistry()
  const log = ctx.log ?? ((m: string, d?: unknown) => console.warn(`[whatevertools] ${m}`, d ?? ''))
  const policy = ctx.unsupported ?? 'throw'

  const unsupported = (name: string): never => {
    const err = new UnsupportedError(`[whatevertools] 当前平台（${caps.platform}）不支持 ${name}`)
    if (policy === 'warn') {
      log(err.message)
      return undefined as never
    }
    throw err
  }

  /** API 层的权限检查（平台已检查时跳过） */
  const guard = (name: string, scope?: unknown) => {
    if (caps.enforcedByPlatform) return
    const spec = findApi(name)
    if (!spec?.permission) return
    const perms = Array.isArray(spec.permission) ? spec.permission : [spec.permission]
    const sc = typeof scope === 'string' ? scope : Array.isArray(scope) && typeof scope[0] === 'string' ? scope[0] : undefined
    for (const p of perms) if (!caps.permissions.checkSync(p, sc)) throw permissionError(ctx.identity.plugin.id, p, sc)
  }

  /** 当前平台实际没有实现的 API（supports() 据此返回 false，而不只看静态规格表） */
  const unavailable = new Set<string>()

  /** 包一个 API：先检查权限，能力缺失时按策略处理 */
  function def<A extends unknown[], R>(name: string, impl: ((...a: A) => R) | undefined | false, scopeArg?: number) {
    if (!impl) unavailable.add(name)
    return (...args: A): R => {
      if (!impl) return unsupported(name)
      guard(name, scopeArg !== undefined ? args[scopeArg] : undefined)
      return impl(...args)
    }
  }

  const sys = caps.system
  const win = caps.window
  const sub = win?.panelInput
  const scr = caps.screen
  const cap = caps.capture
  const clip = caps.clipboard
  const inp = caps.input
  const db = caps.db
  const feat = caps.features

  // ---------- 事件 ----------
  const readyCbs: Array<() => unknown> = []
  // 进入事件可能在插件注册监听之前到达（监听写在异步加载的代码里）：先缓存最后一次，注册时补发
  let pendingEnter: unknown[] | null = null
  let enterListening = false
  caps.events.on('enter' as any, (...args: unknown[]) => {
    if (!enterListening) pendingEnter = args
  })
  const listen = (event: string, name: string) => (fn: (...a: any[]) => void) => {
    caps.events.listening?.(event)
    const deliver = (...args: unknown[]) => hooks.runApply(`event:${name}`, {}, null, args, (a) => fn(...a))
    caps.events.on(event as any, deliver)
    if (event === 'enter') {
      enterListening = true
      if (pendingEnter) {
        const args = pendingEnter
        pendingEnter = null
        queueMicrotask(() => deliver(...args))
      }
    }
  }
  let searchInputCb: ((d: { text: string }) => void) | null = null
  caps.events.on('panel.input', (d: { text: string }) => searchInputCb?.(d))

  const tools = new Map<string, (params: any, ctx?: any) => unknown>()

  const callbackOrPromise = <T>(name: string, run: (() => Promise<T>) | undefined) => (cb?: (v: T) => void): any => {
    if (!run) return unsupported(name)
    guard(name)
    const p = run()
    if (typeof cb === 'function') {
      p.then(cb, () => {})
      return undefined
    }
    return p
  }

  /** NativeImage / CompatImage / ArrayBuffer → 能力层接受的图片输入 */
  const imageInput = (image: unknown): any => {
    if (image instanceof CompatImage) return { png: image.toPNG(), ...image.getSize() }
    if (image && typeof (image as any).toPNG === 'function') {
      const s = (image as any).getSize()
      return { png: new Uint8Array((image as any).toPNG()), width: s.width, height: s.height }
    }
    if (image instanceof ArrayBuffer) return new Uint8Array(image)
    return image
  }

  const raw: WhateverToolsApi = {
    identity: ctx.identity,
    supports(name: string): Support | false {
      const spec = findApi(name)
      if (!spec) return false
      if (unavailable.has(spec.name)) return false
      if (spec.name === 'image.sharp' && !caps.image?.sharp) return false
      if (spec.name === 'browser.automate' && !caps.browser) return false
      if ((spec.name === 'ai.chat' || spec.name === 'ai.models') && !caps.ai) return false
      const s = caps.support(spec.name)
      return s === 'none' ? false : s
    },
    permissions: {
      query: (p, scope) => caps.permissions.checkSync(p, scope),
      request: (p, scope) => (caps.permissions.check ? caps.permissions.check(p, scope) : Promise.resolve(caps.permissions.checkSync(p, scope))),
    },

    lifecycle: {
      onReady: (cb) => void readyCbs.push(cb),
      onEnter: listen('enter', 'lifecycle.onEnter'),
      onLeave: listen('leave', 'lifecycle.onLeave'),
      onDetach: listen('detach', 'lifecycle.onDetach'),
      onSearchPush: (provide, onSelect) => {
        caps.events.onRequest('searchPush', (a: unknown) => provide(a as any))
        if (onSelect) caps.events.onRequest('searchPush.select', (a: unknown) => onSelect(a as any))
      },
      exit: def('lifecycle.exit', win?.exitSync && ((kill = false) => win.exitSync!(!!kill))),
    },

    window: {
      get type() {
        return win?.kind ?? 'main'
      },
      create: def('window.create', win?.createSync && ((url: string, options: Record<string, unknown> = {}, onLoad?: () => void) => {
        let proxy: any
        let loaded = false
        const h = win.createSync!(url, options ?? {}, () => {
          loaded = true
          // 回调里会用到返回值，等返回之后再调
          if (proxy) onLoad?.call(proxy)
        })
        proxy = windowProxy(caps, h)
        if (loaded) queueMicrotask(() => onLoad?.call(proxy))
        return proxy
      })),
      sendToParent: def('window.sendToParent', caps.ipc && ((channel: string, ...args: unknown[]) => caps.ipc!.sendToParent(channel, args))),
    },

    panel: {
      hide: def('panel.hide', win?.hidePanelSync && ((focusPrev = true) => win.hidePanelSync!(focusPrev !== false))),
      show: def('panel.show', win?.showPanelSync && (() => win.showPanelSync!())),
      setHeight: def('panel.setHeight', win?.setPanelHeightSync && ((h: number) => win.setPanelHeightSync!(h))),
      // 面板输入框：插件把主搜索框借来当自己的输入框
      input: {
        set: def('panel.input.set', sub && ((onChange: (d: { text: string }) => void, placeholder = '', focus = true) => {
          if (win!.kind === 'custom') return false
          searchInputCb = typeof onChange === 'function' ? onChange : null
          return sub.setSync(String(placeholder ?? ''), focus !== false)
        })),
        remove: def('panel.input.remove', sub && (() => ((searchInputCb = null), sub.removeSync()))),
        setValue: def('panel.input.setValue', sub && ((t: string) => sub.setValueSync(String(t ?? '')))),
        focus: def('panel.input.focus', sub && (() => sub.focusSync())),
        blur: def('panel.input.blur', sub && (() => sub.blurSync())),
        select: def('panel.input.select', sub && (() => sub.selectSync())),
      },
    },

    page: {
      find: def('page.find', win?.findSync && ((t: string, o?: Record<string, unknown>) => win.findSync!(t, o))),
      stopFind: def('page.stopFind', win?.stopFindSync && ((a: string = 'clearSelection') => win.stopFindSync!(a))),
    },

    features: {
      list: def('features.list', feat && ((codes?: string[]) => feat.getSync(codes) as any)),
      set: def('features.set', feat && ((f: Record<string, unknown>) => feat.setSync(f))),
      remove: def('features.remove', feat && ((code: string) => feat.removeSync(code))),
    },

    launch: {
      open: def('launch.open', feat?.launchSync && ((target: string | [string, string], payload?: unknown) => feat.launchSync!(target, payload))),
    },

    hotkeys: {
      openSettings: def('hotkeys.openSettings', feat?.openHotkeySettingsSync && ((label: string, autocopy = false) => feat.openHotkeySettingsSync!(label, !!autocopy))),
      get: def('hotkeys.get', feat?.hotkeySync && ((label: string) => feat.hotkeySync!(label))),
    },

    db: {
      put: def('db.put', db && ((doc) => db.putSync(doc) as any)),
      get: def('db.get', db && ((id) => db.getSync(id) as any)),
      remove: def('db.remove', db && ((d) => db.removeSync(d) as any)),
      bulk: def('db.bulk', db && ((docs) => db.bulkSync(docs) as any)),
      all: def('db.all', db && ((f?: string | string[]) => db.allSync(f) as any)),
      putAttachment: def('db.putAttachment', db?.putAttachmentSync && ((id: string, data: Uint8Array, type: string) => db.putAttachmentSync!(id, data, type) as any)),
      getAttachment: def('db.getAttachment', db?.getAttachmentSync && ((id: string) => db.getAttachmentSync!(id))),
      getAttachmentType: def('db.getAttachmentType', db && ((id: string) => db.getAttachmentTypeSync(id))),
      syncState: def('db.syncState', db && (() => db.syncStateSync())),
      onPull: listen('db.pull', 'db.onPull'),
      promises: {
        putAttachment: def('db.putAttachment', db && ((id: string, data: Uint8Array, type: string) => (db.putAttachment ? db.putAttachment(id, data, type) : Promise.resolve(db.putAttachmentSync?.(id, data, type))) as Promise<any>)),
        getAttachment: def('db.getAttachment', db && ((id: string) => (db.getAttachment ? db.getAttachment(id) : Promise.resolve(db.getAttachmentSync?.(id) ?? null)))),
      },
    },

    kv: {
      set: def('kv.set', db && ((k: string, v: unknown) => db.setItemSync(k, v))),
      get: def('kv.get', db && ((k: string) => db.getItemSync(k) as any)) as WhateverToolsApi['kv']['get'],
      remove: def('kv.remove', db && ((k: string) => db.removeItemSync(k))),
    },

    paths: {
      data: def('paths.data', () => sys.dataPathSync()),
      temp: def('paths.temp', () => sys.tempPathSync()),
      get: def('paths.get', sys.getPathSync && ((n: string) => sys.getPathSync!(n))),
    },

    system: {
      notify: def('system.notify', caps.notification && ((body: string, feature?: string) => caps.notification!.show(String(body ?? ''), { title: ctx.manifest.name, clickFeatureCode: feature }))),
      appName: () => ctx.identity.mock.platform.name,
      appVersion: () => ctx.identity.mock.platform.version,
      fileIcon: def('system.fileIcon', caps.image?.fileIconSync && ((p: string) => caps.image!.fileIconSync!(p))),
      fileIconAsync: def('system.fileIconAsync', caps.image?.fileIcon && ((p: string) => caps.image!.fileIcon!(p))),
      isDev: () => ctx.isDev,
      isMac: () => sys.os === 'darwin',
      isWindows: () => sys.os === 'win32',
      isLinux: () => sys.os === 'linux',
      isDark: () => sys.isDarkSync(),
      onThemeChange: listen('theme.change', 'system.onThemeChange'),
    },

    account: {
      user: def('account.user', () => sys.userSync?.() ?? null),
    },

    device: {
      id: def('device.id', sys.deviceIdSync && (() => sys.deviceIdSync!())),
    },

    context: {
      activeFolder: def('context.activeFolder', sys.activeFolder && (() => sys.activeFolder!())),
      activeBrowserUrl: def('context.activeBrowserUrl', sys.activeBrowserUrl && (() => sys.activeBrowserUrl!())),
      activeWindow: def('context.activeWindow', sys.activeWindow && (() => sys.activeWindow!() as Promise<any>)),
    },

    dialog: {
      open: def('dialog.open', caps.dialog?.showOpenDialogSync && ((o: Record<string, unknown> = {}) => caps.dialog!.showOpenDialogSync!(o))),
      save: def('dialog.save', caps.dialog?.showSaveDialogSync && ((o: Record<string, unknown> = {}) => caps.dialog!.showSaveDialogSync!(o))),
      openAsync: def('dialog.openAsync', caps.dialog && (caps.dialog.showOpenDialog || caps.dialog.showOpenDialogSync) && (async (o: Record<string, unknown> = {}) => (caps.dialog!.showOpenDialog ? caps.dialog!.showOpenDialog(o) : caps.dialog!.showOpenDialogSync!(o)))),
      saveAsync: def('dialog.saveAsync', caps.dialog && (caps.dialog.showSaveDialog || caps.dialog.showSaveDialogSync) && (async (o: Record<string, unknown> = {}) => (caps.dialog!.showSaveDialog ? caps.dialog!.showSaveDialog(o) : caps.dialog!.showSaveDialogSync!(o)))),
    },

    shell: {
      openPath: def('shell.openPath', caps.shell?.openPath && ((p: string) => caps.shell!.openPath!(p)), 0),
      trash: def('shell.trash', caps.shell?.trashItem && ((p: string) => caps.shell!.trashItem!(p)), 0),
      showInFolder: def('shell.showInFolder', caps.shell?.showItemInFolder && ((p: string) => caps.shell!.showItemInFolder!(p)), 0),
      openExternal: def('shell.openExternal', caps.shell && ((u: string) => caps.shell!.openExternal(u)), 0),
      beep: def('shell.beep', caps.shell?.beep && (() => caps.shell!.beep!())),
    },

    clipboard: {
      writeText: def('clipboard.writeText', clip?.writeTextSync && ((t: string) => (clip.writeTextSync!(String(t ?? '')), true))),
      writeImage: def('clipboard.writeImage', clip?.writeImageSync && ((img: unknown) => clip.writeImageSync!(imageInput(img)))),
      writeFiles: def('clipboard.writeFiles', clip?.writeFilesSync && ((p: string | string[]) => clip.writeFilesSync!(Array.isArray(p) ? p : [p]))),
      readFiles: def('clipboard.readFiles', clip?.readFilesSync && (() => {
        const list = clip.readFilesSync!() as Array<string | { path: string; name: string; isFile: boolean; isDirectory: boolean }>
        if (!list.length) return null
        return list.map((p) => {
          if (typeof p !== 'string') return p
          const st = caps.fs?.statSync?.(p)
          return { path: p, name: p.split(/[\\/]/).pop() ?? p, isFile: st ? st.isFile : true, isDirectory: !!st?.isDirectory }
        })
      })),
    },

    input: {
      sendText: def('input.sendText', inp?.pasteTextSync && ((t: string) => inp.pasteTextSync!(String(t ?? '')))),
      sendFiles: def('input.sendFiles', inp?.pasteFilesSync && ((p: string | string[]) => inp.pasteFilesSync!(Array.isArray(p) ? p : [p]))),
      sendImage: def('input.sendImage', inp?.pasteImageSync && ((img: unknown) => inp.pasteImageSync!(imageInput(img)))),
      typeText: def('input.typeText', inp?.typeStringSync && ((t: string) => inp.typeStringSync!(String(t ?? '')))),
      startDrag: def('input.startDrag', inp?.startDragSync && ((p: string | string[]) => inp.startDragSync!(Array.isArray(p) ? p : [p]))),
      keyTap: def('input.keyTap', inp?.keyTap && ((key: string, ...mods: string[]) => void inp.keyTap!(key, mods))),
      mouseMove: def('input.mouseMove', inp?.mouseMove && ((x: number, y: number) => inp.mouseMove!(x, y))),
      mouseClick: def('input.mouseClick', inp?.mouseClick && ((x: number, y: number) => inp.mouseClick!(x, y, 'left', false))),
      mouseDoubleClick: def('input.mouseDoubleClick', inp?.mouseClick && ((x: number, y: number) => inp.mouseClick!(x, y, 'left', true))),
      mouseRightClick: def('input.mouseRightClick', inp?.mouseClick && ((x: number, y: number) => inp.mouseClick!(x, y, 'right', false))),
    },

    screen: {
      displays: def('screen.displays', scr && (() => scr.getAllDisplaysSync())),
      primaryDisplay: def('screen.primaryDisplay', scr && (() => scr.getPrimaryDisplaySync())),
      cursor: def('screen.cursor', scr?.getCursorScreenPointSync && (() => scr.getCursorScreenPointSync!())),
      nearestDisplay: def('screen.nearestDisplay', scr?.getDisplayNearestPointSync && ((p) => scr.getDisplayNearestPointSync!(p))),
      matchingDisplay: def('screen.matchingDisplay', scr?.getDisplayMatchingSync && ((r) => scr.getDisplayMatchingSync!(r))),
      toDipPoint: def('screen.toDipPoint', scr && ((p) => scr.screenToDipPointSync?.(p) ?? p)),
      toScreenPoint: def('screen.toScreenPoint', scr && ((p) => scr.dipToScreenPointSync?.(p) ?? p)),
      toDipRect: def('screen.toDipRect', scr && ((r) => scr.screenToDipRectSync?.(r) ?? r)),
      toScreenRect: def('screen.toScreenRect', scr && ((r) => scr.dipToScreenRectSync?.(r) ?? r)),
      captureDisplay: def('screen.captureDisplay', cap?.captureDisplay && (async (displayId?: number) => wrapImagesDeep(caps, await cap.captureDisplay!(displayId)) as any)),
      captureRegion: callbackOrPromise('screen.captureRegion', cap?.selectRegion && (async () => (wrapImage(caps, await cap.selectRegion!()) as { toDataURL(): string }).toDataURL())),
      pickColor: callbackOrPromise('screen.pickColor', cap?.pickColor && (() => cap.pickColor!())),
      captureSources: def('screen.captureSources', cap?.desktopSources && (async (o: Record<string, unknown> = {}) => wrapImagesDeep(caps, await cap.desktopSources!(o)) as any)),
    },

    schedule: {
      request: def('schedule.request', caps.schedule && ((s) => caps.schedule!.request(s as any))),
      list: def('schedule.list', caps.schedule && (() => caps.schedule!.listSync() as any)),
      remove: def('schedule.remove', caps.schedule && ((code: string) => caps.schedule!.removeSync(code))),
      onTrigger: (cb) => caps.events.onRequest('schedule.trigger', (a: unknown) => cb(a as any)),
    },

    ai: {
      chat: def('ai.chat', caps.ai && ((options: any, onChunk?: (chunk: any) => void) => {
        const ac = new AbortController()
        const p = caps.ai!.complete(
          { model: options?.model, messages: options?.messages ?? [], tools: options?.tools },
          {
            onChunk: typeof onChunk === 'function' ? onChunk : undefined,
            signal: ac.signal,
            callTool: async (name, args) => {
              const h = tools.get(name)
              if (!h) throw new Error(`没有注册工具 ${name}`)
              return h(args)
            },
          },
        ).then((msg) => (typeof onChunk === 'function' ? undefined : msg))
        return Object.assign(p, { abort: () => ac.abort() }) as any
      })) as WhateverToolsApi['ai']['chat'],
      models: def('ai.models', caps.ai && (() => caps.ai!.models())),
    },

    tools: {
      register: def('tools.register', (name: string, handler: (p: any, c?: any) => unknown) => {
        if (typeof name !== 'string' || !name || typeof handler !== 'function') throw new Error('tools.register(name, handler)：参数无效')
        tools.set(name, handler)
        caps.tools?.register(name, handler)
      }),
    },

    media: {
      ffmpeg: def('media.ffmpeg', caps.media && ((args: string[], opt?: any) => {
        const io = typeof opt === 'function' ? { onProgress: opt } : (opt ?? {})
        const proc = caps.media!.runFFmpeg(args, io)
        return Object.assign(proc.done, { kill: () => proc.kill(), quit: () => proc.quit() })
      })),
    },

    image: {
      sharp: (...a: unknown[]) => {
        const s = caps.image?.sharp
        if (!s) return unsupported('image.sharp')
        guard('image.sharp')
        return s(...a)
      },
    },

    billing: {
      isPurchased: def('billing.isPurchased', () => sys.purchasedSync?.() ?? true),
      purchase: def('billing.purchase', (options: Record<string, unknown>, cb?: () => void) => {
        if (!sys.openPurchase) return unsupported('billing.purchase')
        sys.openPurchase(options).then((ok) => ok && cb?.(), () => {})
      }),
    },

    browser: {
      automate: () => {
        guard('browser.automate')
        return createAutomation(caps.browser, unsupported)
      },
      idle: def('browser.idle', caps.browser?.idle && (() => caps.browser!.idle!() as any)),
      setProxy: def('browser.setProxy', caps.browser?.setProxy && ((c: Record<string, unknown>) => caps.browser!.setProxy!(c))),
      clearCache: def('browser.clearCache', caps.browser?.clearCache && (() => caps.browser!.clearCache!())),
    },
  }

  const api = hooks.wrap(raw, 'api:', { plugin: ctx.identity.plugin.id }, { depth: 4 })

  return {
    api,
    raw,
    hooks,
    caps,
    async start() {
      for (const cb of readyCbs) {
        try {
          await cb()
        } catch (e) {
          log('lifecycle.onReady 回调出错', e)
        }
      }
      caps.events.ready()
    },
  }
}
