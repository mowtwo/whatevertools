import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { capability, method, UnsupportedError, onUnsupported, report } = require('../dist/index.js')

test('用第一个可用的实现，并缓存探测结果', () => {
  let probes = 0
  const cap = capability('t.first', [
    { id: 'a', available: () => (probes++, false), run: () => 'a' },
    { id: 'b', run: () => 'b' },
    { id: 'c', run: () => 'c' },
  ])
  assert.equal(cap(), 'b')
  assert.equal(cap(), 'b')
  assert.equal(cap.support(), 'b')
  assert.equal(probes, 1)
})

test('available 抛错按不可用处理', () => {
  const cap = capability('t.throwProbe', [{ id: 'a', available: () => { throw new Error('x') }, run: () => 'a' }, { id: 'b', run: () => 'b' }])
  assert.equal(cap(), 'b')
})

test('都不可用时抛 UnsupportedError，带提示和试过的实现', () => {
  const cap = capability('t.none', [{ id: 'native', available: () => false, run: () => 1 }], { hint: '请升级宿主' })
  assert.equal(cap.support(), false)
  assert.throws(cap, (e) => {
    assert.ok(e instanceof UnsupportedError)
    assert.ok(UnsupportedError.is(e))
    assert.equal(e.capability, 't.none')
    assert.deepEqual(e.tried, ['native'])
    assert.match(e.message, /请升级宿主/)
    return true
  })
  assert.equal(cap.try(), undefined)
})

test('missing: noop 不抛错', () => {
  const cap = capability('t.noop', [{ id: 'a', available: () => false, run: () => 1 }], { missing: 'noop' })
  assert.equal(cap(), undefined)
})

test('onUnsupported 每个能力只通知一次，report 列出探测结果', () => {
  const seen = []
  const off = onUnsupported((i) => seen.push(i.name))
  const cap = capability('t.notify', [{ id: 'a', available: () => false, run: () => 1 }], { missing: 'noop' })
  cap()
  cap()
  off()
  assert.deepEqual(seen, ['t.notify'])
  const r = report().find((x) => x.name === 't.notify')
  assert.deepEqual(r, { name: 't.notify', using: false, tried: [{ id: 'a', available: false }] })
})

test('默认不因运行时报错换实现', () => {
  const cap = capability('t.noRetry', [{ id: 'a', run: () => { throw new Error('boom') } }, { id: 'b', run: () => 'b' }])
  assert.throws(cap, /boom/)
})

test('fallbackOnError：同步和异步失败都换下一个实现，之后不再选失败的', async () => {
  let aCalls = 0
  const sync = capability('t.retrySync', [{ id: 'a', run: () => { aCalls++; throw new Error('boom') } }, { id: 'b', run: (x) => x * 2 }], { fallbackOnError: true })
  assert.equal(sync(2), 4)
  assert.equal(sync(3), 6)
  assert.equal(aCalls, 1)
  assert.equal(sync.support(), 'b')
  const asyncCap = capability('t.retryAsync', [{ id: 'a', run: async () => { throw new Error('no') } }, { id: 'b', run: async () => 'b' }], { fallbackOnError: true })
  assert.equal(await asyncCap(), 'b')
  const last = capability('t.retryLast', [{ id: 'a', run: () => { throw new Error('last') } }], { fallbackOnError: true })
  assert.throws(last, /last/)
  last.reset()
  assert.equal(last.support(), 'a')
})

test('method：按路径取函数、保留 this、target 可以晚到', () => {
  let host
  const cap = capability('t.method', [method(() => host, 'db.get'), { id: 'fallback', run: () => 'fallback' }])
  assert.equal(cap('k'), 'fallback')
  host = { db: { prefix: 'v:', get(k) { return this.prefix + k } } }
  cap.reset()
  assert.equal(cap.support(), 'db.get')
  assert.equal(cap('k'), 'v:k')
})

test('ESM 产物导出同样的接口', async () => {
  const esm = await import('../dist/index.mjs')
  assert.equal(typeof esm.capability, 'function')
  assert.equal(typeof esm.method, 'function')
  assert.equal(typeof esm.UnsupportedError.is, 'function')
})

test('CJS 产物不依赖任何模块（可以单文件拷进插件）', () => {
  const src = require('node:fs').readFileSync(require.resolve('../dist/index.js'), 'utf8')
  assert.doesNotMatch(src, /require\(/)
})
