// AI：模型由宿主提供（HostOptions.ai），插件注册的工具通过请求回到插件进程执行
import { CH } from '../../shared/protocol'
import type { Handler } from '../types'

const aborts = new Map<string, AbortController>()

export const aiSvc: Record<string, Handler> = {
  'ai.models': (c) => c.host.provider(c.plugin, 'ai', 'models', [], () => []),
  'ai.chat': async (c, req: { model?: string; messages: any[]; tools?: any[]; streamId: string; stream: boolean }) => {
    const ac = new AbortController()
    const key = `${c.plugin.id}\u0000${req.streamId}`
    aborts.set(key, ac)
    try {
      return await c.host.provider(c.plugin, 'ai', 'complete', [
        { model: req.model, messages: req.messages, tools: req.tools },
        {
          signal: ac.signal,
          onChunk: req.stream ? (chunk: unknown) => !c.wc.isDestroyed() && c.wc.send(CH.event, '__aiChunk', req.streamId, chunk) : undefined,
          // 工具出错不让整个对话失败：把错误作为工具结果交回模型
          callTool: (name: string, args: unknown) => c.host.requestTo(c.wc, 'tool', [name, args], 10 * 60 * 1000).catch((e: Error) => ({ error: e.message })),
        },
      ], () => {
        throw Object.assign(new Error('[whatevertools] 宿主没有配置 AI 模型（providers.ai）'), { code: 'EWTUNSUPPORTED' })
      })
    } finally {
      aborts.delete(key)
    }
  },
  // 只能中止自己插件的调用
  __aiAbort: (c, streamId: string) => {
    aborts.get(`${c.plugin.id}\u0000${streamId}`)?.abort()
  },
}
