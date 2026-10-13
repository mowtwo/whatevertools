import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { DocDb, MemoryBackend, Replicator } = require('../../core/dist/index.js')
const { FileBackend } = require('../../db-file/dist/index.js')
const { FolderSync } = require('../../sync-folder/dist/index.js')
const { HttpSync, createSyncServer } = require('../dist/index.js')

test('DocDb: legacy semantics', async () => {
  const db = new DocDb(new MemoryBackend())
  await db.load()
  const r = db.put({ _id: 'a', v: 1 })
  assert.ok(r.ok && r.rev.startsWith('1-'))
  assert.equal(db.put({ _id: 'a', v: 2 }).name, 'conflict')
  assert.ok(db.put({ _id: 'a', _rev: r.rev, v: 2 }).ok)
  assert.equal(db.get('a').v, 2)
  db.setItem('theme', { dark: true })
  assert.deepEqual(db.getItem('theme'), { dark: true })
  assert.deepEqual(db.allDocs().map((d) => d._id), ['a'])
  assert.ok(db.remove('a').ok)
  assert.equal(db.get('a'), null)
  assert.ok(db.put({ _id: 'a', v: 3 }).ok, 'recreate after delete')
  const big = 'x'.repeat(1024 * 1024)
  assert.equal(db.put({ _id: 'big', big }).name, 'exception')
  assert.ok((await db.postAttachment('img', new Uint8Array([1, 2, 3]), 'image/png')).ok)
  assert.deepEqual([...(await db.getAttachment('img'))], [1, 2, 3])
  assert.equal(db.getAttachmentType('img'), 'image/png')
  assert.equal((await db.postAttachment('img', new Uint8Array([1]), 'x')).name, 'conflict')
})

test('FileBackend persists across reloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatevertools-db-'))
  const a = new DocDb(new FileBackend({ dir }))
  await a.load()
  a.put({ _id: 'x', n: 1 })
  a.setItem('k', 'v')
  await a.postAttachment('f', new Uint8Array([9]), 'text/plain')
  await a.flush()
  const b = new DocDb(new FileBackend({ dir }))
  await b.load()
  assert.equal(b.get('x').n, 1)
  assert.equal(b.getItem('k'), 'v')
  assert.deepEqual([...(await b.getAttachment('f'))], [9])
})

async function pair(makeAdapter) {
  const A = new DocDb(new MemoryBackend()), B = new DocDb(new MemoryBackend())
  await A.load(); await B.load()
  const pulledB = []
  const ra = new Replicator(A, makeAdapter('dev-a'), { namespace: 'p', device: 'dev-a', interval: 0 })
  const rb = new Replicator(B, makeAdapter('dev-b'), { namespace: 'p', device: 'dev-b', interval: 0, onPull: (d) => pulledB.push(...d) })
  return { A, B, ra, rb, pulledB }
}

async function exercise({ A, B, ra, rb, pulledB }) {
  assert.equal(rb.state, 1)
  A.put({ _id: 'note', text: 'hello' })
  A.setItem('pref', 42)
  await ra.sync(); await rb.sync()
  assert.equal(rb.state, 0)
  assert.equal(B.get('note').text, 'hello')
  assert.equal(B.getItem('pref'), 42)
  assert.ok(pulledB.some((d) => d._id === 'note'))
  // 并发修改：两边都改，裁决结果一致
  const nb = B.get('note')
  B.put({ ...nb, text: 'from B' })
  const na = A.get('note')
  A.put({ ...na, text: 'from A' })
  await ra.sync(); await rb.sync(); await ra.sync()
  assert.equal(A.get('note').text, B.get('note').text)
  // 删除也同步
  B.remove(B.get('note'))
  await rb.sync(); await ra.sync()
  assert.equal(A.get('note'), null)
}

test('Replicator over shared folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatevertools-sync-'))
  await exercise(await pair((device) => new FolderSync({ dir, device })))
})

test('Replicator over HTTP reference server', async () => {
  const server = createSyncServer({ token: 't0k' })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await exercise(await pair(() => new HttpSync({ baseUrl: base, token: 't0k' })))
    const res = await fetch(`${base}/v1/p/pull`)
    assert.equal(res.status, 401)
  } finally {
    server.close()
  }
})

test('重启后没推送的变更不会丢（变更日志在内存里）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferry-restart-'))
  const share = fs.mkdtempSync(path.join(os.tmpdir(), 'ferry-share-'))
  const a1 = new DocDb(new FileBackend({ dir }))
  await a1.load()
  a1.put({ _id: 'offline', v: 1 })
  await a1.flush()
  // 「重启」：重新打开同一个库，日志是空的，但 seq 已经前进
  const a2 = new DocDb(new FileBackend({ dir }))
  await a2.load()
  const ra = new Replicator(a2, new FolderSync({ dir: share, device: 'a' }), { namespace: 'p', device: 'a', interval: 0 })
  await ra.sync()
  const B = new DocDb(new MemoryBackend())
  await B.load()
  await new Replicator(B, new FolderSync({ dir: share, device: 'b' }), { namespace: 'p', device: 'b', interval: 0 }).sync()
  assert.equal(B.get('offline')?.v, 1)
})

test('写盘失败的那批会重新排队', async () => {
  const be = new MemoryBackend()
  let fail = true
  const orig = be.write.bind(be)
  be.write = (w) => { if (fail) throw new Error('disk full'); return orig(w) }
  const db = new DocDb(be)
  db.onWriteError = () => {}
  await db.load()
  db.put({ _id: 'x', v: 1 })
  await db.flush().catch(() => {})
  fail = false
  await db.flush()
  assert.equal(be.docs.x.v, 1)
})
