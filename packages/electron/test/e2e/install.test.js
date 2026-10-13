// 插件包安装：upx 安装 / 升级 / 卸载、重启后自动加载、安装策略（数量、名单）、upxs 拒绝、临时运行
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { packDirectory } = require('@whatevertools/upx/node')

module.exports = async (t) => {
  // 夹具插件复制一份，改版本号后打成 upx
  const makeUpx = async (version, id = 'fixture-basic') => {
    const dir = path.join(t.tmp, `src-${id}-${version}`)
    fs.cpSync(t.fixture(), dir, { recursive: true })
    const wtFile = path.join(dir, 'whatevertools.json')
    fs.writeFileSync(wtFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(wtFile, 'utf8')), id, version }))
    const file = path.join(t.tmp, `${id}-${version}.upx`)
    fs.writeFileSync(file, await packDirectory(dir))
    return file
  }
  const dataDir = path.join(t.tmp, 'install-data')
  const host = (install) => t.host({ dataDir, install: { confirm: false, ...install } })

  await t.test('安装 upx：解到数据目录并加载，记录在宿主存储', async () => {
    const h = host({ enabled: true })
    const p = await h.installer.install(await makeUpx('1.0.0'))
    t.assert.equal(p.id, 'fixture-basic')
    t.assert.equal(p.manifest.version, '1.0.0')
    t.assert.ok(p.manifest.dir.startsWith(path.join(dataDir, 'installed')))
    t.assert.deepEqual(h.installer.list().map((r) => [r.id, r.version, r.format]), [['fixture-basic', '1.0.0', 'upx']])
    h.store.flushSync()
  })

  await t.test('重启后自动加载已安装的插件', async () => {
    const h = host({ enabled: true })
    const loaded = h.installer.loadAll()
    t.assert.deepEqual(loaded.map((p) => p.id), ['fixture-basic'])
    await h.enter('fixture-basic', { code: 'main', type: 'text', payload: '夹具插件', from: 'main' })
    t.assert.equal(await t.js(h.get('fixture-basic').mainWc, 'typeof utools'), 'object')
  })

  await t.test('同一个 id 再装就是升级', async () => {
    const h = host({ enabled: true })
    h.installer.loadAll()
    const p = await h.installer.install(await makeUpx('1.1.0'))
    t.assert.equal(p.manifest.version, '1.1.0')
    t.assert.equal(h.installer.list().length, 1)
    t.assert.equal(h.installer.list()[0].version, '1.1.0')
  })

  await t.test('安装策略：数量上限、禁止名单、允许名单、关闭安装', async () => {
    const reject = async (install, file) => {
      const h = host(install)
      h.installer.loadAll()
      await t.assert.rejects(h.installer.install(file), (e) => e.code === 'EWTINSTALL' && e.message.length > 0)
    }
    const other = await makeUpx('1.0.0', 'other-plugin')
    await reject({ enabled: true, max: 1 }, other)
    await reject({ enabled: true, deny: ['other-*'] }, other)
    await reject({ enabled: true, allow: ['fixture-*'] }, other)
    await reject({ enabled: false }, other)
  })

  await t.test('plugin:install hook 可以拒绝安装', async () => {
    const h = host({ enabled: true })
    h.hooks.on('plugin:install', { apply: (c) => c.args[0].id !== 'other-plugin' })
    await t.assert.rejects(h.installer.install(await makeUpx('2.0.0', 'other-plugin')), /取消/)
  })

  await t.test('无界面模式下需要确认的安装默认不通过', async () => {
    const h = t.host({ dataDir: path.join(t.tmp, 'confirm-data'), install: { enabled: true } })
    await t.assert.rejects(h.installer.install(await makeUpx('1.0.0', 'needs-confirm')), /取消/)
  })

  await t.test('upxs（uTools 加密包）明确拒绝', async () => {
    const h = host({ enabled: true })
    const file = path.join(t.tmp, 'x.upxs')
    fs.writeFileSync(file, crypto.randomBytes(64 * 1024))
    await t.assert.rejects(h.installer.install(file), (e) => e.code === 'EWTENCRYPTED' && /uTools/.test(e.message))
  })

  await t.test('卸载：删除目录和记录', async () => {
    const h = host({ enabled: true })
    h.installer.loadAll()
    const dir = h.installer.list()[0].dir
    h.installer.uninstall('fixture-basic')
    t.assert.equal(h.installer.list().length, 0)
    t.assert.equal(h.plugins.has('fixture-basic'), false)
    t.assert.equal(fs.existsSync(dir), false)
  })

  await t.test('临时运行一个包：不记录、不进数据目录', async () => {
    const h = host({ enabled: false })
    const p = await h.installer.install(await makeUpx('3.0.0', 'temp-run'), { temporary: true })
    t.assert.equal(p.id, 'temp-run')
    t.assert.equal(h.installer.list().length, 0)
    t.assert.ok(!p.manifest.dir.startsWith(dataDir))
    fs.rmSync(p.manifest.dir, { recursive: true, force: true })
  })
}
