// 参考服务端：每个 namespace 一个只追加的变更列表，游标就是下标。可选落盘到目录（JSONL）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { SyncChange } from '@whatevertools/core'

export interface SyncServerOptions {
  token?: string
  /** 落盘目录；不给则只在内存 */
  dir?: string
  /** 单个请求体上限（字节），默认 16MB */
  maxBody?: number
}

export function createSyncServer(opts: SyncServerOptions = {}) {
  const logs = new Map<string, SyncChange[]>()
  const load = (ns: string) => {
    let list = logs.get(ns)
    if (list) return list
    list = []
    if (opts.dir) {
      try {
        list = fs.readFileSync(path.join(opts.dir, `${ns}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      } catch {}
    }
    logs.set(ns, list)
    return list
  }
  const send = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' })
    res.end(JSON.stringify(body))
  }
  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {})
    if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) return send(res, 401, { error: 'unauthorized' })
    const url = new URL(req.url ?? '/', 'http://x')
    const m = /^\/v1\/([^/]+)\/(push|pull)$/.exec(url.pathname)
    if (!m) return send(res, 404, { error: 'not found' })
    let ns: string
    try {
      ns = decodeURIComponent(m[1]).replace(/[^\w.-]+/g, '_')
    } catch {
      return send(res, 400, { error: 'bad namespace' })
    }
    const list = load(ns)
    if (m[2] === 'pull' && req.method === 'GET') {
      const from = Math.max(0, Number(url.searchParams.get('cursor') ?? 0) || 0)
      const limit = Math.min(5000, Number(url.searchParams.get('limit') ?? 500) || 500)
      const changes = list.slice(from, from + limit)
      return send(res, 200, { changes, cursor: String(from + changes.length) })
    }
    if (m[2] === 'push' && req.method === 'POST') {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > (opts.maxBody ?? 16 * 1024 * 1024)) req.destroy()
        else chunks.push(c)
      })
      req.on('end', () => {
        try {
          const { changes } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!Array.isArray(changes)) return send(res, 400, { error: 'changes must be an array' })
          list.push(...changes)
          if (opts.dir) {
            fs.mkdirSync(opts.dir, { recursive: true })
            fs.appendFileSync(path.join(opts.dir, `${ns}.jsonl`), changes.map((c: unknown) => JSON.stringify(c)).join('\n') + '\n')
          }
          send(res, 200, { ok: true, cursor: String(list.length) })
        } catch (e) {
          send(res, 400, { error: (e as Error).message })
        }
      })
      return
    }
    send(res, 405, { error: 'method not allowed' })
  })
}
