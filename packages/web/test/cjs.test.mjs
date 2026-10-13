import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createCjsLoader } = require('../dist/cjs.js')

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cjs')

/** /plugin 映射到夹具目录 */
function diskIo(builtins = {}) {
  const real = (p) => (p === '/plugin' || p.startsWith('/plugin/') ? path.join(fixture, p.slice(7)) : '/nonexistent' + p)
  return {
    readFileSync: (p) => new Uint8Array(fs.readFileSync(real(p))),
    existsSync: (p) => fs.existsSync(real(p)),
    builtin: (name) => {
      if (name in builtins) return builtins[name]
      throw Object.assign(new Error('no ' + name), { code: 'MODULE_NOT_FOUND' })
    },
  }
}

test('cjs 加载器：相对文件、JSON、node_modules、循环依赖、内置模块', () => {
  const g = {}
  globalThis.window = g
  try {
    const loader = createCjsLoader(diskIo({ path: path.posix, fs: { readFileSync() {} }, electron: { ipcRenderer: {} } }))
    loader.run('/plugin/preload.js')
    assert.deepEqual(g.__cjs, {
      helper: 'hello web',
      circular: 'function/undefined',
      data: 42,
      pkg: 'somepkg@1.0.0',
      other: 'other-cjs',
      dirname: '/plugin',
      filename: '/plugin/preload.js',
      resolved: '/plugin/node_modules/somepkg/lib/main.js',
      join: 'a/b',
      fs: 'function',
      electron: 'object',
      cached: true,
    })
  } finally {
    delete globalThis.window
  }
})

test('cjs 加载器：找不到模块 / 语法错误不进缓存 / 目录 index', () => {
  const files = new Map([
    ['/a/index.js', 'module.exports = require("./b") + 1'],
    ['/a/b.js', 'module.exports = 41'],
    ['/bad.js', 'this is not js'],
    ['/m.js', 'module.exports = this === exports && typeof require.resolve'],
  ])
  const enc = new TextEncoder()
  const loader = createCjsLoader({
    readFileSync: (p) => {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return enc.encode(files.get(p))
    },
    existsSync: (p) => files.has(p),
    builtin: () => ({}),
  })
  assert.equal(loader.run('/a'), 42)
  assert.equal(loader.run('/m.js'), 'function')
  assert.throws(() => loader.require('nope', '/a'), (e) => e.code === 'MODULE_NOT_FOUND')
  assert.throws(() => loader.run('/bad.js'), SyntaxError)
  assert.equal(loader.cache['/bad.js'], undefined)
  assert.equal(loader.resolve('node:fs', '/'), 'builtin:fs')
  assert.equal(loader.resolve('electron', '/'), 'builtin:electron')
})
