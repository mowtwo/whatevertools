// 在 Electron 宿主里跑巡检步骤（和网页版共用 scripts/sweeps/*.mjs）：插件页面的控制台错误通过 log:plugin hook 收集
const path = require('node:path')
const { pathToFileURL } = require('node:url')

module.exports = async function sweepElectron(t, host, plugin, stepsFile) {
  const steps = (await import(pathToFileURL(path.resolve(__dirname, '../sweeps', stepsFile)).href)).default
  let errors = []
  host.hooks.on('log:plugin', { apply: (c, next) => (c.args[0].plugin === plugin.id && errors.push(c.args[0].message), next()) })
  const js = (code) => t.js(plugin.mainWc, code)
  for (let i = 0; i < 80; i++) {
    if (await js(`!!(${steps.ready ?? 'true'})`).catch(() => false)) break
    await t.sleep(250)
  }
  for (const s of steps) {
    await t.test(`逐页：${s.name}`, async () => {
      errors = []
      await js(`(async () => { ${s.run} })()`)
      await t.sleep(s.wait ?? 1000)
      if (s.expect) t.assert.equal(await js(`(async () => (${s.expect}))()`), true, `检查没通过：${s.expect}`)
      t.assert.deepEqual(errors, [], '页面报错')
    })
  }
}
