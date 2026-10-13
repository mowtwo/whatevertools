// 验收：桌面挂件插件在 Electron 兼容层里运行。
// 安全措施：用 window:* hook 把插件建的所有窗口放到屏幕外、不显示、不置顶，绝不在真实屏幕上出现可能拦截鼠标的覆盖层。
const path = require('node:path')
const sweepElectron = require('./sweep-electron')

module.exports = async (t) => {
  const dir = process.env.PLUGIN_DIR || path.resolve(__dirname, '../../../utools-desktop-widgets/dist')
  const created = []
  const host = t.host({ prompt: async () => 'always' })
  host.hooks.on('window:create', {
    apply: async (c, next) => {
      const r = await next()
      created.push(r.url.split('?')[0])
      return { ...r, options: { ...r.options, show: false, x: -30000, y: -30000, alwaysOnTop: false, fullscreen: false } }
    },
  })
  for (const m of ['show', 'showInactive', 'focus', 'setAlwaysOnTop', 'setFullScreen', 'setBounds', 'setPosition', 'moveTop', 'setVisibleOnAllWorkspaces']) {
    host.hooks.on(`window:${m}`, { apply: () => undefined })
  }
  const plugin = host.loadPlugin(dir)
  await host.enter(plugin.id, { code: 'settings', type: 'text', payload: '晾衣绳', from: 'main' })
  await t.sleep(2500)
  const js = (code) => t.js(plugin.mainWc, code)

  await t.test('插件主界面加载，preload 正常', async () => {
    const r = await js('({ utools: typeof utools, services: typeof window.services, title: document.title, body: document.body.innerText.length })')
    t.assert.equal(r.utools, 'object')
    t.assert.equal(r.services, 'object')
    t.assert.ok(r.body > 0)
  })

  await t.test('悬浮层窗口创建了（被 hook 放到屏幕外）', async () => {
    t.assert.ok(created.some((u) => u.startsWith('overlay.html')), JSON.stringify(created))
    t.assert.ok([...plugin.windows.values()].every((w) => !w.win.isVisible()), '所有窗口都不可见')
  })

  await t.test('MCP 工具：挂便签、读晾衣绳、加待办、取下', async () => {
    await host.mcp.start(0)
    const cfg = host.mcp.clientConfig()
    const rpc = async (name, args) => (await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', ...cfg.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()
    const list = await (await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', ...cfg.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json()
    const prefix = list.result.tools.find((x) => x.name.endsWith('_get_clothesline')).name.replace(/get_clothesline$/, '')
    const hung = await rpc(prefix + 'hang_on_clothesline', { notes: ['兼容层验收便签'] })
    t.assert.ok(!hung.result.isError, JSON.stringify(hung.result))
    const id = hung.result.structuredContent.hung[0].id
    const todo = await rpc(prefix + 'add_todo', { text: '验收待办', new_card: true })
    t.assert.ok(!todo.result.isError, JSON.stringify(todo.result))
    const get = await rpc(prefix + 'get_clothesline', {})
    const items = get.result.structuredContent.items
    t.assert.ok(items.some((i) => i.id === id && i.text === '兼容层验收便签'))
    t.assert.ok(items.some((i) => i.type === 'todo' && i.lines.some((l) => l.text === '验收待办')))
    t.assert.ok(get.result.structuredContent.displays.length >= 1, '读到显示器列表')
    const rm = await rpc(prefix + 'remove_from_clothesline', { ids: [id, todo.result.structuredContent.card_id] })
    t.assert.equal(rm.result.structuredContent.removed.length, 2)
    host.mcp.stop()
  })

  await t.test('数据库：插件设置写进了兼容层的 db', async () => {
    const r = await js('utools.db.allDocs().map((d) => d._id)')
    t.assert.ok(Array.isArray(r))
  })

  // 每个页面、弹窗点一遍，零报错（步骤和网页版巡检共用）
  await sweepElectron(t, host, plugin, 'desktop-widgets.mjs')
}
