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
    }
})
