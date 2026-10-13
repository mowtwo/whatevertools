// HTTP 同步协议（v1）：
//   POST {base}/v1/{namespace}/push   body: { changes: SyncChange[] }        → { ok: true }
//   GET  {base}/v1/{namespace}/pull?cursor=<n>&limit=<n>                    → { changes, cursor }
//   鉴权：Authorization: Bearer <token>（可选）
// 只用 fetch，浏览器和 Node 18+ 都能用。参考服务端见 ./server。
import type { SyncAdapter, SyncChange } from '@whatevertools/core'

export interface HttpSyncOptions {
  baseUrl: string
  token?: string
  /** 单次拉取上限 */
  limit?: number
  fetch?: typeof fetch
}

export class HttpSync implements SyncAdapter {
  readonly name = 'http'
  constructor(private opts: HttpSyncOptions) {}

  private url(ns: string, action: string, query = '') {
    return `${this.opts.baseUrl.replace(/\/+$/, '')}/v1/${encodeURIComponent(ns)}/${action}${query}`
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (this.opts.token) h.authorization = `Bearer ${this.opts.token}`
    return h
  }

  private async json(res: Response) {
    if (!res.ok) throw new Error(`sync-http ${res.status}: ${await res.text().catch(() => '')}`)
    return res.json()
  }

  async push(ns: string, changes: SyncChange[]) {
    if (!changes.length) return
    const f = this.opts.fetch ?? fetch
    await this.json(await f(this.url(ns, 'push'), { method: 'POST', headers: this.headers(), body: JSON.stringify({ changes }) }))
  }

  async pull(ns: string, cursor: string | null) {
    const f = this.opts.fetch ?? fetch
    const q = `?cursor=${encodeURIComponent(cursor ?? '0')}&limit=${this.opts.limit ?? 500}`
    const body = await this.json(await f(this.url(ns, 'pull', q), { headers: this.headers() }))
    return { changes: body.changes as SyncChange[], cursor: String(body.cursor) }
  }
}

export { createSyncServer, type SyncServerOptions } from './server'
