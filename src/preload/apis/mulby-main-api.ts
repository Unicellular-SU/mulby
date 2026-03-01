import type { IpcRenderer } from 'electron'

export function createMulbyMainApi(ipcRenderer: IpcRenderer) {
  return {
    subInput: {
      onEnabled: (callback: (data: { placeholder: string; isFocus: boolean }) => void) => {
        const listener = (_: any, data: { placeholder: string; isFocus: boolean }) => callback(data)
        ipcRenderer.on('subInput:enabled', listener)
        return () => ipcRenderer.removeListener('subInput:enabled', listener)
      },
      onDisabled: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('subInput:disabled', listener)
        return () => ipcRenderer.removeListener('subInput:disabled', listener)
      },
      onSetValue: (callback: (text: string) => void) => {
        const listener = (_: any, text: string) => callback(text)
        ipcRenderer.on('subInput:setValue', listener)
        return () => ipcRenderer.removeListener('subInput:setValue', listener)
      },
      onFocus: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('subInput:focus', listener)
        return () => ipcRenderer.removeListener('subInput:focus', listener)
      },
      onBlur: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('subInput:blur', listener)
        return () => ipcRenderer.removeListener('subInput:blur', listener)
      },
      onSelect: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('subInput:select', listener)
        return () => ipcRenderer.removeListener('subInput:select', listener)
      },
      sendChange: (text: string) => {
        ipcRenderer.send('subInput:change', text)
      }
    },
    clipboard: {
      onAutoPaste: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('clipboard:autoPaste', listener)
        return () => ipcRenderer.removeListener('clipboard:autoPaste', listener)
      }
    }
  }
}
