// 端到端测试运行器：electron test/e2e/run.js <测试文件>
// 每个测试文件导出 async (t) => {}；t 提供 host 创建、断言和日志。结果写到 stdout 的 JSON 行。
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
const { app } = require('electron')
process.env.WHATEVERTOOLS_HEADLESS = '1'
// 测试的所有数据（会话分区、缓存）放进临时目录，结束后删除，不留在用户的应用数据目录里
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-e2e-userdata-'))
app.setPath('userData', userData)
app.on('quit', () => fs.rmSync(userData, { recursive: true, force: true }))
// 插件窗口全部关闭时不要退出（默认行为），测试自己决定何时结束
app.on('window-all-closed', () => {})
const file = path.resolve(process.argv.at(-1))
const results = []
const errors = []
process.on('uncaughtException', (e) => errors.push('uncaught ' + (e.stack || e)))
process.on('unhandledRejection', (e) => errors.push('unhandled ' + ((e && e.stack) || e)))
setTimeout(() => {
  console.log(JSON.stringify({ file, results, errors: [...errors, 'timeout'] }))
  app.exit(2)
}, 90000)
app.whenReady().then(async () => {
  const { WhateverToolsHost } = require('../../dist/main')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-e2e-'))
  const t = {
    tmp,
    fixture: (name = 'basic') => path.join(__dirname, '..', 'fixtures', name),
    host: (opts = {}) => new WhateverToolsHost({ dataDir: path.join(tmp, 'data-' + Math.random().toString(36).slice(2)), compat: [{ type: 'utools' }], log: () => {}, prompt: async () => 'block', ...opts }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    js: (wc, code) => wc.executeJavaScript(code),
    async test(name, fn) {
      try {
        await fn()
        results.push({ name, ok: true })
      } catch (e) {
        results.push({ name, ok: false, error: String(e && e.message || e).slice(0, 500) })
      }
    },
    assert,
  }
  try {
    await require(file)(t)
  } catch (e) {
    errors.push('fatal ' + (e.stack || e))
  }
  console.log(JSON.stringify({ file, results, errors }))
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
  app.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1)
})
