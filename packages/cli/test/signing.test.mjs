// 签名环境判断和 electron-builder 配置生成（用假的环境变量，不需要真证书）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { signingStatus, builderConfig, validateConfig, resolveTargets } = { ...require('../dist/signing.js'), ...require('../dist/binary.js'), ...require('../dist/config.js') }

const KEYS = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_KEYCHAIN_PROFILE', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'WT_TARGET']
function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, env)
  try {
    return fn()
  } finally {
    for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-sign-'))
const p8 = path.join(tmp, 'AuthKey.p8')
fs.writeFileSync(p8, 'fake')

test('mac：证书 + API Key 齐全 → 签名并公证', () => {
  withEnv({ CSC_LINK: 'x', CSC_KEY_PASSWORD: 'y', APPLE_API_KEY: p8, APPLE_API_KEY_ID: 'k', APPLE_API_ISSUER: 'i' }, () => {
    const s = signingStatus('mac')
    assert.equal(s.sign, true)
    assert.equal(s.notarize, true)
    assert.deepEqual(s.missing, [])
  })
})

test('mac：证书没有密码、API Key 不是文件 → 报缺失', () => {
  withEnv({ CSC_LINK: 'x', APPLE_API_KEY: '-----BEGIN', APPLE_API_KEY_ID: 'k', APPLE_API_ISSUER: 'i' }, () => {
    const s = signingStatus('mac')
    assert.ok(s.missing.some((m) => m.includes('CSC_KEY_PASSWORD')))
    assert.ok(s.missing.some((m) => m.includes('.p8')))
  })
})

test('mac：要求公证但没有凭据 → 报缺失', () => {
  withEnv({ CSC_LINK: 'x', CSC_KEY_PASSWORD: 'y' }, () => {
    const s = signingStatus('mac', { mac: { notarize: true } })
    assert.ok(s.missing.some((m) => m.includes('公证凭据')))
  })
})

test('mac：identity: false 明确不签名', () => {
  withEnv({ CSC_LINK: 'x', CSC_KEY_PASSWORD: 'y' }, () => {
    const s = signingStatus('mac', { mac: { identity: false } })
    assert.equal(s.sign, false)
    assert.deepEqual(s.missing, [])
  })
})

test('win：pfx / Azure / 不签名', () => {
  withEnv({ WIN_CSC_LINK: 'x', WIN_CSC_KEY_PASSWORD: 'y' }, () => assert.equal(signingStatus('win').method, 'pfx 证书'))
  withEnv({ WIN_CSC_LINK: 'x' }, () => assert.ok(signingStatus('win').missing.some((m) => m.includes('密码'))))
  const azure = { endpoint: 'https://eus.codesigning.azure.net', certificateProfileName: 'p', codeSigningAccountName: 'a' }
  withEnv({ AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' }, () => assert.equal(signingStatus('win', { win: { azure } }).method, 'Azure Trusted Signing'))
  withEnv({ AZURE_TENANT_ID: 't' }, () => assert.ok(signingStatus('win', { win: { mode: 'azure', azure } }).missing.includes('AZURE_CLIENT_SECRET')))
  withEnv({}, () => assert.equal(signingStatus('win').sign, false))
})

test('electron-builder 配置：不签名时 identity 为 null；公证、Azure、产物格式、依赖不重装', () => {
  const app = path.join(tmp, 'app')
  fs.mkdirSync(path.join(app, 'plugin'), { recursive: true })
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'x', productName: 'X', build: { appId: 'app.x' } }))
  fs.writeFileSync(path.join(app, 'plugin', 'plugin.json'), JSON.stringify({ logo: 'logo.png' }))
  const unsigned = builderConfig(app, {}, { mac: { platform: 'mac', sign: false, method: '不签名', notarize: false, missing: [], notes: [] } })
  assert.equal(unsigned.mac.identity, null)
  assert.equal(unsigned.mac.notarize, false)
  assert.equal(unsigned.mac.hardenedRuntime, true)
  assert.ok(fs.existsSync(unsigned.mac.entitlements))
  assert.equal(unsigned.npmRebuild, false)
  assert.deepEqual(unsigned.mac.target.map((t) => t.target), ['dmg', 'zip'])
  const azure = { endpoint: 'e', certificateProfileName: 'p', codeSigningAccountName: 'a' }
  const signed = builderConfig(app, { binary: { formats: { win: ['nsis'] }, arch: ['x64', 'arm64'] }, sign: { win: { azure } } }, {
    mac: { platform: 'mac', sign: true, method: 'CSC_LINK 证书文件', notarize: true, missing: [], notes: [] },
    win: { platform: 'win', sign: true, method: 'Azure Trusted Signing', missing: [], notes: [] },
  })
  assert.equal(signed.mac.identity, undefined)
  assert.equal(signed.mac.notarize, true)
  assert.deepEqual(signed.win.azureSignOptions, azure)
  assert.deepEqual(signed.win.target, [{ target: 'nsis', arch: ['x64', 'arm64'] }])
})

test('配置校验和目标解析', () => {
  assert.throws(() => validateConfig({}), /plugins/)
  assert.throws(() => validateConfig({ plugins: 'dist', targets: ['ios'] }), /ios/)
  assert.throws(() => validateConfig({ plugins: 'dist', electron: { sign: { win: { mode: 'azure' } } } }), /azure/)
  assert.ok(validateConfig({ plugins: ['a', 'b.upx'], targets: ['web'] }))
  withEnv({ WT_TARGET: 'web,electron' }, () => assert.deepEqual(resolveTargets(undefined, { plugins: 'x', targets: ['utools'] }), ['web', 'electron']))
  withEnv({}, () => assert.deepEqual(resolveTargets('utools', { plugins: 'x', targets: ['web'] }), ['utools']))
  assert.throws(() => resolveTargets('nope'), /nope/)
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
