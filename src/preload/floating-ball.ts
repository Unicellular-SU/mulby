import { contextBridge, ipcRenderer, webUtils } from 'electron'

interface FloatingBallDropFile {
  path: string
  name: string
  size: number
  type: string
  isDirectory: boolean
}

interface FloatingBallRendererState {
  label: string
  size: number
  opacity: number
  shadowPadding: number
  status: string
  theme: 'light' | 'dark'
  iconDataUrl?: string
  message?: string
}

const api = {
  getState: () => ipcRenderer.invoke('floating-ball:getState'),
  click: () => ipcRenderer.send('floating-ball:click'),
  doubleClick: () => ipcRenderer.send('floating-ball:doubleClick'),
  longPress: () => ipcRenderer.send('floating-ball:longPress'),
  contextMenu: () => ipcRenderer.send('floating-ball:contextMenu'),
  dragStart: (point: { screenX: number; screenY: number }) => ipcRenderer.send('floating-ball:dragStart', point),
  dragging: (point: { screenX: number; screenY: number }) => ipcRenderer.send('floating-ball:dragging', point),
  dragEnd: () => ipcRenderer.send('floating-ball:dragEnd'),
  fileDrop: (files: FloatingBallDropFile[]) => ipcRenderer.send('floating-ball:fileDrop', files),
  resolveDroppedFiles: (files: File[]): FloatingBallDropFile[] => files
    .map((file) => {
      let filePath = ''
      try {
        filePath = webUtils.getPathForFile(file)
      } catch {
        filePath = ''
      }
      return {
        path: filePath,
        name: file.name || '',
        size: file.size || 0,
        type: file.type || '',
        isDirectory: false
      }
    })
    .filter((file) => Boolean(file.path)),
  onState: (callback: (state: FloatingBallRendererState) => void) => {
    const listener = (_event: unknown, state: FloatingBallRendererState) => callback(state)
    ipcRenderer.on('floating-ball:state', listener)
    return () => ipcRenderer.removeListener('floating-ball:state', listener)
  },
  onThemeChange: (callback: (theme: 'light' | 'dark') => void) => {
    const listener = (_event: unknown, theme: 'light' | 'dark') => callback(theme)
    ipcRenderer.on('theme:changed', listener)
    return () => ipcRenderer.removeListener('theme:changed', listener)
  }
}

contextBridge.exposeInMainWorld('floatingBall', api)
