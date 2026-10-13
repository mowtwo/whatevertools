// 插件代码 require 模块时的拦截：
// - 只拦插件目录里的代码（宿主自己的代码不受影响）
// - fs：按路径检查 fs.read / fs.write / fs.plugin；child_process 等需要 process.spawn；http 等需要 network
// - electron：默认给兼容白名单（ipcRenderer、clipboard、nativeImage、shell、webUtils、webFrame、contextBridge），有 electron.raw 才给完整对象
// - 所有模块都经过访问器 hook（node:<模块>.<路径>、electron:<路径>）
//
// 注意：这是同进程内的纵深防御，不是安全边界。恶意代码仍可能绕过（如 process.binding）。
// 需要强隔离时用 strict 模式（插件代码跑在沙箱渲染进程，只能用 API 和垫片模块）。
import path from 'node:path'
import type { HookRegistry } from '@whatevertools/core'
import type { BridgeContext } from '../shared/protocol'
import { sync, type PermCache } from './caps'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('node:module')
const realFs = require('node:fs')
const electron = require('electron')

const READ = new Set([
  'access', 'accessSync', 'exists', 'existsSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'readFile', 'readFileSync',
  'readdir', 'readdirSync', 'readlink', 'readlinkSync', 'realpath', 'realpathSync', 'createReadStream', 'opendir',
  'opendirSync', 'watch', 'watchFile', 'unwatchFile', 'statfs', 'statfsSync', 'glob', 'globSync', 'openAsBlob',
])
const WRITE = new Set([
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rm', 'rmSync',
  'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'lchown', 'lchownSync', 'utimes',
  'utimesSync', 'lutimes', 'lutimesSync', 'truncate', 'truncateSync', 'createWriteStream',
])
/** [源路径模式, 目标路径模式] */
const DUAL: Record<string, ['read' | 'write', 'write']> = {
  rename: ['write', 'write'], renameSync: ['write', 'write'],
  copyFile: ['read', 'write'], copyFileSync: ['read', 'write'], cp: ['read', 'write'], cpSync: ['read', 'write'],
  link: ['read', 'write'], linkSync: ['read', 'write'], symlink: ['read', 'write'], symlinkSync: ['read', 'write'],
}
const OPEN = new Set(['open', 'openSync'])

const SPAWN = new Set(['child_process', 'worker_threads', 'cluster'])
const NET = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'dns/promises'])
const ESCAPE = new Set(['module', 'vm', 'v8', 'inspector', 'inspector/promises', 'repl', 'wasi'])
const FS = new Set(['fs', 'fs/promises', 'original-fs'])

const { fileURLToPath } = require('node:url')

function insideRaw(dir: string, p: string) {
  const rel = path.relative(dir, p)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 解析符号链接后的真实路径（不存在的文件解析父目录） */
function real(p: string): string {
  try {
    return realFs.realpathSync.native(p)
  } catch {
    try {
      return path.join(realFs.realpathSync.native(path.dirname(p)), path.basename(p))
    } catch {
      return p
    }
  }
}

/** 路径在目录内：原始路径和真实路径都要在里面（防止通过符号链接跳出去） */
function inside(dir: string, p: string) {
  return insideRaw(dir, p) && insideRaw(real(dir), real(p))
}

/** fs 接受的各种路径形式 → 字符串；文件描述符返回 null（不检查） */
function toPath(p: unknown): string | null {
  if (typeof p === 'number') return null
  if (typeof p === 'string') return p.startsWith('file:') ? fileURLToPath(p) : p
  if (p instanceof URL) {
    if (p.protocol !== 'file:') throw Object.assign(new Error(`[whatevertools] 不支持的路径 URL：${p.href}`), { code: 'ERR_INVALID_URL_SCHEME' })
    return fileURLToPath(p)
  }
  if (ArrayBuffer.isView(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength).toString()
  if (p && typeof p === 'object' && typeof (p as { href?: unknown }).href === 'string') return toPath(String((p as { href: string }).href))
  return p === undefined || p === null ? null : String(p)
}

export interface GuardOptions {
  ctx: BridgeContext
  perms: PermCache
  hooks: HookRegistry
}

export function installGuard({ ctx, perms, hooks }: GuardOptions) {
  const { dir, data, temp } = ctx.paths
  const pluginId = ctx.pluginId

  const deny = (permission: string, scope?: string) =>
    Object.assign(new Error(`[whatevertools] 插件「${pluginId}」没有权限 ${permission}${scope ? `：${scope}` : ''}`), { code: 'EWTPERM', permission, scope })

  /** 返回 null 表示允许，否则返回错误 */
  const checkPath = (raw: unknown, mode: 'read' | 'write'): Error | null => {
    const p0 = toPath(raw)
    if (p0 === null) return null // 文件描述符等
    const abs = path.resolve(p0)
    if (mode === 'read' && inside(dir, abs)) return null
    // 真实路径（解析符号链接）参与权限判断，防止通过链接访问范围外的文件
    const realAbs = real(abs)
    if (inside(data, abs) || inside(temp, abs)) return perms.check('fs.plugin') ? null : deny('fs.plugin', abs)
    const perm = mode === 'read' ? 'fs.read' : 'fs.write'
    return perms.check(perm, realAbs) ? null : deny(perm, realAbs)
  }

  const guardFn = (name: string, fn: Function, kind: 'sync' | 'callback' | 'promise') => {
    let modes: Array<'read' | 'write'> | null = null
    if (READ.has(name)) modes = ['read']
    else if (WRITE.has(name)) modes = ['write']
    else if (DUAL[name]) modes = DUAL[name]
    else if (!OPEN.has(name)) return fn
    return function (this: unknown, ...args: unknown[]) {
      let err: Error | null = null
      if (OPEN.has(name)) {
        const flags = typeof args[1] === 'string' ? args[1] : typeof args[1] === 'number' ? (args[1] & 3 ? 'w' : 'r') : 'r'
        err = checkPath(args[0], /[wa+]/.test(flags) ? 'write' : 'read')
      } else {
        for (let i = 0; i < modes!.length && !err; i++) err = checkPath(args[i], modes![i])
      }
      if (err) {
        if (kind === 'sync') throw err
        if (kind === 'promise') return Promise.reject(err)
        const cb = args[args.length - 1]
        if (typeof cb === 'function') return void queueMicrotask(() => (cb as Function)(err))
        throw err
      }
      return fn.apply(this, args)
    }
  }

  /** 保留函数上的附加属性（realpathSync.native、util.promisify.custom 等） */
  const keepProps = (from: Function, to: Function) => {
    for (const k of [...Object.getOwnPropertyNames(from), ...Object.getOwnPropertySymbols(from)]) {
      if (k === 'length' || k === 'name' || k === 'prototype' || k === 'arguments' || k === 'caller') continue
      const d = Object.getOwnPropertyDescriptor(from, k)!
      // 如 realpathSync.native：沿用父函数的检查规则
      if (typeof d.value === 'function' && typeof k === 'string') d.value = guardFn(String((from as any).name ?? ''), d.value, 'sync')
      try {
        Object.defineProperty(to, k, d)
      } catch {}
    }
    return to
  }

  /** ReadStream / WriteStream 等构造函数：第一个参数是路径 */
  const STREAM_CTOR: Record<string, 'read' | 'write'> = { ReadStream: 'read', WriteStream: 'write', FileReadStream: 'read', FileWriteStream: 'write' }
  const guardCtor = (Ctor: any, mode: 'read' | 'write') =>
    new Proxy(Ctor, {
      construct(target, args, newTarget) {
        const err = checkPath(args[0], mode)
        if (err) throw err
        return Reflect.construct(target, args, newTarget)
      },
      apply(target, thisArg, args) {
        const err = checkPath(args[0], mode)
        if (err) throw err
        return Reflect.apply(target, thisArg, args)
      },
    })

  const guardedObject = (src: any, kind: 'node' | 'promises') => {
    const out: any = Object.create(Object.getPrototypeOf(src))
    for (const key of Object.getOwnPropertyNames(src)) {
      const desc = Object.getOwnPropertyDescriptor(src, key)!
      // fs.ReadStream / WriteStream 在 Node 里是延迟定义的取值器
      if (desc.get && STREAM_CTOR[key]) {
        const get = desc.get
        let cached: any
        desc.get = () => (cached ??= guardCtor(get.call(src), STREAM_CTOR[key]))
        desc.set = undefined
        Object.defineProperty(out, key, desc)
        continue
      }
      if ('value' in desc && typeof desc.value === 'function') {
        if (STREAM_CTOR[key]) desc.value = guardCtor(desc.value, STREAM_CTOR[key])
        else if (!/^[A-Z]/.test(key)) {
          const k = kind === 'promises' ? 'promise' : key.endsWith('Sync') ? 'sync' : key.startsWith('create') || key === 'watch' || key === 'watchFile' ? 'sync' : 'callback'
          desc.value = keepProps(desc.value, guardFn(key, desc.value, k))
        }
      }
      Object.defineProperty(out, key, desc)
    }
    return out
  }

  let fsCache: any
  const guardedFs = () => {
    if (!fsCache) {
      const g = guardedObject(realFs, 'node')
      Object.defineProperty(g, 'promises', { value: guardedObject(realFs.promises, 'promises'), enumerable: true })
      fsCache = g
    }
    return fsCache
  }

  let electronCache: any
  const filteredElectron = () => {
    if (perms.peek('electron.raw')) return hooks.wrap(electron, 'electron:', { plugin: pluginId })
    if (electronCache) return electronCache
    // 旧的同步剪贴板形状：交给 main 执行（Electron 44 起渲染进程没有同步剪贴板 API，main 会自动适配新旧 API）
    const clipCall = (method: string, args: unknown[]) => {
      const perm = /^(read|has|availableFormats)/.test(method) ? 'clipboard.read' : 'clipboard.write'
      if (!perms.check(perm)) throw deny(perm)
      return sync('__clipboard', method, args)
    }
    const toPng = (img: any) => (img && typeof img.toPNG === 'function' ? new Uint8Array(img.toPNG()) : img)
    const clipboard: Record<string, unknown> = {
      readText: () => clipCall('readText', []),
      writeText: (t: string) => void clipCall('writeText', [t]),
      readHTML: () => clipCall('readHTML', []),
      writeHTML: (h: string) => void clipCall('writeHTML', [h]),
      readImage: () => {
        const r = clipCall('readImage', []) as { png: Uint8Array } | null
        return r && r.png.length ? electron.nativeImage.createFromBuffer(Buffer.from(r.png)) : electron.nativeImage.createEmpty()
      },
      writeImage: (img: unknown) => void clipCall('writeImage', [toPng(img)]),
      readBuffer: (f: string) => Buffer.from(clipCall('readBuffer', [f]) as Uint8Array),
      writeBuffer: (f: string, b: Uint8Array) => void clipCall('writeBuffer', [f, new Uint8Array(b)]),
      read: (f: string) => clipCall('read', [f]),
      availableFormats: () => clipCall('availableFormats', []),
      has: (f: string) => clipCall('has', [f]),
      clear: () => void clipCall('clear', []),
      write: (d: { text?: string; html?: string; image?: unknown }) => void clipCall('write', [{ ...d, image: toPng(d?.image) }]),
    }
    const sh = electron.shell
    const shell = {
      openExternal: (url: string, o?: unknown) => (perms.check('shell.external', url) ? sh.openExternal(url, o) : Promise.reject(deny('shell.external', url))),
      openPath: (p: string) => (perms.check('shell.open', p) ? sh.openPath(p) : Promise.resolve(deny('shell.open', p).message)),
      showItemInFolder: (p: string) => {
        if (!perms.check('shell.open', p)) throw deny('shell.open', p)
        return sh.showItemInFolder(p)
      },
      trashItem: (p: string) => (perms.check('shell.trash', p) ? sh.trashItem(p) : Promise.reject(deny('shell.trash', p))),
      beep: () => sh.beep(),
    }
    electronCache = hooks.wrap(
      {
        ipcRenderer: electron.ipcRenderer,
        clipboard,
        nativeImage: electron.nativeImage,
        shell,
        webUtils: electron.webUtils,
        webFrame: electron.webFrame,
        contextBridge: electron.contextBridge,
      },
      'electron:',
      { plugin: pluginId },
    )
    return electronCache
  }

  // 插件目录本身可能是符号链接（如 /tmp → /private/tmp）：原始路径和真实路径都算插件代码
  const dirReal = real(dir)
  const fromPlugin = (mod: any) => typeof mod?.filename === 'string' && (insideRaw(dir, mod.filename) || insideRaw(dirReal, mod.filename) || insideRaw(dirReal, real(mod.filename)))

  /** 插件代码加载模块：返回替换后的模块，undefined 表示照常加载 */
  const intercept = (id: unknown): unknown => {
    const name = typeof id === 'string' ? id.replace(/^node:/, '') : id
    if (typeof name !== 'string') return undefined
    if (name === 'electron') return filteredElectron()
    if (FS.has(name)) {
      const g = guardedFs()
      return hooks.wrap(name === 'fs/promises' ? g.promises : g, `node:${name === 'original-fs' ? 'fs' : name}`, { plugin: pluginId })
    }
    if (SPAWN.has(name) && !perms.check('process.spawn')) throw deny('process.spawn', name)
    if (NET.has(name) && !perms.check('network', name)) throw deny('network', name)
    if (ESCAPE.has(name) && !perms.check('process.native', name)) throw deny('process.native', name)
    return undefined
  }

  const origRequire = Module.prototype.require
  Module.prototype.require = function (this: any, id: string) {
    if (!fromPlugin(this)) return origRequire.apply(this, arguments as any)
    const replaced = intercept(id)
    if (replaced !== undefined) return replaced
    const mod = origRequire.apply(this, arguments as any)
    const name = String(id).replace(/^node:/, '')
    if (Module.isBuiltin?.(name)) return hooks.wrap(mod, `node:${name}`, { plugin: pluginId })
    return mod
  }
  // Module._load 也要拦（插件可以绕过 require 直接调用它）
  const origLoad = Module._load
  Module._load = function (request: string, parent: any, isMain: boolean) {
    if (parent && fromPlugin(parent)) {
      const replaced = intercept(request)
      if (replaced !== undefined) return replaced
    }
    return origLoad.call(this, request, parent, isMain)
  }

  // 插件自带的原生扩展
  const origNode = Module._extensions['.node']
  Module._extensions['.node'] = function (mod: any, filename: string) {
    if ((insideRaw(dir, filename) || insideRaw(dirReal, real(filename))) && !perms.check('process.native', filename)) throw deny('process.native', filename)
    return origNode.call(this, mod, filename)
  }
}
