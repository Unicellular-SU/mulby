import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  window: {
    hide: () => ipcRenderer.send('window:hide'),
    setSize: (width: number, height: number) =>
      ipcRenderer.send('window:setSize', width, height),
    center: () => ipcRenderer.send('window:center')
  },

  // 剪贴板
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
    writeImage: (buffer: Buffer) => ipcRenderer.invoke('clipboard:writeImage', buffer),
    readFiles: () => ipcRenderer.invoke('clipboard:readFiles'),
    getFormat: () => ipcRenderer.invoke('clipboard:getFormat')
  },

  // 通知
  notification: {
    show: (message: string, type?: string) =>
      ipcRenderer.send('notification:show', message, type)
  },

  // 插件
  plugin: {
    getAll: () => ipcRenderer.invoke('plugin:getAll'),
    search: (query: string) => ipcRenderer.invoke('plugin:search', query),
    run: (name: string) => ipcRenderer.invoke('plugin:run', name)
  }
})
