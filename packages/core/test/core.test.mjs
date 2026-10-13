import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const core = require('../dist/index.js')
const { registerUtoolsEntries, utoolsManifestLoader } = require('../../compat-utools/dist/index.js')
const parse = (src) => core.loadManifest([core.nativeManifestLoader, utoolsManifestLoader], { dir: src.dir, files: { 'plugin.json': src.pluginJson, ...(src.whatevertoolsJson ? { 'whatevertools.json': src.whatevertoolsJson } : {}), ...(src.packageJson ? { 'package.json': src.packageJson } : {}) } })

test('hooks: get / apply / set / construct on nested paths', () => {
  const reg = new core.HookRegistry()
  const fs = { readFileSync: (p) => `content of ${p}`, constants: { F_OK: 0 }, nested: { deep: { fn: () => 1 } } }
  const calls = []
  reg.on('node:fs.readFileSync', { apply: (ctx, next) => (calls.push(ctx.args[0]), next([ctx.args[0].toUpperCase()])) })
  reg.on('node:fs.nested.**', { apply: (ctx, next) => next() + 1 })
  reg.on('node:fs.constants', { get: (ctx, next) => ({ ...next(), HOOKED: 1 }) })
  const w = reg.wrap(fs, 'node:fs')
  assert.equal(w.readFileSync('/a'), 'content of /A')
  assert.deepEqual(calls, ['/a'])
  assert.equal(w.nested.deep.fn(), 2)
  assert.equal(w.constants.HOOKED, 1)
  let setTo
  reg.on('api:flag', { set: (ctx, next) => ((setTo = ctx.value), next('x')) })
  const api = reg.wrap({ flag: 0 }, 'api:')
  api.flag = 5
  assert.equal(setTo, 5)
  assert.equal(api.flag, 'x')
  class Stream { constructor(p) { this.p = p } }
  reg.on('node:fs.Stream', { construct: (ctx, next) => next(['/hooked']) })
  const W = reg.wrap({ Stream }, 'node:fs')
  const s = new W.Stream('/x')
  assert.equal(s.p, '/hooked')
  assert.ok(s instanceof Stream)
})

test('hooks: frozen props and unwrapped targets pass through', () => {
  const reg = new core.HookRegistry()
  const obj = Object.freeze({ inner: { a: 1 } })
  const w = reg.wrap(obj, 'api:')
  assert.equal(w.inner, obj.inner)
})

test('permissions: chrome-like defaults, answers, dismiss limit, per-plugin overrides', () => {
  const policy = { plugins: { b: { 'fs.read': ['/data'] } } }
  const a = new core.PermissionSet('a', policy, {})
  assert.equal(a.check('storage'), 'grant')
  assert.equal(a.check('clipboard.read'), 'ask')
  a.answer('clipboard.read', 'once')
  assert.equal(a.check('clipboard.read'), 'grant')
  assert.equal(a.answer('screen.capture', 'dismiss'), undefined)
  assert.equal(a.check('screen.capture'), 'deny')
  a.answer('screen.capture', 'dismiss')
  const persisted = a.answer('screen.capture', 'dismiss')
  assert.equal(persisted.decision, 'deny')
  a.set('screen.capture', 'ask')
  assert.equal(a.check('screen.capture'), 'ask')
  const b = new core.PermissionSet('b', policy, {})
  assert.equal(b.check('fs.read', '/data/x.png'), 'grant')
  assert.equal(b.check('fs.read', '/database'), 'ask')
  assert.equal(b.check('fs.read', '/data/../etc/passwd'), 'ask', '.. 不能绕过作用域')
  assert.equal(b.check('fs.read'), 'ask', '带作用域的授权遇到没有作用域的请求要询问')
  assert.equal(b.check('fs.read', ['/data/x']), 'ask', '非字符串作用域不能放行')
  assert.ok(core.scopeMatches(['C:\\Users\\A'], 'c:/users/a/x.txt'), 'Windows 盘符路径大小写不敏感')
  assert.ok(!core.scopeMatches(['/a'], '/ab'), '目录边界')
  b.grantPath('fs.read', '/picked/a.png')
  assert.equal(b.check('fs.read', '/picked/a.png'), 'grant')
  assert.equal(b.check('fs.read', '/picked/b.png'), 'ask')
})

test('version ranges', () => {
  assert.ok(core.satisfies('0.1.3', '^0.1.0'))
  assert.ok(!core.satisfies('0.2.0', '^0.1.0'))
  assert.ok(core.satisfies('1.4.0', '>=1.2 <2'))
  assert.ok(core.satisfies('2.0.0', '^1 || ^2'))
  assert.ok(core.satisfies('1.2.9', '1.2.x'))
})

test('manifest + matcher with a legacy plugin.json', () => {
  const m = parse({
    dir: '/x/quick-union/dist',
    pluginJson: {
      main: 'index.html', logo: 'logo.png', preload: 'preload.js',
      features: [
        { code: 'stitch', cmds: ['图片拼接', { type: 'files', label: '拼接', fileType: 'file', extensions: ['png'], minLength: 2 }] },
        { code: 'url', cmds: ['打开', { type: 'regex', label: '网址', match: '/^https?:\\/\\/\\S+$/i' }, { type: 'over', label: '任意' }] },
      ],
    },
    packageJson: { name: 'quick-union', version: '1.1.0' },
  })
  assert.equal(m.id, 'quick-union')
  assert.equal(m.version, '1.1.0')
  assert.equal(m.format, 'utools')
  const hooks = new core.HookRegistry()
  const reg = new core.EntryRegistry(hooks, () => [{ pluginId: m.id, features: m.features }], { platform: 'darwin' })
  assert.equal(reg.match({ text: '拼接' }).length, 0, 'core 不内置入口类型')
  registerUtoolsEntries(reg)
  const r1 = reg.match({ text: '拼接' })
  assert.equal(r1[0].code, 'stitch')
  assert.equal(reg.match({ text: 'tppj' })[0]?.code, 'stitch', '首字母')
  assert.equal(reg.match({ text: 'tupianpinjie' })[0]?.code, 'stitch', '全拼')
  const files = [{ isFile: true, isDirectory: false, name: 'a.png', path: '/a.png' }, { isFile: true, isDirectory: false, name: 'b.PNG', path: '/b.PNG' }]
  assert.equal(reg.match({ files })[0].type, 'files')
  assert.equal(reg.match({ files: files.slice(0, 1) }).length, 0)
  const r3 = reg.match({ text: 'https://a.com' })
  assert.deepEqual(r3.map((r) => r.type), ['regex', 'over'])
  // hook：拒绝注册 over；自定义入口类型 + emit
  hooks.on('entry:register', { apply: (ctx, next) => (ctx.args[0].type === 'clip-url' ? next([{ ...ctx.args[0], extra: true }]) : next()) })
  reg.unregister('over')
  reg.register({ type: 'clip-url', match: (cmd, input) => (typeof input.url === 'string' ? { payload: input.url, score: 50 } : null) })
  assert.equal(reg.get('clip-url').extra, true)
  m.features.push({ code: 'url2', cmds: [{ type: 'clip-url', label: '收藏网址' }] })
  const seen = []
  reg.onEmit((results, input, meta) => seen.push([results.length, meta.from]))
  hooks.on('entry:match.clip-url', { apply: (ctx, next) => { const r = next(); return r && { ...r, score: 99 } } })
  const r4 = reg.emit({ url: 'https://x.dev' }, { from: 'url-scheme' })
  assert.equal(r4[0].code, 'url2')
  assert.equal(r4[0].score, 99)
  assert.deepEqual(seen, [[1, 'url-scheme']])
  assert.deepEqual(reg.match({ text: 'https://a.com' }).map((r) => r.type), ['regex'])
  assert.throws(() => parse({ dir: '/x', pluginJson: { main: '../evil.html', logo: 'l.png', features: [] } }), /相对路径/)
  const pj = { main: 'index.html', logo: 'l.png', features: [{ code: 'a', cmds: ['a'] }] }
  assert.throws(() => parse({ dir: '/x', pluginJson: pj, whatevertoolsJson: { id: '..' } }), /id 不合法/)
  assert.throws(() => parse({ dir: '/x', pluginJson: pj, whatevertoolsJson: { id: '.' } }), /id 不合法/)
})

test('scheduler: one-shot and cron with success/failure counts', async () => {
  let now = new Date('2026-10-13T10:00:30').getTime()
  const store = new core.MemoryHostStore()
  const runs = []
  const s = new core.Scheduler({ store, hooks: new core.HookRegistry(), now: () => now, run: async (pid, code) => { runs.push(code); if (code === 'bad') throw new Error('x') } })
  s.add('p', { code: 'once', label: 'once', trigger: now + 10 })
  s.add('p', { code: 'bad', label: 'bad', trigger: now + 20 })
  await new Promise((r) => setTimeout(r, 60))
  assert.deepEqual(runs.sort(), ['bad', 'once'])
  assert.equal(s.list('p').length, 0, '一次性任务触发后删除')
  assert.throws(() => s.add('p', { code: 'c', label: 'c', trigger: { cron: 'bad cron' } }), /cron/)
  assert.ok(core.parseCron('*/15 9-18 * * 1-5')(new Date('2026-10-13T09:45:00')))
  assert.ok(!core.parseCron('*/15 9-18 * * 1-5')(new Date('2026-10-18T09:45:00')), '周日不触发')
  s.stop()
})

test('hotkey table: persisted + session overlay', () => {
  const store = new core.MemoryHostStore()
  const h = new core.HotkeyTable(store)
  h.set('p', '默认', 'Alt+1', false, false)
  h.set('p', '用户', 'Alt+2', true)
  assert.equal(h.get('p', '默认'), 'Alt+1')
  assert.deepEqual(Object.keys(store.get('hotkeys').p), ['用户'], '临时快捷键不落盘')
  assert.equal(h.list().length, 2)
})
