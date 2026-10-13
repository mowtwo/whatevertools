// 外壳界面（搜索框 / 子输入框 / 结果列表）的 preload
const { contextBridge, ipcRenderer, webUtils } = require('electron')
contextBridge.exposeInMainWorld('shell', {
  onState: (fn) => ipcRenderer.on('whatevertools-shell:state', (_e, s) => fn(s)),
  query: (text) => ipcRenderer.invoke('whatevertools-shell:query', text),
  queryInput: (input) => ipcRenderer.invoke('whatevertools-shell:query-input', input),
  choose: (index) => ipcRenderer.send('whatevertools-shell:choose', index),
  input: (text) => ipcRenderer.send('whatevertools-shell:input', text),
  escape: () => ipcRenderer.send('whatevertools-shell:escape'),
  height: (h) => ipcRenderer.send('whatevertools-shell:height', h),
  settings: () => ipcRenderer.send('whatevertools-shell:settings'),
  detach: () => ipcRenderer.send('whatevertools-shell:detach'),
  devtools: () => ipcRenderer.send('whatevertools-shell:devtools'),
  pathForFile: (f) => webUtils.getPathForFile(f),
})
