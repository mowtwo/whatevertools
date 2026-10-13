// 最小 EventEmitter
export class EventEmitter {
  private _ev = new Map<string | symbol, Array<{ fn: (...a: any[]) => void; once: boolean }>>()
  static defaultMaxListeners = 10
  on(e: string | symbol, fn: (...a: any[]) => void) {
    const l = this._ev.get(e) ?? []
    l.push({ fn, once: false })
    this._ev.set(e, l)
    return this
  }
  addListener(e: string | symbol, fn: (...a: any[]) => void) {
    return this.on(e, fn)
  }
  prependListener(e: string | symbol, fn: (...a: any[]) => void) {
    const l = this._ev.get(e) ?? []
    l.unshift({ fn, once: false })
    this._ev.set(e, l)
    return this
  }
  once(e: string | symbol, fn: (...a: any[]) => void) {
    const l = this._ev.get(e) ?? []
    l.push({ fn, once: true })
    this._ev.set(e, l)
    return this
  }
  off(e: string | symbol, fn: (...a: any[]) => void) {
    const l = this._ev.get(e)
    if (l) this._ev.set(e, l.filter((x) => x.fn !== fn))
    return this
  }
  removeListener(e: string | symbol, fn: (...a: any[]) => void) {
    return this.off(e, fn)
  }
  removeAllListeners(e?: string | symbol) {
    if (e === undefined) this._ev.clear()
    else this._ev.delete(e)
    return this
  }
  emit(e: string | symbol, ...args: any[]) {
    const l = this._ev.get(e)
    if (!l || !l.length) {
      if (e === 'error') throw args[0]
      return false
    }
    this._ev.set(e, l.filter((x) => !x.once))
    for (const x of l) x.fn.apply(this, args)
    return true
  }
  listenerCount(e: string | symbol) {
    return this._ev.get(e)?.length ?? 0
  }
  listeners(e: string | symbol) {
    return (this._ev.get(e) ?? []).map((x) => x.fn)
  }
  eventNames() {
    return [...this._ev.keys()]
  }
  setMaxListeners() {
    return this
  }
  getMaxListeners() {
    return EventEmitter.defaultMaxListeners
  }
}
