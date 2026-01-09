import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  hideWindow: () => ipcRenderer.send('window:hide'),
  setWindowSize: (width: number, height: number) =>
    ipcRenderer.send('window:setSize', width, height),

  // 剪贴板
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text)
  },

  // 通知
  notification: {
    show: (message: string, type?: string) =>
      ipcRenderer.send('notification:show', message, type)
  }
})
