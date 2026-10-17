// 通用能力探测：一个能力 = 按顺序排列的几种实现，调用时用第一个可用的，都不可用时给出统一的错误或升级提示。
// 纯工具，不依赖 Node、DOM 或任何宿主：preload 和 renderer 里都能用，uTools / Electron / 网页版也都一样。
// 典型场景：新版宿主才有的 API，在旧版上退回到替代实现，而不是直接 `xxx is not a function`。

/** 一种实现 */
export interface Candidate<F extends (...args: any[]) => any> {
  /** 名字，出现在 support()、report() 和错误信息里 */
  id: string
  /** 当前环境能不能用；不写表示总是可用。抛错按不可用处理 */
  available?: () => boolean
  run: F
}

export interface CapabilityOptions {
  /** 全部实现都不可用时：throw（默认）抛 UnsupportedError；noop 什么都不做、返回 undefined（适合注册事件回调） */
  missing?: 'throw' | 'noop'
  /** 给用户看的提示，比如「请升级 uTools 到 8.0 以上」 */
  hint?: string
  /** 选中的实现运行时抛错（或返回的 Promise 失败）时，是否换下一种实现重试。默认 false：有副作用的调用重试可能做两遍 */
  fallbackOnError?: boolean
}

export interface Capability<F extends (...args: any[]) => any> {
  (...args: Parameters<F>): ReturnType<F>
  readonly name: string
  /** 会用哪种实现；没有可用的返回 false */
  support(): string | false
  /** 不抛 UnsupportedError：没有可用实现时返回 undefined（实现本身抛的错照常抛出） */
  try(...args: Parameters<F>): ReturnType<F> | undefined
  /** 清掉探测缓存，下次调用重新探测（宿主在运行中升级、热重载时用） */
  reset(): void
}

export interface CapabilityReport {
  name: string
  using: string | false
  tried: Array<{ id: string; available: boolean; error?: string }>
}

export interface UnsupportedInfo {
  name: string
  hint?: string
  tried: string[]
}

const CODE = 'WT_UNSUPPORTED'

export class UnsupportedError extends Error {
  readonly code = CODE
  readonly capability: string
  readonly hint?: string
  readonly tried: string[]
  constructor(info: UnsupportedInfo) {
    super(`当前环境不支持 ${info.name}${info.tried.length ? `（试过：${info.tried.join('、')}）` : ''}${info.hint ? `。${info.hint}` : ''}`)
    this.name = 'UnsupportedError'
    this.capability = info.name
    this.hint = info.hint
    this.tried = info.tried
  }

  /** 跨副本判断（preload 和 renderer 各打包一份时 instanceof 不可靠） */
  static is(e: unknown): e is UnsupportedError {
    return !!e && typeof e === 'object' && (e as { code?: unknown }).code === CODE
  }
}

// 注册表放在 globalThis 上：同一个 JS 环境里有多份本包（preload 一份、页面打包一份）时，监听和报告是同一套
interface Registry {
  caps: Map<string, () => CapabilityReport>
  listeners: Set<(info: UnsupportedInfo) => void>
  notified: Set<string>
}
const KEY = Symbol.for('whatevertools.shared.capabilities')
const registry: Registry = ((globalThis as any)[KEY] ??= { caps: new Map(), listeners: new Set(), notified: new Set() })

/** 某个能力第一次发现没有可用实现时通知（每个能力只通知一次）。返回取消监听的函数 */
export function onUnsupported(listener: (info: UnsupportedInfo) => void): () => void {
  registry.listeners.add(listener)
  return () => registry.listeners.delete(listener)
}

/** 所有已声明能力的探测结果，适合写进日志 */
export function report(): CapabilityReport[] {
  return [...registry.caps.values()].map((r) => r())
}

function notify(info: UnsupportedInfo) {
  if (registry.notified.has(info.name)) return
  registry.notified.add(info.name)
  for (const l of registry.listeners) {
    try {
      l(info)
    } catch {}
  }
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as any).then === 'function'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function capability<F extends (...args: any[]) => any>(name: string, candidates: Array<Candidate<F>>, options: CapabilityOptions = {}): Capability<F> {
  // 探测结果：true 可用、false 不可用；运行时失败过的实现记下错误，之后不再选它
  let probed: Map<string, boolean> | undefined
  const failed = new Map<string, string>()

  const probe = (c: Candidate<F>) => {
    probed ??= new Map()
    let ok = probed.get(c.id)
    if (ok === undefined) {
      try {
        ok = c.available ? !!c.available() : true
      } catch {
        ok = false
      }
      probed.set(c.id, ok)
    }
    return ok && !failed.has(c.id)
  }

  const pick = (from = 0) => {
    for (let i = from; i < candidates.length; i++) if (probe(candidates[i])) return i
    return -1
  }

  const missing = (strict: boolean): undefined => {
    const info = { name, hint: options.hint, tried: candidates.map((c) => c.id) }
    notify(info)
    if (strict && (options.missing ?? 'throw') === 'throw') throw new UnsupportedError(info)
    return undefined
  }

  const invoke = (self: unknown, args: Parameters<F>, strict: boolean, from = 0): ReturnType<F> => {
    const i = pick(from)
    if (i < 0) return missing(strict) as ReturnType<F>
    const c = candidates[i]
    const next = (e: unknown) => {
      failed.set(c.id, message(e))
      return invoke(self, args, strict, i + 1)
    }
    if (!options.fallbackOnError) return c.run.apply(self, args)
    let out: ReturnType<F>
    try {
      out = c.run.apply(self, args)
    } catch (e) {
      if (pick(i + 1) < 0) throw e
      return next(e)
    }
    if (!isThenable(out)) return out
    return Promise.resolve(out).catch((e) => {
      if (pick(i + 1) < 0) throw e
      return next(e)
    }) as ReturnType<F>
  }

  const cap = function (this: unknown, ...args: Parameters<F>) {
    return invoke(this, args, true)
  } as Capability<F>
  Object.defineProperty(cap, 'name', { value: name })
  cap.support = () => {
    const i = pick()
    return i < 0 ? false : candidates[i].id
  }
  cap.try = function (this: unknown, ...args: Parameters<F>) {
    return invoke(this, args, false)
  }
  cap.reset = () => {
    probed = undefined
    failed.clear()
    registry.notified.delete(name)
  }
  registry.caps.set(name, () => ({
    name,
    using: cap.support(),
    tried: candidates.map((c) => ({ id: c.id, available: probe(c), ...(failed.has(c.id) ? { error: failed.get(c.id) } : {}) })),
  }))
  return cap
}

/**
 * 用对象上的方法当一种实现：路径上的值是函数才算可用，调用时保留 this。
 * target 可以是函数，调用时才取（renderer 里全局对象可能晚于本模块出现）。
 *   method(() => globalThis.utools, 'getPluginLocalDataPath')
 *   method(utools, 'db.promises.get')
 */
export function method<F extends (...args: any[]) => any = (...args: any[]) => any>(target: object | (() => any), path: string, id = path): Candidate<F> {
  const keys = path.split('.')
  const resolve = () => {
    let owner: any = typeof target === 'function' ? (target as () => any)() : target
    for (let k = 0; k < keys.length - 1; k++) owner = owner?.[keys[k]]
    const fn = owner?.[keys[keys.length - 1]]
    return typeof fn === 'function' ? { owner, fn } : undefined
  }
  return {
    id,
    available: () => !!resolve(),
    run: ((...args: any[]) => {
      const r = resolve()
      if (!r) throw new TypeError(`${path} is not a function`)
      return r.fn.apply(r.owner, args)
    }) as F,
  }
}
