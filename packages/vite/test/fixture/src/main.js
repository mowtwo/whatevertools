// 页面脚本：记录进入事件，调 preload 暴露的服务
window.__enters = []
window.utools.onPluginEnter((a) => window.__enters.push(a.code + ':' + a.from))
document.getElementById('app').textContent = 'hello ' + window.services.hello()
