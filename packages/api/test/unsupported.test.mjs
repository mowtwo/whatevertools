// 平台不支持的 API：同步 API 抛错，返回 Promise 的 API 返回失败的 Promise（插件的 .catch 接得住）；没有 AI 提供者时的降级
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createApi } = require('../dist/index.js')
const { buildIdentity } = require('@whatevertools/core')

function minimal(unsupported) {
  const caps = {
    platform: 'test',
    support: () => 'none',
    system: { os: 'test' },
    events: { on() {}, ready() {}, onRequest() {} },
    permissions: { checkSync: () => true },
  }
  const manifest = { id: 'p', name: 'P', version: '1.0.0', features: [], tools: {}, permissions: {}, standalone: {}, panel: { single: true, height: 544 } }
  return createApi(caps, { identity: buildIdentity({}, { id: 'p', name: 'P', version: '1.0.0' }, { platform: 'test', arch: 'x' }), manifest, isDev: false, unsupported }).raw
}

test('同步 API 不支持：抛 EWTUNSUPPORTED', () => {
  const api = minimal()
  assert.throws(() => api.clipboard.writeText('x'), (e) => e.code === 'EWTUNSUPPORTED')
})

test('异步 API 不支持：不同步抛错，返回失败的 Promise', async () => {
  const api = minimal()
  let p
  assert.doesNotThrow(() => (p = api.shell.openPath('/x')))
  assert.ok(p instanceof Promise)
  await assert.rejects(p, (e) => e.code === 'EWTUNSUPPORTED')
})

test('没有 AI 提供者：models 返回空列表，chat 返回带 abort 的失败 Promise', async () => {
  const api = minimal()
  assert.deepEqual(await api.ai.models(), [])
  let r
  assert.doesNotThrow(() => (r = api.ai.chat({ messages: [] })))
  assert.equal(typeof r.abort, 'function')
  await assert.rejects(r, (e) => e.code === 'EWTUNSUPPORTED' && /AI/.test(e.message))
  assert.equal(api.supports('ai.models'), false)
})

test('warn 策略：异步 API 返回 resolve(undefined)', async () => {
  const api = minimal('warn')
  assert.equal(await api.shell.openPath('/x'), undefined)
})

test('权限被拒：异步 API 返回失败的 Promise，不同步抛错', async () => {
  const caps = {
    platform: 'test', support: () => 'native', system: { os: 'test' },
    events: { on() {}, ready() {}, onRequest() {} },
    permissions: { checkSync: () => false },
    shell: { openExternal: async () => {}, openPath: async () => '' },
  }
  const manifest = { id: 'p', name: 'P', version: '1.0.0', features: [], tools: {}, permissions: {}, standalone: {}, panel: { single: true, height: 544 } }
  const api = createApi(caps, { identity: buildIdentity({}, { id: 'p', name: 'P', version: '1.0.0' }, { platform: 'test', arch: 'x' }), manifest, isDev: false }).raw
  let p
  assert.doesNotThrow(() => (p = api.shell.openPath('/x')))
  await assert.rejects(p, (e) => e.code === 'EWTPERM')
})
