// 用平台能力拼出 Node 内置模块，给没有 Node 的平台（web、以后的 tauri）用。
// 打包时用 @whatevertools/pack 的 esbuild 插件把 require('fs') 等指向 globalThis.__whatevertoolsRequire('fs')。
import { Buffer } from 'buffer'
import type { Capabilities, FsCapability, FsStat } from '@whatevertools/core'
import { createPath } from './path'
import { EventEmitter } from './events'

export { EventEmitter } from './events'

export interface NodeShimOptions {
  /** 平台名（process.platform），默认按 UA 推断 */
  platform?: string
  cwd?: string
  home?: string
  tmp?: string
  env?: Record<string, string>
  /** 不能用的能力：throw（默认）或 warn */
  unsupported?: (name: string) => never
}

type BufferEncoding = any
const enc = new TextEncoder()
const dec = new TextDecoder()

function unsupportedDefault(name: string): never {
  throw Object.assign(new Error(`[whatevertools] 当前平台不支持 ${name}`), { code: 'EWTUNSUPPORTED' })
}

function stats(s: FsStat) {
  const d = (ms: number) => new Date(ms)
  return {
    ...s,
    dev: 0, ino: 0, nlink: 1, uid: 0, gid: 0, rdev: 0, blksize: 4096, blocks: Math.ceil(s.size / 512),
    atime: d(s.atimeMs), mtime: d(s.mtimeMs), ctime: d(s.ctimeMs), birthtime: d(s.birthtimeMs),
    isFile: () => s.isFile, isDirectory: () => s.isDirectory, isSymbolicLink: () => s.isSymbolicLink,
    isBlockDevice: () => false, isCharacterDevice: () => false, isFIFO: () => false, isSocket: () => false,
  }
}

function toBytes(data: unknown, encoding?: string): Uint8Array {
  if (typeof data === 'string') return encoding && encoding !== 'utf8' && encoding !== 'utf-8' ? new Uint8Array(Buffer.from(data, encoding as BufferEncoding)) : enc.encode(data)
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return enc.encode(String(data))
}

function encOf(opts: unknown): string | undefined {
  return typeof opts === 'string' ? opts : (opts as { encoding?: string } | undefined)?.encoding ?? undefined
}

function decode(bytes: Uint8Array, encoding?: string): string | Buffer {
  if (!encoding || encoding === 'buffer') return Buffer.from(bytes)
  if (encoding === 'utf8' || encoding === 'utf-8') return dec.decode(bytes)
  return Buffer.from(bytes).toString(encoding as BufferEncoding)
}

function enoent(syscall: string, p: string) {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`), { code: 'ENOENT', syscall, path: p, errno: -2 })
}

export function createFs(f: FsCapability, unsupported: (n: string) => never) {
  // 取出来的方法要绑定到能力对象上（VirtualFs 等是类实例，方法里用到 this）
  const need = <K extends keyof FsCapability>(k: K): NonNullable<FsCapability[K]> => {
    const fn = f[k] as unknown as ((...a: unknown[]) => unknown) | undefined
    if (typeof fn !== 'function') return unsupported(`fs.${String(k)}`)
    return fn.bind(f) as NonNullable<FsCapability[K]>
  }
  const sync = {
    existsSync: (p: string) => !!f.statSync?.(String(p)),
    accessSync: (p: string) => {
      if (!need('statSync')(String(p))) throw enoent('access', String(p))
    },
    readFileSync: (p: string, o?: unknown) => decode(need('readFileSync')(String(p)), encOf(o)),
    writeFileSync: (p: string, data: unknown, o?: unknown) => need('writeFileSync')(String(p), toBytes(data, encOf(o)), { append: (o as any)?.flag === 'a' }),
    appendFileSync: (p: string, data: unknown, o?: unknown) => need('writeFileSync')(String(p), toBytes(data, encOf(o)), { append: true }),
    statSync: (p: string, o?: { throwIfNoEntry?: boolean }) => {
      const s = need('statSync')(String(p))
      if (!s) {
        if (o?.throwIfNoEntry === false) return undefined
        throw enoent('stat', String(p))
      }
      return stats(s)
    },
    readdirSync: (p: string, o?: { withFileTypes?: boolean }) => {
      const list = need('readdirSync')(String(p))
      if (!o?.withFileTypes) return list.map((d) => d.name)
      return list.map((d) => ({ name: d.name, isFile: () => d.isFile, isDirectory: () => d.isDirectory, isSymbolicLink: () => d.isSymbolicLink }))
    },
    mkdirSync: (p: string, o?: { recursive?: boolean } | number) => need('mkdirSync')(String(p), typeof o === 'object' ? o : {}),
    mkdtempSync: (prefix: string) => {
      const p = `${prefix}${Math.random().toString(36).slice(2, 8)}`
      need('mkdirSync')(p, { recursive: true })
      return p
    },
    rmSync: (p: string, o?: { recursive?: boolean; force?: boolean }) => need('rmSync')(String(p), o),
    rmdirSync: (p: string, o?: { recursive?: boolean }) => need('rmSync')(String(p), { recursive: o?.recursive }),
    unlinkSync: (p: string) => need('rmSync')(String(p), {}),
    renameSync: (a: string, b: string) => need('renameSync')(String(a), String(b)),
    copyFileSync: (a: string, b: string) => need('copyFileSync')(String(a), String(b)),
    realpathSync: (p: string) => (f.realpathSync ? f.realpathSync(String(p)) : String(p)),
    readlinkSync: () => unsupported('fs.readlinkSync'),
    symlinkSync: () => unsupported('fs.symlinkSync'),
    chmodSync: () => {},
    utimesSync: () => {},
  } as Record<string, (...a: any[]) => any>
  sync.lstatSync = sync.statSync
  ;(sync.realpathSync as any).native = sync.realpathSync

  const promises = {
    readFile: async (p: string, o?: unknown) => decode(await f.readFile(String(p)), encOf(o)),
    writeFile: (p: string, data: unknown, o?: unknown) => f.writeFile(String(p), toBytes(data, encOf(o))),
    appendFile: (p: string, data: unknown, o?: unknown) => f.writeFile(String(p), toBytes(data, encOf(o)), { append: true }),
    stat: async (p: string) => {
      const s = await f.stat(String(p))
      if (!s) throw enoent('stat', String(p))
      return stats(s)
    },
    readdir: async (p: string, o?: { withFileTypes?: boolean }) => {
      const list = await f.readdir(String(p))
      return o?.withFileTypes ? list.map((d) => ({ name: d.name, isFile: () => d.isFile, isDirectory: () => d.isDirectory, isSymbolicLink: () => d.isSymbolicLink })) : list.map((d) => d.name)
    },
    mkdir: (p: string, o?: { recursive?: boolean }) => f.mkdir(String(p), o),
    rm: (p: string, o?: { recursive?: boolean; force?: boolean }) => f.rm(String(p), o),
    rmdir: (p: string, o?: { recursive?: boolean }) => f.rm(String(p), { recursive: o?.recursive }),
    unlink: (p: string) => f.rm(String(p), {}),
    rename: (a: string, b: string) => f.rename(String(a), String(b)),
    copyFile: (a: string, b: string) => f.copyFile(String(a), String(b)),
    access: async (p: string) => {
      if (!(await f.stat(String(p)))) throw enoent('access', String(p))
    },
    realpath: async (p: string) => (f.realpathSync ? f.realpathSync(String(p)) : String(p)),
    mkdtemp: async (prefix: string) => sync.mkdtempSync(prefix),
    lstat: async (p: string) => promises.stat(p),
  } as Record<string, (...a: any[]) => Promise<any>>
  promises.lstat = promises.stat

  // 回调版本：由 promises 生成
  const callbacks: Record<string, (...a: any[]) => void> = {}
  for (const [k, fn] of Object.entries(promises)) {
    callbacks[k] = (...args: any[]) => {
      const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null
      fn(...args).then((v) => cb?.(null, v), (e) => cb?.(e))
    }
  }
  callbacks.exists = (p: string, cb: (b: boolean) => void) => void f.stat(String(p)).then((s) => cb(!!s), () => cb(false))
  // util.promisify(fs.exists) 要得到 Promise<boolean>（exists 的回调没有 error 参数）
  ;(callbacks.exists as any)[Symbol.for('nodejs.util.promisify.custom')] = (p: string) => f.stat(String(p)).then((s) => !!s, () => false)

  const fsModule: any = {
    ...callbacks,
    ...sync,
    promises,
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, COPYFILE_EXCL: 1 },
    watch: (p: string, o: any, l?: any) => {
      const fn = typeof o === 'function' ? o : l
      const em = new EventEmitter() as EventEmitter & { close(): void }
      const off = f.watch ? f.watch(String(p), (e, name) => (fn?.(e, name), em.emit('change', e, name)), typeof o === 'object' ? o : {}) : unsupported('fs.watch')
      em.close = () => off()
      return em
    },
    createReadStream: () => unsupported('fs.createReadStream'),
    createWriteStream: () => unsupported('fs.createWriteStream'),
  }
  return fsModule
}

export function createNodeModules(caps: Capabilities, opts: NodeShimOptions = {}): Record<string, any> {
  const unsupported = opts.unsupported ?? unsupportedDefault
  const platform = opts.platform ?? caps.system.os ?? 'linux'
  const cwd = () => opts.cwd ?? '/'
  const path = createPath(cwd)
  const fs = caps.fs ? createFs(caps.fs, unsupported) : new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? () => unsupported(`fs.${k}`) : undefined) })
  const os = {
    platform: () => platform, type: () => ({ darwin: 'Darwin', win32: 'Windows_NT', linux: 'Linux' } as Record<string, string>)[platform] ?? 'Linux',
    arch: () => 'x64', release: () => '0.0.0', hostname: () => 'localhost', tmpdir: () => opts.tmp ?? '/tmp', homedir: () => opts.home ?? '/home',
    EOL: '\n', cpus: () => [], totalmem: () => 0, freemem: () => 0, uptime: () => performance.now() / 1000, networkInterfaces: () => ({}),
    userInfo: () => ({ username: 'user', homedir: opts.home ?? '/home', shell: null, uid: -1, gid: -1 }), endianness: () => 'LE',
  }
  const url = {
    URL, URLSearchParams,
    pathToFileURL: (p: string) => {
      const u = new URL('file:///')
      u.pathname = path.resolve(p)
      return u
    },
    fileURLToPath: (u: string | URL) => decodeURIComponent(new URL(String(u)).pathname),
    format: (u: URL | string) => String(u),
    parse: (u: string) => new URL(u, 'file:///'),
  }
  const util = {
    promisify: (fn: any) => fn?.[Symbol.for('nodejs.util.promisify.custom')] ?? ((...args: any[]) => new Promise((res, rej) => fn(...args, (e: unknown, v: unknown) => (e ? rej(e) : res(v))))),
    inspect: (v: unknown) => {
      try {
        return typeof v === 'string' ? v : JSON.stringify(v)
      } catch {
        return String(v)
      }
    },
    format: (f: string, ...a: unknown[]) => String(f).replace(/%[sdjo]/g, () => String(a.shift())) + (a.length ? ' ' + a.join(' ') : ''),
    deprecate: <T>(fn: T) => fn,
    inherits: (c: any, p: any) => Object.setPrototypeOf(c.prototype, p.prototype),
    types: { isPromise: (v: unknown) => v instanceof Promise, isUint8Array: (v: unknown) => v instanceof Uint8Array },
    TextEncoder, TextDecoder,
  }
  const crypto = {
    randomUUID: () => globalThis.crypto.randomUUID(),
    randomBytes: (n: number) => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))),
    getRandomValues: (a: Uint8Array) => globalThis.crypto.getRandomValues(a),
    webcrypto: globalThis.crypto,
    createHash: () => unsupported('crypto.createHash（浏览器只有异步的 crypto.subtle.digest）'),
  }
  const childProcess = {
    spawn: (cmd: string, args: string[] = [], o: any = {}) => {
      if (!caps.process) return unsupported('child_process.spawn')
      const p = caps.process.spawn(cmd, args, o)
      const child: any = new EventEmitter()
      child.pid = p.pid
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdin = { write: (d: unknown) => p.write(toBytes(d)), end: () => p.closeStdin() }
      p.onStdout((d) => child.stdout.emit('data', Buffer.from(d)))
      p.onStderr((d) => child.stderr.emit('data', Buffer.from(d)))
      p.onExit((code, signal) => (child.emit('exit', code, signal), child.emit('close', code, signal)))
      child.kill = (s?: string) => p.kill(s)
      return child
    },
    execSync: (cmd: string, o?: any) => (caps.process?.execSync ? Buffer.from(caps.process.execSync(cmd, o)) : unsupported('child_process.execSync')),
    exec: () => unsupported('child_process.exec'),
    execFile: () => unsupported('child_process.execFile'),
    fork: () => unsupported('child_process.fork'),
  }
  const blocked = (name: string) => new Proxy({}, { get: (_t, k) => (k === '__esModule' ? false : typeof k === 'string' ? () => unsupported(`${name}.${k}`) : undefined) })
  const modules: Record<string, any> = {
    fs, 'fs/promises': fs.promises, path, 'path/posix': path, os, url, util, crypto, events: Object.assign(EventEmitter, { EventEmitter, once: (em: EventEmitter, e: string) => new Promise((r) => em.once(e, (...a: any[]) => r(a))) }),
    buffer: { Buffer }, child_process: childProcess, string_decoder: { StringDecoder: class { constructor(private e = 'utf8') {} write(b: Uint8Array) { return Buffer.from(b).toString(this.e as BufferEncoding) } end() { return '' } } },
    assert: Object.assign((v: unknown, m?: string) => { if (!v) throw new Error(m ?? 'Assertion failed') }, { ok: (v: unknown, m?: string) => { if (!v) throw new Error(m ?? 'Assertion failed') } }),
    timers: { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate: (f: () => void) => setTimeout(f, 0) },
    querystring: { parse: (s: string) => Object.fromEntries(new URLSearchParams(s)), stringify: (o: Record<string, string>) => new URLSearchParams(o).toString() },
  }
  for (const n of ['http', 'https', 'net', 'tls', 'dgram', 'dns', 'http2', 'stream', 'zlib', 'worker_threads', 'cluster', 'module', 'vm', 'v8', 'inspector', 'readline', 'tty', 'perf_hooks']) modules[n] = blocked(n)
  return modules
}

/** process 全局对象的最小实现 */
export function createProcess(caps: Capabilities, opts: NodeShimOptions = {}) {
  const em = new EventEmitter()
  return Object.assign(em, {
    platform: opts.platform ?? caps.system.os,
    arch: 'x64',
    env: { ...(opts.env ?? {}) },
    argv: ['browser'],
    versions: { node: '0.0.0-shim' },
    version: 'v0.0.0-shim',
    type: 'renderer',
    cwd: () => opts.cwd ?? '/',
    nextTick: (fn: (...a: any[]) => void, ...a: any[]) => queueMicrotask(() => fn(...a)),
    hrtime: Object.assign((prev?: [number, number]) => {
      const t = performance.now() * 1e6
      const s = Math.floor(t / 1e9)
      const ns = Math.floor(t % 1e9)
      return prev ? [s - prev[0], ns - prev[1]] : [s, ns]
    }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
    exit: () => {},
  })
}

export { Buffer }
