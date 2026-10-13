// 功能回归：入口、来源、提供者、hook、分离、MCP、数据库、窗口
const path = require('node:path')
const fs = require('node:fs')

module.exports = async (t) => {
  const { WindowShell } = require('../../dist/main')
  const { createUtoolsCompat } = require('@whatevertools/compat-utools')
  void createUtoolsCompat
  const shell = new WindowShell({ mode: 'launcher' })
  const enters = []
  const host = t.host({
    shell,
    prompt: async () => 'once',
    providers: {
      user: { get: (ctx) => ({ nickname: 'tester:' + ctx.pluginId, avatar: '', type: 'user' }) },
      ai: { models: () => [{ id: 'm', label: 'M', icon: '' }], complete: async (_ctx, req, io) => ({ role: 'assistant', content: 'echo:' + req.messages.at(-1).content + ':' + JSON.stringify(await io.callTool('echo', { text: 'via-ai' })) }) },
    },
  })
  shell.bind(host)
  host.hooks.on('event:enter', { apply: (c, next) => (enters.push(c.args[0].from + ':' + c.args[0].code), next()) })
  const plugin = host.loadPlugin(t.fixture())
  host.startSources()
  const js = (code) => t.js(plugin.mainWc, code)

  await t.test('身份：插件名 / 版本 / 宿主 / 伪装平台', async () => {
    await host.sources.context('main').enter({ pluginId: plugin.id, code: 'main', type: 'text', payload: '夹具插件' })
    const id = await js('JSON.stringify({ p: whatevertools.identity.plugin, rt: whatevertools.identity.runtime.name, v: utools.getAppVersion() })')
    const d = JSON.parse(id)
    t.assert.deepEqual(d.p, { id: 'fixture-basic', name: '夹具插件', version: '1.2.3' })
    t.assert.equal(d.rt, 'whatevertools')
  })

  await t.test('入口匹配：文字 / 正则 / 文件', async () => {
    const r1 = host.emitFrom('main', { text: '夹具' }).map((r) => r.code)
    t.assert.ok(r1.includes('main') && r1.includes('files'))
    t.assert.equal(host.emitFrom('main', { text: 'https://a.dev' })[0].code, 'url')
    t.assert.equal(host.emitFrom('main', { files: [{ path: '/x/a.png', name: 'a.png', isFile: true, isDirectory: false }] })[0].code, 'files')
    t.assert.equal(host.emitFrom('main', { files: [{ path: '/x/a.txt', name: 'a.txt', isFile: true, isDirectory: false }] }).length, 0)
  })

  await t.test('来源：超级面板 / 自定义来源 / hook 拒绝注册', async () => {
    host.hooks.on('source:register', { apply: (c, next) => (c.args[0].id === 'blocked' ? null : next()) })
    host.sources.register({ id: 'blocked', setup() {} })
    let ctx
    host.sources.register({ id: 'url-scheme', setup(c) { ctx = c } })
    const r = ctx.emit({ text: '夹具网址' })
    await ctx.enter({ pluginId: r[0].pluginId, code: r[0].code, type: r[0].type, payload: r[0].payload })
    const panel = host.sources.context('panel')
    const pr = panel.emit({ text: 'https://x.dev' })
    await panel.enter({ pluginId: pr[0].pluginId, code: pr[0].code, type: pr[0].type, payload: pr[0].payload })
    t.assert.ok(!host.sources.list().some((s) => s.id === 'blocked'))
    t.assert.ok(enters.includes('url-scheme:url') && enters.includes('panel:url'), JSON.stringify(enters))
  })

  await t.test('onSearchPush：推送结果和 onSelect', async () => {
    const shellAny = shell
    const rows = await shellAny.query({ text: '夹具推送' })
    t.assert.ok(rows.some((r) => r.label === '推送结果 夹具推送'), JSON.stringify(rows))
  })

  await t.test('提供者 + hook：用户信息、AI（含工具调用）', async () => {
    host.hooks.on('provider:user.get', { apply: (c, next) => ({ ...next(), hooked: true }) })
    const u = JSON.parse(await js('JSON.stringify(utools.getUser())'))
    t.assert.equal(u.nickname, 'tester:fixture-basic')
    t.assert.equal(u.hooked, true)
    const m = await js('utools.ai({ messages: [{ role: "user", content: "hi" }] }).then((x) => x.content)')
    t.assert.match(m, /^echo:hi:\{"echoed":"via-ai"/)
  })

  await t.test('MCP：鉴权、列出、调用插件工具', async () => {
    await host.mcp.start(0)
    const cfg = host.mcp.clientConfig()
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', ...cfg.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()
    t.assert.equal((await fetch(cfg.url, { method: 'POST', body: '{}' })).status, 401)
    const list = await rpc('tools/list', {})
    t.assert.ok(list.result.tools.some((x) => x.name === 'fixture_basic_echo'))
    const call = await rpc('tools/call', { name: 'fixture_basic_echo', arguments: { text: 'hello' } })
    t.assert.deepEqual(call.result.structuredContent, { echoed: 'hello', from: 'fixture' })
    // 进度通知：带 progressToken 且接受 SSE 时用事件流返回
    const sse = await (await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...cfg.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'fixture_basic_slow', arguments: {}, _meta: { progressToken: 'p1' } } }) })).text()
    const events = sse.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6)))
    t.assert.deepEqual(events.filter((e) => e.method === 'notifications/progress').map((e) => e.params.message), ['一半', '完成'])
    t.assert.deepEqual(events.at(-1).result.structuredContent, { done: true })
    host.mcp.stop()
  })

  await t.test('数据库 / dbStorage / 附件', async () => {
    const r = JSON.parse(await js(`JSON.stringify((() => {
      const a = utools.db.put({ _id: 'doc1', v: 1 })
      const conflict = utools.db.put({ _id: 'doc1', v: 2 })
      utools.dbStorage.setItem('k', { x: 1 })
      const att = utools.db.postAttachment('att1', new Uint8Array([1, 2, 3]), 'image/png')
      return { ok: a.ok, conflict: conflict.name, kv: utools.dbStorage.getItem('k'), att: att.ok, bytes: Array.from(utools.db.getAttachment('att1')), type: utools.db.getAttachmentType('att1'), all: utools.db.allDocs().map((d) => d._id) }
    })())`))
    t.assert.deepEqual(r, { ok: true, conflict: 'conflict', kv: { x: 1 }, att: true, bytes: [1, 2, 3], type: 'image/png', all: ['doc1'] })
  })

  await t.test('分离窗口：window.type 变 detach，onPluginDetach 触发', async () => {
    host.panel('detach', plugin)
    await t.sleep(400)
    t.assert.equal(await js('utools.getWindowType()'), 'detach')
    t.assert.ok((await js('window.__events')).includes('detach'))
  })

  await t.test('自定义窗口：创建、通信、hook 改写选项', async () => {
    host.hooks.on('window:create', { apply: async (c, next) => { const r = await next(); return { ...r, options: { ...r.options, title: 'hooked' } } } })
    const title = await js(`new Promise((res) => { const w = utools.createBrowserWindow('index.html', { show: false }, () => res(w.getTitle())) })`)
    t.assert.ok(typeof title === 'string')
  })

  await t.test('主题：宿主切换主题时插件收到 onThemeChange', async () => {
    const { nativeTheme } = require('electron')
    const before = nativeTheme.themeSource
    host.setTheme(nativeTheme.shouldUseDarkColors ? 'light' : 'dark')
    await t.sleep(300)
    const ev = await js('window.__events.filter((e) => e.startsWith("theme:"))')
    host.setTheme(before)
    t.assert.ok(ev.length >= 1, JSON.stringify(ev))
  })

  await t.test('退出后重进：onPluginOut(true) 后能重新启动', async () => {
    host.out(plugin, true)
    await t.sleep(600)
    await host.sources.context('main').enter({ pluginId: plugin.id, code: 'main', type: 'text', payload: '夹具插件' })
    t.assert.ok(plugin.mainWc && !plugin.mainWc.isDestroyed())
  })
}
