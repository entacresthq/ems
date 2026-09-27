// Bridge for the connection settings window only.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('emsDesktop', {
  getConnection: () => ipcRenderer.invoke('connection:get'),
  testConnection: (next) => ipcRenderer.invoke('connection:test', next),
  saveConnection: (next, options) => ipcRenderer.invoke('connection:save', next, options),
})
