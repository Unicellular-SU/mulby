import { contextBridge, ipcRenderer } from 'electron'

// 区域截图专用 preload
contextBridge.exposeInMainWorld('regionCapture', {
    complete: (region: { x: number; y: number; width: number; height: number }) => {
        ipcRenderer.send('region-capture:complete', region)
    },
    cancel: () => {
        ipcRenderer.send('region-capture:cancel')
    }
})
