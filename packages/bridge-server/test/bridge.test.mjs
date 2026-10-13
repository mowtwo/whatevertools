import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createBridgeServer } = require('../dist/index.js')

test('bridge server: auth, origin, roots, chrome-like permission answers', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whatevertools-bridge-')))
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello')
  const answers = []
  const { server, token } = createBridgeServer({ origins: ['http://app.test'], roots: [root], prompt: async (pl, perm, scope) => (answers.push([pl, perm]), pl === 'p' ? 'always' : 'block') })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (body, h = {}) => fetch(`${base}/v1/call`, { method: 'POST', headers: { origin: 'http://app.test', authorization: `Bearer ${token}`, 'content-type': 'application/json', ...h }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  try {
    assert.equal((await call({}, { authorization: 'Bearer nope' })).status, 401)
    assert.equal((await call({}, { origin: 'http://evil.test' })).status, 403)
    assert.equal((await fetch(`${base}/v1/call`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })).status, 403, '没有 Origin 的请求拒绝')
    const ok = await call({ plugin: 'p', cap: 'fs', method: 'readFile', args: [path.join(root, 'a.txt')] })
    assert.deepEqual(answers[0], ['p', 'fs.read'], '守护进程自己问用户')
    const self = await call({ plugin: 'p', cap: 'permissions', method: 'answer', args: ['fs.write', 'always'] })
    assert.equal(self.status, 404, '网页不能替用户回答权限')
    assert.equal(Buffer.from(ok.value, 'base64').toString(), 'hello')
    const outside = await call({ plugin: 'p', cap: 'fs', method: 'readFile', args: ['/etc/hosts'] })
    assert.equal(outside.error.code, 'EACCES')
    const escape = await call({ plugin: 'p', cap: 'fs', method: 'readFile', args: [path.join(root, '..', path.basename(root) + '-x', 'a')] })
    assert.equal(escape.error.code, 'EACCES')
    const other = await call({ plugin: 'q', cap: 'fs', method: 'readFile', args: [path.join(root, 'a.txt')] })
    assert.equal(other.error.code, 'EWTPERM', '权限按插件区分（q 被拒绝）')
  } finally {
    server.close()
  }
})
