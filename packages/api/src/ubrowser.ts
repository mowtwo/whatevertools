// ubrowser 链式 API：调用只是记录指令，run() 时把整串指令交给平台的 BrowserCapability 执行
import type { BrowserCapability } from '@whatevertools/core'

const OPS = [
  'goto', 'userAgent', 'viewport', 'device', 'click', 'dblclick', 'mousedown', 'mouseup', 'hover', 'press', 'focus', 'input',
  'value', 'check', 'scroll', 'file', 'drop', 'paste', 'download', 'evaluate', 'css', 'wait', 'when', 'endWhen', 'markdown',
  'screenshot', 'pdf', 'cookies', 'setCookies', 'removeCookies', 'clearCookies', 'show', 'hide', 'devTools',
]

/** 函数参数要在页面里执行，转成源码 */
function encodeArg(a: unknown): unknown {
  if (typeof a === 'function') return { __whatevertoolsFn: a.toString() }
  return a
}

export function createAutomation(cap: BrowserCapability | undefined, unsupported: (name: string) => never): any {
  const steps: Array<{ op: string; args: unknown[] }> = []
  const chain: Record<string, unknown> = {}
  for (const op of OPS) {
    chain[op] = (...args: unknown[]) => {
      steps.push({ op, args: args.map(encodeArg) })
      return chain
    }
  }
  chain.run = (target?: Record<string, unknown> | number) => {
    if (!cap) unsupported('ubrowser')
    const depth = steps.reduce((d, s) => d + (s.op === 'when' ? 1 : s.op === 'endWhen' ? -1 : 0), 0)
    if (depth !== 0) return Promise.reject(new Error('ubrowser: when() 和 endWhen() 没有成对出现'))
    return cap!.run(steps.slice(), target)
  }
  return chain
}
