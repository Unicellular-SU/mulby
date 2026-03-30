import { contextBridge, ipcRenderer } from 'electron'

// 区域截图专用 preload
contextBridge.exposeInMainWorld('regionCapture', {
    complete: (region: { x: number; y: number; width: number; height: number }) => {
        ipcRenderer.send('region-capture:complete', region)
    },
    cancel: () => {
        ipcRenderer.send('region-capture:cancel')
    },
    // 接收预截取的全屏快照回调（Windows/Linux 专用）
    onSnapshot: (callback: (dataUrl: string) => void) => {
        ipcRenderer.on('region-capture:snapshot', (_event, dataUrl: string) => {
            callback(dataUrl)
        })
    }
})
