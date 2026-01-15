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
  }
})
