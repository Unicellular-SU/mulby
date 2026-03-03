import type { IpcRenderer } from 'electron'

export function createLogApi(ipcRenderer: IpcRenderer) {
  return {
    debug: (message: string, ...args: unknown[]) =>
      ipcRenderer.send('log:write', 'debug', message, args),
    info: (message: string, ...args: unknown[]) =>
      ipcRenderer.send('log:write', 'info', message, args),
    warn: (message: string, ...args: unknown[]) =>
      ipcRenderer.send('log:write', 'warn', message, args),
    error: (message: string, ...args: unknown[]) =>
      ipcRenderer.send('log:write', 'error', message, args),
    getLogs: (options?: { pluginId?: string; level?: string; limit?: number }) =>
      ipcRenderer.invoke('log:getLogs', options),
    clear: (pluginId?: string) =>
      ipcRenderer.invoke('log:clear', pluginId),
    getLogsDir: () =>
      ipcRenderer.invoke('log:getLogsDir'),
    subscribe: () =>
      ipcRenderer.invoke('log:subscribe'),
    onLog: (callback: (entry: { timestamp: number; level: string; pluginId: string; message: string; args?: unknown[] }) => void) => {
      const listener = (_event: unknown, entry: { timestamp: number; level: string; pluginId: string; message: string; args?: unknown[] }) => callback(entry)
      ipcRenderer.on('log:new', listener)
      return () => ipcRenderer.removeListener('log:new', listener)
    }
  }
}
