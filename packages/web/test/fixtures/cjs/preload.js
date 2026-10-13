// 测试夹具：不经过打包，在浏览器里用 CommonJS 加载器执行
const helper = require('./lib/helper')
const data = require('./data.json')
const somepkg = require('somepkg')
const path = require('node:path')
window.__cjs = {
  helper: helper.greet('web'),
  circular: helper.circular(),
  data: data.answer,
  pkg: somepkg.name + '@' + somepkg.version,
  other: somepkg.other(),
  dirname: __dirname,
  filename: __filename,
  resolved: require.resolve('somepkg'),
  join: path.join('a', 'b'),
  fs: typeof require('fs').readFileSync,
  electron: typeof require('electron').ipcRenderer,
  cached: require('./lib/helper') === helper,
}
