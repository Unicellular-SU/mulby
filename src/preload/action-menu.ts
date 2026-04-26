import { contextBridge, ipcRenderer } from 'electron'

export interface ActionMenuItem {
  id: string
  label: string
  separator?: boolean
  danger?: boolean
  disabled?: boolean
}

const api = {
  select: (id: string): Promise<boolean> => ipcRenderer.invoke('actionMenu:select', id),
  close: (): Promise<boolean> => ipcRenderer.invoke('actionMenu:close'),
  onShow: (callback: (payload: { items: ActionMenuItem[]; theme: 'light' | 'dark' }) => void) => {
    ipcRenderer.on('actionMenu:show', (_event, payload) => callback(payload))
  }
}

contextBridge.exposeInMainWorld('actionMenu', api)
