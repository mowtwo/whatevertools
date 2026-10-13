// 截图框选 / 取色窗口的 preload（contextIsolation 开启，只暴露结果回传）
const { contextBridge, ipcRenderer } = require('electron')
const channel = new URLSearchParams(location.search).get('channel')
contextBridge.exposeInMainWorld('capture', {
  done: (result) => ipcRenderer.send(channel, result),
})
