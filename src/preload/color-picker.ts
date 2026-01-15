import { contextBridge, ipcRenderer } from 'electron'

export interface ColorPickResult {
    hex: string
    rgb: string
    r: number
    g: number
    b: number
}

// 颜色取色器专用 preload
contextBridge.exposeInMainWorld('colorPicker', {
    complete: (color: ColorPickResult) => {
        ipcRenderer.send('color-picker:complete', color)
    },
    cancel: () => {
        ipcRenderer.send('color-picker:cancel')
    },
    // 接收截图数据
    onScreenshot: (callback: (dataUrl: string) => void) => {
        ipcRenderer.on('color-picker:screenshot', (_event, dataUrl: string) => {
            callback(dataUrl)
        })
    },
    // 通知主进程窗口已准备好
    ready: () => {
        ipcRenderer.send('color-picker:ready')
    }
})
