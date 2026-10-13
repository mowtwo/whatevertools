// 安全回归：在插件进程里实际尝试各种绕过，必须全部失败
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')

module.exports = async (t) => {
  const prompts = []
  // 只放行建窗口和自动化浏览器，其他一律拒绝
  const host = t.host({ prompt: async (r) => (prompts.push(r.permission + ':' + (r.scope ?? '')), ['window.create', 'browser'].includes(r.permission) ? 'always' : 'block') })
  const plugin = host.loadPlugin(t.fixture())
  await host.enter(plugin.id, { code: 'main', type: 'text', payload: '夹具插件', from: 'main' })
  const wc = plugin.mainWc
  const run = (code) => t.js(wc, `(async () => { try { return { ok: true, v: await (async () => { ${code} })() } } catch (e) { return { ok: false, code: e.code, msg: String(e.message) } } })()`)

  await t.test('launch.open 传入的文件路径不会授予读取', async () => {
    await run(`return utools.redirect(['夹具插件', '夹具收文件'], { type: 'files', data: ['/etc/hosts'] })`)
    await t.sleep(300)
    const r = await run(`return __t.fs.readFileSync('/etc/hosts', 'utf8').length`)
    t.assert.equal(r.ok, false, '应当被拒绝')
    t.assert.equal(r.code, 'EWTPERM')
  })

  await t.test('剪贴板写入任意文件需要读取权限', async () => {
    const r = await run(`return utools.copyFile('/etc/hosts')`)
    t.assert.equal(r.ok, false)
    t.assert.equal(r.code, 'EWTPERM')
  })

  await t.test('窗口 loadURL 不能加载插件目录以外的地址', async () => {
    const r = await run(`const w = utools.createBrowserWindow('index.html', { show: false }); return w.loadURL('file:///etc/hosts')`)
    t.assert.equal(r.ok, false)
    t.assert.match(r.msg, /loadURL/)
  })

  await t.test('IPC 不能调用继承属性或未登记的方法', async () => {
    const a = await run(`return __t.electron.ipcRenderer.sendSync('whatevertools:sync', 'constructor', [])`)
    t.assert.ok(a.ok && a.v.error, '应当返回错误')
    const b = await run(`return __t.electron.ipcRenderer.sendSync('whatevertools:sync', '__proto__', [])`)
    t.assert.ok(b.ok && b.v.error)
    const c = await run(`return __t.electron.ipcRenderer.sendSync('whatevertools:sync', 'db.put', 'not-an-array')`)
    t.assert.ok(c.ok, 'args 不是数组时不能让渲染进程卡住')
  })

  await t.test('shell.openExternal 拒绝 file: 等协议', async () => {
    const r = await run(`return utools.shellOpenExternal('file:///etc')`)
    t.assert.equal(r.ok, false)
  })

  await t.test('fs 拦截：Uint8Array 路径、ReadStream 构造、符号链接都不能绕过', async () => {
    const link = path.join(t.fixture(), 'evil-link')
    try { fs.unlinkSync(link) } catch {}
    fs.symlinkSync('/etc/hosts', link)
    try {
      const a = await run(`return __t.fs.readFileSync(new TextEncoder().encode('/etc/hosts')).length`)
      t.assert.equal(a.ok, false, 'Uint8Array 路径')
      const b = await run(`return new __t.fs.ReadStream('/etc/hosts') && 1`)
      t.assert.equal(b.ok, false, 'ReadStream 构造')
      const c = await run(`return __t.fs.readFileSync(__t.path.join(${JSON.stringify(t.fixture())}, 'evil-link'), 'utf8').length`)
      t.assert.equal(c.ok, false, '插件目录里的符号链接指向外部')
      const d = await run(`return __t.fs.readFileSync(__t.path.join(${JSON.stringify(t.fixture())}, 'plugin.json'), 'utf8').length`)
      t.assert.ok(d.ok && d.v > 10, '插件自己的文件可以读')
    } finally {
      fs.unlinkSync(link)
    }
  })

  await t.test('远程网页窗口拿不到插件 API', async () => {
    const server = http.createServer((_q, res) => res.end('<html><body>remote</body></html>'))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    try {
      const url = `http://127.0.0.1:${server.address().port}/`
      await run(`window.__rw = utools.createBrowserWindow(${JSON.stringify(url)}, { show: false }); return window.__rw.id`)
      await t.sleep(800)
      const r = await run(`return window.__rw.webContents.executeJavaScript('typeof window.utools + "/" + typeof window.whatevertools + "/" + typeof require')`)
      t.assert.ok(r.ok, r.msg)
      t.assert.equal(r.v, 'undefined/undefined/undefined')
    } finally {
      server.close()
    }
  })

  await t.test('不同插件的 localStorage 互相隔离', async () => {
    const dir2 = path.join(t.tmp, 'fixture-2')
    fs.cpSync(t.fixture(), dir2, { recursive: true })
    fs.writeFileSync(path.join(dir2, 'whatevertools.json'), JSON.stringify({ id: 'fixture-two', name: '夹具二', version: '1.0.0' }))
    const p2 = host.loadPlugin(dir2)
    await t.js(wc, `localStorage.setItem('secret', 'from-1')`)
    await host.enter(p2.id, { code: 'main', type: 'text', payload: '夹具插件', from: 'main' })
    const v = await t.js(p2.mainWc, `localStorage.getItem('secret')`)
    t.assert.equal(v, null)
  })

  await t.test('页面的摄像头请求会按插件权限询问', async () => {
    prompts.length = 0
    await run(`return navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'ok', (e) => e.name)`)
    t.assert.ok(prompts.some((p) => p.startsWith('media.camera')), JSON.stringify(prompts))
  })

  await t.test('插件 id 不能是 ..', async () => {
    const dir3 = path.join(t.tmp, 'fixture-3')
    fs.cpSync(t.fixture(), dir3, { recursive: true })
    fs.writeFileSync(path.join(dir3, 'whatevertools.json'), JSON.stringify({ id: '..' }))
    t.assert.throws(() => host.loadPlugin(dir3), /id 不合法/)
  })

  await t.test('ubrowser 不能打开 file:', async () => {
    const r = await run(`return utools.ubrowser.goto('file:///etc/hosts').evaluate(() => document.body.innerText).run({ show: false })`)
    t.assert.equal(r.ok, false)
    t.assert.match(r.msg, /只支持 http/)
  })
}
