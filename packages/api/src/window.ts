// createBrowserWindow 返回的窗口代理：属性 id / webContents.id 本地保存，方法按白名单转给平台
import { WINDOW_ASYNC_METHODS, WINDOW_METHODS, WEBCONTENTS_METHODS, type Capabilities, type WindowHandle } from '@whatevertools/core'
import { wrapImagesDeep } from './image'

export function windowProxy(caps: Capabilities, h: WindowHandle): any {
  let destroyed = false
  h.onClosed(() => (destroyed = true))
  const build = (target: 'win' | 'wc', methods: string[]) => {
    const o: Record<string, unknown> = {}
    for (const m of methods) {
      o[m] = (...args: unknown[]) => {
        if (m === 'isDestroyed' && destroyed) return true
        // 回调过不了进程边界：print(options, cb) 改成异步调用，结果回来后在本地调回调
        if (m === 'print') {
          const cb = args.find((a) => typeof a === 'function') as ((ok: boolean, err?: string) => void) | undefined
          h.call(target, m, args.filter((a) => typeof a !== 'function')).then((r: any) => cb?.(r?.success ?? true, r?.failureReason), (e: Error) => cb?.(false, e.message))
          return
        }
        if (WINDOW_ASYNC_METHODS.has(m)) return h.call(target, m, args).then((v) => wrapImagesDeep(caps, v))
        return wrapImagesDeep(caps, h.callSync(target, m, args))
      }
    }
    return o
  }
  const webContents = { id: h.webContentsId, ...build('wc', WEBCONTENTS_METHODS) }
  const win = { id: h.id, webContents, ...build('win', WINDOW_METHODS) }
  // 旧平台不支持窗口实例事件，这里明确报错，避免静默失效
  for (const o of [win, webContents] as Record<string, unknown>[]) {
    for (const m of ['on', 'once', 'addListener', 'removeListener', 'off']) {
      o[m] = () => {
        throw new Error('[whatevertools] 窗口对象不支持事件监听（与旧平台一致），请用 ipc 通信')
      }
    }
  }
  return win
}
