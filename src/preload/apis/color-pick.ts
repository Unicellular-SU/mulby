import { contextBridge, ipcRenderer } from 'electron'

// 屏幕取色专用 preload
contextBridge.exposeInMainWorld('colorPicker', {
  pick: (point: { x: number; y: number }) => {
    ipcRenderer.send('color-pick:pick', point)
  },
  preview: (point: { x: number; y: number }, size: number) => {
    return ipcRenderer.invoke('color-pick:preview', point, size)
  },
  cancel: () => {
    ipcRenderer.send('color-pick:cancel')
  },
  // 接收预截取的全屏快照回调（Windows/Linux 专用）
  onSnapshot: (callback: (dataUrl: string) => void) => {
    ipcRenderer.on('color-pick:snapshot', (_event, dataUrl: string) => {
      callback(dataUrl)
    })
  }
})
