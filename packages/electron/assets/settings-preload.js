const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('settings', {
  load: () => ipcRenderer.invoke('whatevertools-settings:load'),
  set: (plugin, permission, decision) => ipcRenderer.invoke('whatevertools-settings:set', plugin, permission, decision),
  hotkey: (plugin, label, accelerator, autocopy) => ipcRenderer.invoke('whatevertools-settings:hotkey', plugin, label, accelerator, autocopy),
  onFocus: (fn) => ipcRenderer.on('whatevertools-settings:focus', (_e, key) => fn(key)),
  reset: (plugin) => ipcRenderer.invoke('whatevertools-settings:reset', plugin),
  plugins: () => ipcRenderer.invoke('whatevertools-settings:plugins'),
  addPlugin: () => ipcRenderer.invoke('whatevertools-settings:plugin-add'),
  removePlugin: (id) => ipcRenderer.invoke('whatevertools-settings:plugin-remove', id),
  copyMcp: () => ipcRenderer.invoke('whatevertools-settings:copy-mcp'),
})
