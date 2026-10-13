// 生命周期：后台超时退出、有窗口时不退出、hook 拦截、崩溃处理
module.exports = async (t) => {
  await t.test('后台超时自动结束插件', async () => {
    const host = t.host({ prompt: async () => 'always', timeouts: { idleExit: 300 } })
    const p = host.loadPlugin(t.fixture())
    await host.enter(p.id, { code: 'main', type: 'text', payload: '夹具插件', from: 'main' })
    host.out(p, false)
    await t.sleep(700)
    t.assert.equal(p.alive, false)
  })

  await t.test('有窗口开着时不自动结束', async () => {
    const host = t.host({ prompt: async () => 'always', timeouts: { idleExit: 300 } })
    const p = host.loadPlugin(t.fixture())
    await host.enter(p.id, { code: 'main', type: 'text', payload: '夹具插件', from: 'main' })
    await t.js(p.mainWc, `new Promise((r) => { const w = utools.createBrowserWindow('index.html', { show: true, x: -20000, y: -20000, width: 50, height: 50 }, () => r()) })`)
    host.out(p, false)
    await t.sleep(700)
    t.assert.equal(p.alive, true)
  })

  await t.test('lifecycle hook 可以拦截进入和退出', async () => {
    const host = t.host({ prompt: async () => 'always' })
    const p = host.loadPlugin(t.fixture())
    host.hooks.on('lifecycle:enter', { apply: (c, next) => (c.args[1].code === 'files' ? null : next()) })
    await host.enter(p.id, { code: 'files', type: 'text', payload: '夹具文件', from: 'main' })
    t.assert.equal(p.alive, false, '被拦截的进入不会启动插件')
    await host.enter(p.id, { code: 'main', type: 'text', payload: '夹具插件', from: 'main' })
    host.hooks.on('lifecycle:exit', { apply: () => false })
    host.out(p, true)
    await t.sleep(300)
    t.assert.equal(p.alive, true, '被拦截的退出不会结束插件')
  })

  await t.test('插件进程崩溃后可以重新进入', async () => {
    const host = t.host({ prompt: async () => 'always' })
    const crashes = []
    host.hooks.on('lifecycle:crash', { apply: (c) => crashes.push(c.args[1]) })
    const p = host.loadPlugin(t.fixture())
    await host.enter(p.id, { code: 'main', type: 'text', payload: '夹具插件', from: 'main' })
    p.mainWc.forcefullyCrashRenderer()
    await t.sleep(800)
    t.assert.ok(crashes.length >= 1, '触发了 lifecycle:crash')
    t.assert.equal(p.alive, false)
    await host.enter(p.id, { code: 'main', type: 'text', payload: '夹具插件', from: 'main' })
    t.assert.equal(await t.js(p.mainWc, 'typeof utools.getAppVersion'), 'function')
  })
}
