// 验收：快拼图插件在 Electron 兼容层里运行（界面、preload、sharp、MCP 拼图）
const path = require('node:path')
const sweepElectron = require('./sweep-electron')
const fs = require('node:fs')

module.exports = async (t) => {
  const dir = process.env.PLUGIN_DIR || path.resolve(__dirname, '../../../utools-quick-union-image/dist')
  const host = t.host({ prompt: async () => 'always' })
  const plugin = host.loadPlugin(dir)
  await host.enter(plugin.id, { code: 'stitch', type: 'text', payload: '图片拼接', from: 'main' })
  await t.sleep(1500)
  const js = (code) => t.js(plugin.mainWc, code)

  await t.test('界面和 preload 正常', async () => {
    const r = await js('({ preload: window.__quickUnionPreload, text: document.body.innerText.slice(0, 20) })')
    t.assert.equal(r.preload, 'ok')
    t.assert.ok(r.text.length > 0)
  })

  await t.test('MCP 拼图：两张图拼成一张', async () => {
    const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../../packages/electron')] }))
    const a = path.join(t.tmp, 'a.png')
    const b = path.join(t.tmp, 'b.png')
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#e74c3c' } }).png().toFile(a)
    await sharp({ create: { width: 300, height: 500, channels: 3, background: '#3498db' } }).png().toFile(b)
    await host.mcp.start(0)
    const cfg = host.mcp.clientConfig()
    const list = await (await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', ...cfg.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json()
    const name = list.result.tools.find((x) => x.name.endsWith('_stitch_images')).name
    const r = await (await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', ...cfg.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { paths: [a, b], output_dir: t.tmp } } }) })).json()
    t.assert.ok(!r.result.isError, JSON.stringify(r.result))
    const f = r.result.structuredContent.files[0]
    t.assert.equal(f.width, 580)
    t.assert.equal(f.height, 300)
    t.assert.ok(fs.existsSync(f.path))
    host.mcp.stop()
  })

  // 每个页面、弹窗点一遍，零报错（步骤和网页版巡检共用）
  await sweepElectron(t, host, plugin, 'quick-union-image.mjs')
}
