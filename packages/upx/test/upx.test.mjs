import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const upx = require('../dist/index.js')
const node = require('../dist/node.js')

const SAMPLE = '/private/tmp/claude-501/-Users-chenwencheng-codebase-ai-app-utools-plugins/7b7c9d61-14e3-4663-8700-4e35e5da78ec/scratchpad/upx-sample/sample.upx'
const UPXS = path.join(os.homedir(), 'Downloads', '快点桌面-1.1.0.upxs')

const enc = (s) => new TextEncoder().encode(s)
const bin = (n, seed = 1) => {
  const b = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i++) b[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24
  return b
}
const pluginFiles = () =>
  new Map([
    ['plugin.json', enc(JSON.stringify({ main: 'index.html', preload: 'preload.js', features: [{ code: 'a', cmds: ['a'] }] }))],
    ['index.html', enc('<html>你好</html>')],
    ['preload.js', enc('window.x = 1')],
    ['assets/img/logo.png', bin(4099)],
    ['assets/empty.txt', new Uint8Array(0)],
  ])
const sameFiles = (a, b) => {
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort())
  for (const [k, v] of a) assert.deepEqual(Buffer.from(b.get(k)), Buffer.from(v), k)
}
// 手工拼一个 asar（用于构造非法头）
const rawAsar = (header, data = new Uint8Array(0)) => {
  const json = Buffer.from(JSON.stringify(header))
  const padded = (json.length + 3) & ~3
  const out = Buffer.alloc(16 + padded + data.length)
  out.writeUInt32LE(4, 0)
  out.writeUInt32LE(8 + padded, 4)
  out.writeUInt32LE(4 + padded, 8)
  out.writeUInt32LE(json.length, 12)
  json.copy(out, 16)
  out.set(data, 16 + padded)
  return new Uint8Array(out)
}
// 最小 zip 写入（deflate）
const makeZip = (files) => {
  const locals = []
  const centrals = []
  let off = 0
  for (const [name, data] of files) {
    const n = Buffer.from(name)
    const c = zlib.deflateRawSync(data)
    const crc = zlib.crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
    locals.push(lh, n, c)
    centrals.push(ch, n)
    off += 30 + n.length + c.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return new Uint8Array(Buffer.concat([...locals, cd, end]))
}

test('writeAsar / readAsar 往返：嵌套目录、二进制、空文件、可执行位', () => {
  const files = pluginFiles()
  const a = upx.readAsar(upx.writeAsar(files, { executable: (p) => p === 'preload.js' }))
  sameFiles(files, a.files())
  assert.equal(a.readText('index.html'), '<html>你好</html>')
  assert.equal(a.read('assets/empty.txt').length, 0)
  assert.ok(a.has('assets/img') && a.has('./assets\\img\\logo.png') && !a.has('nope'))
  const l = a.list().find((e) => e.path === 'preload.js')
  assert.deepEqual(l, { path: 'preload.js', size: 12, executable: true, unpacked: false })
  assert.equal(a.header.files.assets.files.img.files['logo.png'].size, 4099)
  assert.throws(() => a.read('missing.js'), { code: 'ENOENT' })
  assert.throws(() => a.read('assets'), { code: 'EISDIR' })
  // 确定性：输入顺序不同，输出相同
  const rev = new Map([...files].reverse())
  assert.deepEqual(Buffer.from(upx.writeAsar(rev)), Buffer.from(upx.writeAsar(files)))
  // Record 输入
  sameFiles(files, upx.readAsar(upx.writeAsar(Object.fromEntries(files))).files())
})

test('writeAsar：路径冲突与穿越被拒绝', () => {
  assert.throws(() => upx.writeAsar({ a: enc('1'), 'a/b': enc('2') }), { code: 'EINVAL' })
  assert.throws(() => upx.writeAsar({ '../x': enc('1') }), { code: 'EUNSAFEPATH' })
  assert.throws(() => upx.writeAsar({ '/etc/passwd': enc('1') }), { code: 'EUNSAFEPATH' })
  assert.throws(() => upx.writeAsar({ 'C:\\x': enc('1') }), { code: 'EUNSAFEPATH' })
})

test('readAsar：穿越条目、越界、截断、损坏', () => {
  const d = enc('abc')
  assert.throws(() => upx.readAsar(rawAsar({ files: { '..': { files: { x: { size: 3, offset: '0' } } } } }, d)), { code: 'EUNSAFEPATH' })
  assert.throws(() => upx.readAsar(rawAsar({ files: { '../x': { size: 3, offset: '0' } } }, d)), { code: 'EUNSAFEPATH' })
  assert.throws(() => upx.readAsar(rawAsar({ files: { 'a\\..\\..\\x': { size: 3, offset: '0' } } }, d)), { code: 'EUNSAFEPATH' })
  assert.throws(() => upx.readAsar(rawAsar({ files: { x: { size: 4, offset: '0' } } }, d)), { code: 'EBADASAR' })
  assert.throws(() => upx.readAsar(rawAsar({ files: { x: { size: 1, offset: '-1' } } }, d)), { code: 'EBADASAR' })
  const good = upx.writeAsar(pluginFiles())
  assert.throws(() => upx.readAsar(good.subarray(0, good.length - 10)), { code: 'EBADASAR' })
  assert.throws(() => upx.readAsar(good.subarray(0, 40)), { code: 'EBADASAR' })
  assert.throws(() => upx.readAsar(new Uint8Array(8)), { code: 'EBADASAR' })
  const broken = good.slice()
  broken[20] = 0xff // 破坏 JSON
  assert.throws(() => upx.readAsar(broken), { code: 'EBADASAR' })
})

test('readAsar：unpacked 文件只登记不读取，链接可跟随', () => {
  const a = upx.readAsar(rawAsar({ files: { 'a.txt': { size: 3, offset: '0' }, 'b.node': { size: 99, unpacked: true }, l: { link: 'a.txt' } } }, enc('abc')))
  assert.deepEqual([...a.files().keys()], ['a.txt'])
  assert.equal(a.readText('l'), 'abc')
  assert.throws(() => a.read('b.node'), { code: 'ENOENT' })
  assert.deepEqual(a.list().find((e) => e.path === 'l'), { path: 'l', size: 0, executable: false, unpacked: false, link: 'a.txt' })
})

test('gzip / gunzip 与 zlib 互通', async () => {
  const data = bin(100000)
  assert.deepEqual(Buffer.from(await upx.gunzip(zlib.gzipSync(data))), Buffer.from(data))
  assert.deepEqual(zlib.gunzipSync(await upx.gzip(data)), Buffer.from(data))
  await assert.rejects(upx.gunzip(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3])), { code: 'ECORRUPT' })
})

test('detectPackage', async () => {
  const asar = upx.writeAsar(pluginFiles())
  assert.equal(upx.detectPackage(await upx.gzip(asar)), 'upx')
  assert.equal(upx.detectPackage(asar), 'asar')
  assert.equal(upx.detectPackage(makeZip(new Map([['a', enc('x')]]))), 'zip')
  assert.equal(upx.detectPackage(enc('hello world '.repeat(100))), 'unknown')
  assert.equal(upx.detectPackage(new Uint8Array(0)), 'unknown')
  const random = new Uint8Array(crypto.randomBytes(200000))
  assert.equal(upx.detectPackage(random), 'upxs')
  assert.equal(upx.detectPackage(random.subarray(0, 1024), { name: 'x.UPXS' }), 'upxs')
  assert.equal(upx.detectPackage(random.subarray(0, 1024)), 'unknown') // 小样本熵 < 7.9
})

test('createUpx → openPackage', async () => {
  const files = pluginFiles()
  const pkg = await upx.openPackage(await upx.createUpx(files))
  assert.equal(pkg.format, 'upx')
  assert.equal(pkg.manifest.kind, 'utools')
  assert.equal(pkg.manifest.json.main, 'index.html')
  assert.deepEqual(pkg.missing, [])
  sameFiles(files, pkg.files)
  // asar 直接打开
  assert.equal((await upx.openPackage(upx.writeAsar(files))).format, 'asar')
})

test('openPackage：原生清单优先、单顶层目录去前缀、缺清单报错', async () => {
  const nat = await upx.openPackage(upx.writeAsar({ 'whatevertools.json': enc('{"main":"a.html"}'), 'plugin.json': enc('{"main":"b.html"}'), 'a.html': enc('') }))
  assert.equal(nat.manifest.kind, 'native')
  const noMain = await upx.openPackage(upx.writeAsar({ 'whatevertools.json': enc('{}'), 'plugin.json': enc('{"main":"b.html"}') }))
  assert.equal(noMain.manifest.kind, 'utools')
  const nested = await upx.openPackage(upx.writeAsar({ 'my-plugin/plugin.json': enc('{"main":"i.html"}'), 'my-plugin/i.html': enc('x'), 'my-plugin/lib/a.js': enc('y') }))
  assert.deepEqual([...nested.files.keys()].sort(), ['i.html', 'lib/a.js', 'plugin.json'])
  await assert.rejects(upx.openPackage(upx.writeAsar({ 'a/x.txt': enc('1'), 'b/plugin.json': enc('{}') })), { code: 'EMANIFEST' })
  await assert.rejects(upx.openPackage(upx.writeAsar({ 'plugin.json': enc('{oops') })), { code: 'EMANIFEST' })
  await assert.rejects(upx.openPackage(enc('just text, not a package')), { code: 'EUNKNOWNFORMAT' })
  const notAsar = await upx.gzip(enc('not asar'))
  await assert.rejects(upx.openPackage(notAsar), { code: 'EBADUPX' })
})

test('openPackage：upxs 抛 EncryptedPackageError', async () => {
  const random = new Uint8Array(crypto.randomBytes(100000))
  const err = await upx.openPackage(random).catch((e) => e)
  assert.ok(err instanceof upx.EncryptedPackageError)
  assert.equal(err.code, 'EWTENCRYPTED')
  assert.match(err.message, /upxs 是 uTools 加密签名的安装包/)
  await assert.rejects(upx.openPackage(random.subarray(0, 300), { name: 'a.upxs' }), { code: 'EWTENCRYPTED' })
})

test('openPackage：zip 包（deflate）', async () => {
  const pkg = await upx.openPackage(makeZip(new Map([['p/plugin.json', enc('{"main":"i.html"}')], ['p/i.html', bin(5000)], ['__MACOSX/p/._i.html', enc('x')]])))
  assert.equal(pkg.format, 'zip')
  assert.deepEqual([...pkg.files.keys()].sort(), ['i.html', 'plugin.json'])
  assert.deepEqual(Buffer.from(pkg.files.get('i.html')), Buffer.from(bin(5000)))
  await assert.rejects(upx.openPackage(makeZip(new Map([['../evil', enc('x')]]))), { code: 'EUNSAFEPATH' })
})

test('node：packDirectory → extractPackage 往返', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-upx-'))
  try {
    const src = path.join(tmp, 'src')
    for (const [rel, data] of pluginFiles()) {
      fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true })
      fs.writeFileSync(path.join(src, rel), data)
    }
    fs.writeFileSync(path.join(src, 'index.js.map'), '{}')
    fs.writeFileSync(path.join(src, '.DS_Store'), 'x')
    fs.mkdirSync(path.join(src, 'node_modules'))
    fs.writeFileSync(path.join(src, 'node_modules/x.js'), 'x')
    fs.chmodSync(path.join(src, 'preload.js'), 0o755)
    const bytes = await node.packDirectory(src, { exclude: (r) => r.startsWith('node_modules') })
    const a = upx.readAsar(await upx.gunzip(bytes))
    assert.ok(!a.has('index.js.map') && !a.has('.DS_Store') && !a.has('node_modules'))
    if (process.platform !== 'win32') assert.equal(a.list().find((e) => e.path === 'preload.js').executable, true)
    const file = path.join(tmp, 'p.upx')
    fs.writeFileSync(file, bytes)
    const out = path.join(tmp, 'out')
    const r = await node.extractPackage(file, out)
    assert.equal(r.dir, out)
    assert.equal(r.manifest.kind, 'utools')
    for (const [rel, data] of pluginFiles()) assert.deepEqual(fs.readFileSync(path.join(out, rel)), Buffer.from(data))
    await assert.rejects(node.extractPackage(bytes, out), { code: 'EEXIST' })
    await node.extractPackage(bytes, out, { overwrite: true })
    await assert.rejects(node.packDirectory(path.join(out, 'assets')), { code: 'EMANIFEST' })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('真实 sample.upx：读取、写回、再读取内容一致', { skip: !fs.existsSync(SAMPLE) && 'sample.upx 不存在' }, async () => {
  const bytes = await node.readPackageFile(SAMPLE)
  assert.equal(upx.detectPackage(bytes), 'upx')
  const inner = await upx.gunzip(bytes)
  const a = upx.readAsar(inner)
  assert.ok(a.list().some((e) => e.path === 'plugin.json'))
  const manifest = JSON.parse(a.readText('plugin.json'))
  assert.equal(typeof manifest, 'object')
  const pkg = await upx.openPackage(bytes)
  assert.equal(pkg.manifest.kind, 'utools')
  const exec = new Set(a.list().filter((e) => e.executable).map((e) => e.path))
  const rewritten = upx.writeAsar(a.files(), { executable: (p) => exec.has(p) })
  sameFiles(a.files(), upx.readAsar(rewritten).files())
  sameFiles(pkg.files, (await upx.openPackage(await upx.createUpx(pkg.files))).files)
})

test('真实 upxs：识别为加密包', { skip: !fs.existsSync(UPXS) && 'upxs 样本不存在' }, async () => {
  const bytes = await node.readPackageFile(UPXS)
  assert.equal(upx.detectPackage(bytes), 'upxs')
  await assert.rejects(upx.openPackage(bytes), { code: 'EWTENCRYPTED' })
  await assert.rejects(node.extractPackage(UPXS, path.join(os.tmpdir(), 'wt-upxs-never')), { code: 'EWTENCRYPTED' })
})
