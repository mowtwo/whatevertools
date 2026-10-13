// MCP Server（Streamable HTTP，JSON 响应）：把所有插件 plugin.json 里声明的 tools 暴露给外部 AI Agent。
// 工具名 = <插件 id>_<工具名>；插件没运行时先在后台启动，等它 registerTool 后再调用。
// 第一次被调用时按插件询问 mcp 权限（与 Chrome「用时询问」一致）。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { RUNTIME_VERSION } from '@whatevertools/core'
import type { WhateverToolsHost } from '../host'
import type { PluginRuntime } from '../plugin'

const PROTOCOL = '2025-06-18'

export class McpServer {
  private server: http.Server | null = null
  private index = new Map<string, { plugin: PluginRuntime; tool: string }>()
  key = ''
  port = 0

  constructor(private host: WhateverToolsHost) {}

  refresh() {
    this.index.clear()
    for (const p of this.host.plugins.values()) {
      for (const tool of Object.keys(p.manifest.tools)) {
        let name = `${p.id.replace(/[^A-Za-z0-9_]/g, '_')}_${tool}`.slice(0, 64)
        if (this.index.has(name)) {
          this.host.log('warn', `MCP 工具名冲突：${name}，加序号区分`)
          let i = 2
          while (this.index.has(`${name.slice(0, 60)}_${i}`)) i++
          name = `${name.slice(0, 60)}_${i}`
        }
        this.index.set(name, { plugin: p, tool })
      }
    }
  }

  async start(port = 3530, hostname = '127.0.0.1') {
    if (this.server) return
    const keyFile = path.join(this.host.dataDir, 'mcp-key')
    try {
      this.key = fs.readFileSync(keyFile, 'utf8').trim()
    } catch {
      this.key = crypto.randomBytes(24).toString('hex')
      fs.writeFileSync(keyFile, this.key, { mode: 0o600 })
    }
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        this.host.log('warn', `MCP 请求出错：${(e as Error).message}`)
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal error' }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(port, hostname, () => resolve())
    })
    this.port = (this.server.address() as { port: number }).port
    this.host.log('info', `MCP server on http://${hostname}:${this.port}/mcp`)
  }

  stop() {
    this.server?.close()
    this.server = null
  }

  /** 给 MCP 客户端的配置（含密钥，只在本机使用） */
  clientConfig() {
    return { type: 'http', url: `http://127.0.0.1:${this.port}/mcp`, headers: { 'x-mcp-key': this.key } }
  }

  private authorized(req: http.IncomingMessage) {
    const k = req.headers['x-mcp-key'] ?? (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    const a = Buffer.from(String(k))
    const b = Buffer.from(this.key)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const send = (code: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers })
      res.end(body === undefined ? '' : JSON.stringify(body))
    }
    // 只接受本机网页以外的调用：带 Origin 的浏览器请求一律拒绝（防 DNS rebinding）
    if (req.headers.origin) return send(403, { error: 'origin not allowed' })
    let pathname = ''
    try {
      pathname = new URL(req.url ?? '/', 'http://x').pathname
    } catch {
      return send(400, { error: 'bad url' })
    }
    if (pathname !== '/mcp') return send(404, { error: 'not found' })
    if (!this.authorized(req)) return send(401, { error: 'unauthorized' })
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' }, { allow: 'POST' })
    const chunks: Buffer[] = []
    for await (const ch of req) chunks.push(ch as Buffer)
    let msg: any
    try {
      msg = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    const batch = Array.isArray(msg)
    // 单个 tools/call 带了 progressToken、客户端也接受 SSE：用事件流返回，过程中推送进度通知
    const token = !batch ? msg?.params?._meta?.progressToken : undefined
    if (!batch && msg?.method === 'tools/call' && token !== undefined && String(req.headers.accept ?? '').includes('text/event-stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const sendEvent = (data: unknown) => res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`)
      const reply = await this.rpc(msg, (p) => sendEvent({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, ...p } }))
      if (reply) sendEvent(reply)
      res.end()
      return
    }
    const replies = (await Promise.all((batch ? msg : [msg]).map((m: any) => this.rpc(m)))).filter(Boolean)
    if (!replies.length) return send(202)
    const extra: Record<string, string> = {}
    if (!batch && msg.method === 'initialize') extra['mcp-session-id'] = crypto.randomUUID()
    send(200, batch ? replies : replies[0], extra)
  }

  private async rpc(m: any, onProgress?: (p: { progress: number; total?: number; message?: string }) => void): Promise<unknown> {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'Invalid Request' } }
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result })
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } })
    if (m.id === undefined) return null // 通知
    switch (m.method) {
      case 'initialize': {
        const id = this.host.options.identity
        return ok({ protocolVersion: m.params?.protocolVersion ?? PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: id?.host?.name ?? 'whatevertools', version: id?.host?.version ?? RUNTIME_VERSION } })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({
          tools: [...this.index].map(([name, { plugin, tool }]) => {
            const d = plugin.manifest.tools[tool]
            return { name, title: `${plugin.manifest.name} · ${tool}`, description: d.description, inputSchema: d.inputSchema, ...(d.outputSchema ? { outputSchema: d.outputSchema } : {}) }
          }),
        })
      case 'tools/call': {
        const entry = this.index.get(m.params?.name)
        if (!entry) return fail(-32602, `Unknown tool: ${m.params?.name}`)
        try {
          const value = await this.callTool(entry.plugin, entry.tool, m.params?.arguments ?? {}, m.id, onProgress)
          const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
          const structured = value && typeof value === 'object' && !Array.isArray(value) ? { structuredContent: value } : {}
          return ok({ content: [{ type: 'text', text }], ...structured })
        } catch (e: any) {
          return ok({ content: [{ type: 'text', text: String(e?.message ?? e) }], isError: true })
        }
      }
      default:
        return fail(-32601, `Method not found: ${m.method}`)
    }
  }

  async callTool(plugin: PluginRuntime, tool: string, args: unknown, requestId: string | number, onProgress?: (p: { progress: number; total?: number; message?: string }) => void) {
    await this.host.permit(plugin, 'mcp')
    await this.host.start(plugin)
    await plugin.whenTool(tool, 15000)
    // 插件里 ctx.sendProgress 推来的进度
    const stream = this.host.openStream((p) => {
      const v = p as { progress?: unknown; total?: unknown; message?: unknown }
      if (onProgress && typeof v?.progress === 'number') onProgress({ progress: v.progress, total: typeof v.total === 'number' ? v.total : undefined, message: typeof v.message === 'string' ? v.message : undefined })
    }, plugin.mainWc!.id)
    try {
      return await this.host.request(plugin, 'tool', [tool, args, { requestId, progressStream: stream.id }], 10 * 60 * 1000)
    } finally {
      stream.close()
    }
  }
}
