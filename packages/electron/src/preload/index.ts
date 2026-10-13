// 预加载桥：所有插件窗口（主界面和自定义窗口）的 preload 都是它。
// 1. 向 main 取上下文 2. 加载宿主的渲染进程 hook 3. 用能力拼出 API 并注入全局
// 4. 安装 require 拦截 5. 加载插件自己的 preload 6. 页面加载完后通知就绪
import { ipcRenderer } from 'electron'
import { HookRegistry } from '@whatevertools/core'
import { createApi, exposeApi } from '@whatevertools/api'
import { CH, type BridgeContext } from '../shared/protocol'
import { createElectronCaps, PermCache } from './caps'
import { installGuard } from './guard'

function main() {
  const ctx: BridgeContext | null = ipcRenderer.sendSync(CH.context)
  if (!ctx) return
  const hooks = new HookRegistry()
  for (const file of ctx.rendererHooks) {
    try {
      const mod = require(file)
      ;(mod.default ?? mod)(hooks, ctx)
    } catch (e) {
      console.error(`[whatevertools] 渲染进程 hook 加载失败：${file}`, e)
    }
  }
  const perms = new PermCache(ctx.grants)
  const caps = createElectronCaps(ctx, perms, hooks)
  const inst = createApi(caps, { identity: ctx.identity, manifest: ctx.manifest, isDev: ctx.isDev, unsupported: ctx.unsupported, hooks })
  const expose = (name: string, value: unknown) => Object.defineProperty(window, name, { value, writable: false, configurable: false, enumerable: false })
  exposeApi(ctx.apiName, inst.api)
  // 兼容层按模块路径加载（宿主决定启用哪些），用原生 API 生成兼容对象
  for (const layer of ctx.compat) {
    try {
      const desc = require(layer.module).compat
      expose(layer.name, desc.createApi(inst.raw, { name: layer.name, hooks }))
    } catch (e) {
      console.error(`[whatevertools] 兼容层加载失败：${layer.module}`, e)
    }
  }
  installGuard({ ctx, perms, hooks })
  if (ctx.preload) {
    try {
      require(ctx.preload)
    } catch (e) {
      console.error(`[whatevertools] 插件 preload 出错：${ctx.preload}`, e)
    }
  }
  if (ctx.windowKind === 'main') {
    // 等页面完全加载（含 defer / module 脚本）再报就绪；进入事件在 API 层还有缓存兜底
    const start = () => void inst.start()
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
  }
}

main()
