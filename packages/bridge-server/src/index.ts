// bridge 守护进程：用 Node 实现能力，供浏览器里的 @whatevertools/bridge 调用。
// 协议（全部 JSON，二进制用 base64）：
//   POST /v1/call    { plugin, cap, method, args }          → { value } | { error }
//   POST /v1/spawn   { plugin, command, args, cwd }          → { id }
//   GET  /v1/proc/:id/events  (SSE: stdout / stderr / exit)
//   POST /v1/proc/:id/stdin   { data(base64) | end: true }   POST /v1/proc/:id/kill
// 安全：只监听 127.0.0.1；Authorization: Bearer <token>；Origin 必须在允许列表；
//      每个插件单独的权限（PermissionSet），fs 只能访问 roots 里的目录。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { PermissionSet, scopeMatches, type PermissionPolicy } from '@whatevertools/core'

export interface BridgeServerOptions {
  token?: string
  /** 允许的网页来源，如 ['http://localhost:5173']；'*' 表示任意（不建议） */
  origins: string[]
  /** fs 可访问的目录（绝对路径）；不在其中的路径一律拒绝 */
  roots: string[]
  policy?: PermissionPolicy
  /** 权限结论持久化文件 */
  grantsFile?: string
  /** 问用户的界面（默认系统原生对话框） */
  prompt?: (plugin: string, permission: string, scope?: string) => Promise<'once' | 'always' | 'block' | 'dismiss'>
  log?: (msg: string) => void
}

type Json = any

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

function statOf(p: string, lstat = false) {
  try {
    const s = lstat ? fs.lstatSync(p) : fs.statSync(p)
    return { size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, birthtimeMs: s.birthtimeMs, atimeMs: s.atimeMs, mode: s.mode, isFile: s.isFile(), isDirectory: s.isDirectory(), isSymbolicLink: s.isSymbolicLink() }
  } catch {
    return null
  }
}

function run(cmd: string, args: string[], input?: string) {
  return new Promise<string>((resolve, reject) => {
    const c = execFile(cmd, args, { timeout: 150000 }, (e, out) => (e ? reject(e) : resolve(String(out))))
    if (input !== undefined) {
      c.stdin?.end(input)
    }
  })
}

/** 系统原生对话框：macOS AppleScript / Windows PowerShell / Linux zenity；都不可用时拒绝 */
export async function nativePrompt(plugin: string, permission: string, scope?: string): Promise<'once' | 'always' | 'block' | 'dismiss'> {
  const msg = `插件「${plugin}」想要使用：${permission}${scope ? `\n范围：${scope}` : ''}`
  try {
    if (process.platform === 'darwin') {
      const out = await run('osascript', ['-e', `button returned of (display dialog ${JSON.stringify(msg)} with title "whatevertools bridge" buttons {"禁止", "仅本次", "始终允许"} default button "仅本次" cancel button "禁止" giving up after 120)`]).catch(() => '禁止')
      const b = out.trim()
      return b === '始终允许' ? 'always' : b === '仅本次' ? 'once' : b === '' ? 'dismiss' : 'block'
    }
    if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${JSON.stringify(msg + '\n\n是 = 始终允许，否 = 仅本次，取消 = 禁止')}, 'whatevertools bridge', 'YesNoCancel')`
      const b = (await run('powershell', ['-NoProfile', '-Command', ps])).trim()
      return b === 'Yes' ? 'always' : b === 'No' ? 'once' : 'block'
    }
    const b = await run('zenity', ['--question', '--title=whatevertools bridge', `--text=${msg}`, '--ok-label=仅本次', '--cancel-label=禁止']).then(() => 'once' as const, () => 'block' as const)
    return b
  } catch {
    return 'dismiss'
  }
}

export function createBridgeServer(opts: BridgeServerOptions) {
  const token = opts.token ?? crypto.randomBytes(24).toString('hex')
  const roots = opts.roots.map((r) => fs.realpathSync(path.resolve(r)))
  let grants: Record<string, Record<string, Json>> = {}
  if (opts.grantsFile) {
    try {
      grants = JSON.parse(fs.readFileSync(opts.grantsFile, 'utf8'))
    } catch {}
  }
  const sets = new Map<string, PermissionSet>()
  const perms = (plugin: string) => {
    let s = sets.get(plugin)
    if (!s) sets.set(plugin, (s = new PermissionSet(plugin, opts.policy ?? {}, {}, grants[plugin] ?? {})))
    return s
  }
  const procs = new Map<string, { child: ChildProcess; plugin: string; listeners: Set<(e: string, d: Json) => void>; buffer: Array<[string, Json]> }>()

  /** 路径必须在 roots 里（解析符号链接后再判断） */
  const resolvePath = (p: string) => {
    const abs = path.resolve(String(p))
    let real = abs
    try {
      real = fs.realpathSync(abs)
    } catch {
      try {
        real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs))
      } catch {}
    }
    if (!roots.some((r) => real === r || real.startsWith(r + path.sep))) throw Object.assign(new Error(`[whatevertools-bridge] 路径不在允许的目录里：${abs}`), { code: 'EACCES' })
    return real
  }

  /** 由守护进程自己弹系统对话框问用户（网页不能替用户回答） */
  const prompting = new Map<string, Promise<void>>()
  const askUser = (plugin: string, permission: string, scope?: string) => {
    const key = `${plugin}\u0000${permission}\u0000${scope ?? ''}`
    let p = prompting.get(key)
    if (!p) {
      p = (async () => {
        const answer = await (opts.prompt ?? nativePrompt)(plugin, permission, scope)
        const persisted = perms(plugin).answer(permission, answer, scope ? [scope] : undefined)
        if (answer === 'once' && scope && permission.startsWith('fs.')) perms(plugin).grantPath(permission as 'fs.read' | 'fs.write', scope)
        if (persisted && opts.grantsFile) {
          grants[plugin] = perms(plugin).rememberedGrants()
          fs.writeFileSync(opts.grantsFile, JSON.stringify(grants, null, 2))
        }
      })().finally(() => prompting.delete(key))
      prompting.set(key, p)
    }
    return p
  }

  const need = async (plugin: string, permission: string, scope?: string) => {
    let d = perms(plugin).check(permission, scope)
    if (d === 'ask') {
      await askUser(plugin, permission, scope)
      d = perms(plugin).check(permission, scope)
    }
    if (d !== 'grant') throw Object.assign(new Error(`[whatevertools-bridge] 插件「${plugin}」没有权限 ${permission}${scope ? `：${scope}` : ''}`), { code: 'EWTPERM', permission, scope })
  }

  const fsRead = async (plugin: string, p: string) => {
    const r = resolvePath(p)
    await need(plugin, 'fs.read', r)
    return r
  }
  const fsWrite = async (plugin: string, p: string) => {
    const r = resolvePath(p)
    await need(plugin, 'fs.write', r)
    return r
  }

  const caps: Record<string, Record<string, (plugin: string, ...a: Json[]) => Json>> = {
    fs: {
      readFile: async (pl, p) => b64(fs.readFileSync(await fsRead(pl, p))),
      writeFile: async (pl, p, data, o) => fs.writeFileSync(await fsWrite(pl, p), unb64(data), { flag: o?.append ? 'a' : 'w' }),
      stat: async (pl, p, o) => statOf(await fsRead(pl, p), o?.lstat),
      readdir: async (pl, p) => fs.readdirSync(await fsRead(pl, p), { withFileTypes: true }).map((d) => ({ name: d.name, isFile: d.isFile(), isDirectory: d.isDirectory(), isSymbolicLink: d.isSymbolicLink() })),
      mkdir: async (pl, p, o) => void fs.mkdirSync(await fsWrite(pl, p), { recursive: !!o?.recursive }),
      rm: async (pl, p, o) => fs.rmSync(await fsWrite(pl, p), { recursive: !!o?.recursive, force: !!o?.force }),
      rename: async (pl, a, b) => fs.renameSync(await fsWrite(pl, a), await fsWrite(pl, b)),
      copyFile: async (pl, a, b) => fs.copyFileSync(await fsRead(pl, a), await fsWrite(pl, b)),
      realpath: (pl, p) => fsRead(pl, p),
    },
    clipboard: {
      readText: async (pl) => {
        await need(pl, 'clipboard.read')
        if (process.platform === 'darwin') return run('pbpaste', [])
        if (process.platform === 'win32') return run('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'])
        return run('xclip', ['-selection', 'clipboard', '-o'])
      },
      writeText: async (pl, text) => {
        await need(pl, 'clipboard.write')
        if (process.platform === 'darwin') return void (await run('pbcopy', [], String(text)))
        if (process.platform === 'win32') return void (await run('powershell', ['-NoProfile', '-Command', '$input | Set-Clipboard'], String(text)))
        return void (await run('xclip', ['-selection', 'clipboard'], String(text)))
      },
    },
    shell: {
      openPath: async (pl, p) => {
        const r = resolvePath(p)
        await need(pl, 'shell.open', r)
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
        try {
          await run(cmd, [r])
          return ''
        } catch (e) {
          return String((e as Error).message)
        }
      },
      showItemInFolder: async (pl, p) => {
        const r = resolvePath(p)
        await need(pl, 'shell.open', r)
        if (process.platform === 'darwin') await run('open', ['-R', r])
        else if (process.platform === 'win32') await run('explorer', [`/select,${r}`])
        else await run('xdg-open', [path.dirname(r)])
      },
      trashItem: async (pl, p) => {
        const r = resolvePath(p)
        await need(pl, 'shell.trash', r)
        if (process.platform === 'darwin') return void (await run('osascript', ['-e', `tell application "Finder" to delete POSIX file ${JSON.stringify(r)}`]))
        throw new Error('[whatevertools-bridge] 当前平台不支持移到废纸篓')
      },
    },
    system: {
      env: async (pl) => (await need(pl, 'process.spawn'), { ...process.env }),
      home: () => require('node:os').homedir(),
      platform: () => process.platform,
    },
    permissions: {
      // 只能查询；授权由守护进程弹窗问用户决定
      check: (pl, permission: string, scope?: string) => perms(pl).check(permission, scope),
    },
  }

  // 必须带 Origin（浏览器总会带上）；没有 Origin 的请求一律拒绝
  const allowedOrigin = (o: string | undefined) => !!o && (opts.origins.includes('*') || opts.origins.includes(o))

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin
    const cors: Record<string, string> = allowedOrigin(origin) ? { 'access-control-allow-origin': origin ?? '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' } : {}
    const send = (code: number, body: Json, extra: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...cors, ...extra })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'OPTIONS') return send(allowedOrigin(origin) ? 204 : 403, {})
    if (!allowedOrigin(origin)) return send(403, { error: { message: 'origin not allowed' } })
    // 令牌放在 Authorization 头里；只有 EventSource（不能设请求头）的事件流接口允许用 URL 参数
    const isEvents = /^\/v1\/proc\/[\w-]+\/events$/.test(new URL(req.url ?? '/', 'http://x').pathname)
    const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || (isEvents ? new URL(req.url ?? '/', 'http://x').searchParams.get('token') : '') || ''
    const a = Buffer.from(auth)
    const b = Buffer.from(token)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(401, { error: { message: 'unauthorized' } })
    const url = new URL(req.url ?? '/', 'http://x')
    const body = async () => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    }
    try {
      if (url.pathname === '/v1/call' && req.method === 'POST') {
        const { plugin, cap, method, args } = await body()
        const fn = caps[cap]?.[method]
        if (!fn || typeof plugin !== 'string') return send(404, { error: { message: `unknown ${cap}.${method}` } })
        return send(200, { value: await fn(plugin, ...(args ?? [])) })
      }
      if (url.pathname === '/v1/spawn' && req.method === 'POST') {
        const { plugin, command, args, cwd } = await body()
        await need(plugin, 'process.spawn', String(command))
        const child = spawn(String(command), (args ?? []).map(String), { cwd: cwd ? resolvePath(cwd) : undefined })
        const id = crypto.randomUUID()
        const entry = { child, plugin, listeners: new Set<(e: string, d: Json) => void>(), buffer: [] as Array<[string, Json]> }
        const emit = (e: string, d: Json) => {
          if (entry.listeners.size) entry.listeners.forEach((l) => l(e, d))
          else entry.buffer.push([e, d])
        }
        child.stdout?.on('data', (d: Buffer) => emit('stdout', b64(d)))
        child.stderr?.on('data', (d: Buffer) => emit('stderr', b64(d)))
        child.on('exit', (code, signal) => {
          emit('exit', { code, signal })
          setTimeout(() => procs.delete(id), 30000)
        })
        child.on('error', (e) => emit('exit', { code: -1, signal: null, error: e.message }))
        procs.set(id, entry)
        return send(200, { value: { id, pid: child.pid } })
      }
      const m = /^\/v1\/proc\/([\w-]+)\/(events|stdin|kill)$/.exec(url.pathname)
      if (m) {
        const p = procs.get(m[1])
        if (!p) return send(404, { error: { message: 'no such process' } })
        if (m[2] === 'events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...cors })
          const write = (e: string, d: Json) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
          for (const [e, d] of p.buffer.splice(0)) write(e, d)
          p.listeners.add(write)
          req.on('close', () => p.listeners.delete(write))
          return
        }
        const data = await body()
        if (m[2] === 'stdin') {
          if (data.end) p.child.stdin?.end()
          else p.child.stdin?.write(Buffer.from(data.data ?? '', 'base64'))
        } else p.child.kill(data.signal ?? 'SIGTERM')
        return send(200, { value: true })
      }
      send(404, { error: { message: 'not found' } })
    } catch (e: any) {
      send(200, { error: { message: String(e?.message ?? e), code: e?.code, permission: e?.permission, scope: e?.scope } })
    }
  })
  return { server, token, roots }
}
