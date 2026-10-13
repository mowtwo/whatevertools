// 测试夹具：把（经过拦截的）模块挂出来，测试用 executeJavaScript 调
window.__t = { fs: require('fs'), electron: require('electron'), path: require('path') }
utools.registerTool('echo', (params) => ({ echoed: params.text, from: 'fixture' }))
utools.onMainPush((action) => [{ text: '推送结果 ' + action.payload }], (action) => action.option.text.includes('进入'))
window.__events = []
utools.onPluginOut((kill) => window.__events.push('out:' + kill))
utools.onPluginDetach(() => window.__events.push('detach'))
utools.onDbPull((docs) => window.__events.push('pull:' + docs.map((d) => d._id).join(',')))
globalThis[Symbol.for('whatevertools.api')].system.onThemeChange((dark) => window.__events.push('theme:' + dark))
utools.registerTool('slow', async (_params, ctx) => {
  await ctx?.sendProgress?.({ progress: 1, total: 2, message: '一半' })
  await ctx?.sendProgress?.({ progress: 2, total: 2, message: '完成' })
  return { done: true }
})
