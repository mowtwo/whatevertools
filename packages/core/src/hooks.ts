// 访问器级别的 hook：对注入给插件的对象（API、Node 模块、Electron 模块）做 get / set / apply / construct 拦截，
// 宿主侧的各个扩展点也用同一个注册表（apply 形式）。
//
// 目标命名：<命名空间>:<点分路径>
//   插件进程（访问器级）
//     api:<原生 API 路径>          如 api:db.put、api:identity（属性读取也能拦）
//     <兼容层注入名>:<旧 API 路径>   如 utools:ubrowser、utools:db.put
//     node:<模块>.<路径>            如 node:fs.readFileSync（插件 preload 里 require 到的模块）
//     electron:<路径>               如 electron:clipboard.readImage
//     event:<API 事件名>            宿主推给插件的事件回调，如 event:lifecycle.onEnter
//   宿主侧（apply）
//     service:<方法>                main 侧 API 实现
//     provider:<名字>.<方法>        用户信息、AI、付费等提供者，如 provider:ai.models
//     panel:<操作>                  面板操作，如 panel:detach、panel:input.set
//     window:create / window:<方法>  插件自定义窗口
//     entry:register / entry:match.<类型> / entry:emit   关键字入口
//     source:register / source:emit / source:enter      唤起来源
//     permission:check / permission:prompt / permission:change
//     lifecycle:start / enter / exit / idle / crash
//     schedule:fire
//     event:<事件名>                宿主推给插件的事件（enter / leave / detach / db.pull …），返回 null 不推送
//
// 模式：* 匹配一段（不跨 . 和 :），** 匹配任意内容；例如 api:db.*、node:fs.**、**

export interface HookContext {
  /** 完整目标，如 node:fs.readFileSync */
  target: string
  /** 插件 id（宿主侧 hook 才有，插件侧由运行时填写） */
  plugin?: string
  /** 任意附加信息，hook 之间可以传递 */
  meta: Record<string, unknown>
}

export interface GetContext extends HookContext {
  value: unknown
}
export interface SetContext extends HookContext {
  value: unknown
}
export interface ApplyContext extends HookContext {
  args: unknown[]
  thisArg: unknown
}

export interface AccessorHook {
  /** 越小越先执行；权限检查等内置 hook 用负数 */
  priority?: number
  get?(ctx: GetContext, next: () => unknown): unknown
  set?(ctx: SetContext, next: (value: unknown) => boolean): boolean
  /** 函数调用；next 可传入新参数 */
  apply?(ctx: ApplyContext, next: (args?: unknown[]) => unknown): unknown
  /** new 调用（如 new fs.ReadStream） */
  construct?(ctx: ApplyContext, next: (args?: unknown[]) => object): object
}

interface Entry {
  pattern: string
  re: RegExp
  hook: AccessorHook
  order: number
}

function compile(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
      } else re += '[^.:]*'
    } else re += c.replace(/[\\^$+?.()|[\]{}]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export class HookRegistry {
  private entries: Entry[] = []
  private seq = 0
  private cache = new Map<string, Entry[]>()

  on(pattern: string, hook: AccessorHook): () => void {
    const entry = { pattern, re: compile(pattern), hook, order: this.seq++ }
    this.entries.push(entry)
    this.entries.sort((a, b) => (a.hook.priority ?? 0) - (b.hook.priority ?? 0) || a.order - b.order)
    this.cache.clear()
    return () => {
      this.entries = this.entries.filter((e) => e !== entry)
      this.cache.clear()
    }
  }

  /** 批量注册：{ 'api:db.put': { apply() {} } } */
  use(map: Record<string, AccessorHook>): () => void {
    const offs = Object.entries(map).map(([p, h]) => this.on(p, h))
    return () => offs.forEach((off) => off())
  }

  match(target: string): Entry[] {
    let hit = this.cache.get(target)
    if (!hit) {
      hit = this.entries.filter((e) => e.re.test(target))
      this.cache.set(target, hit)
    }
    return hit
  }

  /** 某个前缀下是否可能有 hook（决定要不要继续包装子对象） */
  hasUnder(prefix: string): boolean {
    return this.entries.some((e) => e.pattern === '**' || e.re.test(prefix) || e.pattern.startsWith(prefix) || /[*]/.test(e.pattern.slice(0, prefix.length)))
  }

  runGet(target: string, base: Omit<HookContext, 'target' | 'meta'>, read: () => unknown): unknown {
    const hooks = this.match(target).filter((e) => e.hook.get)
    if (!hooks.length) return read()
    const meta = {}
    const call = (i: number): unknown => {
      if (i >= hooks.length) return read()
      const ctx: GetContext = { ...base, target, meta, get value() { return read() } }
      return hooks[i].hook.get!(ctx, () => call(i + 1))
    }
    return call(0)
  }

  runSet(target: string, base: Omit<HookContext, 'target' | 'meta'>, value: unknown, write: (v: unknown) => boolean): boolean {
    const hooks = this.match(target).filter((e) => e.hook.set)
    if (!hooks.length) return write(value)
    const meta = {}
    const call = (i: number, v: unknown): boolean => {
      if (i >= hooks.length) return write(v)
      return hooks[i].hook.set!({ ...base, target, meta, value: v }, (nv) => call(i + 1, nv))
    }
    return call(0, value)
  }

  runApply(target: string, base: Omit<HookContext, 'target' | 'meta'>, thisArg: unknown, args: unknown[], invoke: (args: unknown[]) => unknown, kind: 'apply' | 'construct' = 'apply'): any {
    const hooks = this.match(target).filter((e) => e.hook[kind])
    if (!hooks.length) return invoke(args)
    const meta = {}
    const call = (i: number, a: unknown[]): unknown => {
      if (i >= hooks.length) return invoke(a)
      const ctx: ApplyContext = { ...base, target, meta, args: a, thisArg }
      return (hooks[i].hook[kind] as any)(ctx, (na?: unknown[]) => call(i + 1, na ?? a))
    }
    return call(0, args)
  }

  /** 把 obj 包成 Proxy，访问 obj.a.b 时目标为 `${prefix}.a.b` */
  wrap<T extends object>(obj: T, prefix: string, base: Omit<HookContext, 'target' | 'meta'> = {}, opts: WrapOptions = {}): T {
    return wrapValue(this, obj, prefix, base, opts, new WeakMap(), 0) as T
  }
}

export interface WrapOptions {
  /** 最多包几层（默认 4），防止把整个对象图都包起来 */
  depth?: number
  /** 这些子路径不再往下包（如 Buffer、大型类实例） */
  skip?: (path: string, value: unknown) => boolean
}

function joinPath(prefix: string, key: string) {
  return prefix.endsWith(':') ? prefix + key : `${prefix}.${key}`
}

/** 代理 → 原始对象（调用原生方法时要把 this 还原） */
const rawOf = new WeakMap<object, object>()

/** 只包装函数和「命名空间」对象（自身带函数属性的对象）；纯数据原样返回，保证可以结构化克隆 */
function isNamespace(v: object, level = 0): boolean {
  try {
    for (const k of Object.getOwnPropertyNames(v)) {
      const d = Object.getOwnPropertyDescriptor(v, k)
      if (!d) continue
      if (d.get || typeof d.value === 'function') return true
      // 嵌套的命名空间（如 db.async、nested.deep.fn）
      if (level < 2 && d.value && typeof d.value === 'object' && !Array.isArray(d.value) && !ArrayBuffer.isView(d.value) && isNamespace(d.value, level + 1)) return true
    }
    const proto = Object.getPrototypeOf(v)
    // 类实例（如 Electron 的 webFrame、Node 的模块对象）方法在原型上
    return !!proto && proto !== Object.prototype && proto !== Array.prototype && Object.getOwnPropertyNames(proto).some((k) => k !== 'constructor' && typeof Object.getOwnPropertyDescriptor(proto, k)?.value === 'function')
  } catch {
    return false
  }
}

function wrapValue(reg: HookRegistry, value: unknown, path: string, base: Omit<HookContext, 'target' | 'meta'>, opts: WrapOptions, cache: WeakMap<object, unknown>, depth: number): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  if (depth > (opts.depth ?? 4)) return value
  if (opts.skip?.(path, value)) return value
  // 根对象总是包装（显式要求的）；子对象只包装命名空间
  if (depth > 0 && typeof value === 'object' && (Array.isArray(value) || ArrayBuffer.isView(value) || !isNamespace(value))) return value
  const cached = cache.get(value as object)
  if (cached) return cached
  const isFn = typeof value === 'function'
  const handler: ProxyHandler<any> = {
    get(target, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver)
      const desc = Reflect.getOwnPropertyDescriptor(target, key)
      // Proxy 约束：不可配置且不可写的属性必须原样返回
      if (desc && !desc.configurable && 'value' in desc && !desc.writable) return desc.value
      // 函数自身的 prototype 等不需要拦
      if (isFn && (key === 'prototype' || key === 'length' || key === 'name')) return Reflect.get(target, key, receiver)
      const childPath = joinPath(path, key)
      const v = reg.runGet(childPath, base, () => Reflect.get(target, key, receiver))
      return wrapValue(reg, v, childPath, base, opts, cache, depth + 1)
    },
    set(target, key, v, receiver) {
      if (typeof key === 'symbol') return Reflect.set(target, key, v, receiver)
      return reg.runSet(joinPath(path, key), base, v, (nv) => Reflect.set(target, key, nv, receiver))
    },
  }
  if (isFn) {
    handler.apply = (target, thisArg, args) => {
      const self = (thisArg && rawOf.get(thisArg as object)) || thisArg
      return reg.runApply(path, base, self, args, (a) => Reflect.apply(target, self, a))
    }
    handler.construct = (target, args, newTarget) =>
      reg.runApply(path, base, undefined, args, (a) => Reflect.construct(target, a, newTarget === proxy ? target : newTarget), 'construct')
  }
  const proxy = new Proxy(value as object, handler)
  cache.set(value as object, proxy)
  rawOf.set(proxy, value as object)
  return proxy
}
