import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { SystemPluginWindowManager } from '../services/system-plugin-window-manager'

function isMainWindowCaller(event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null): boolean {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return false
  return event.sender.id === mainWindow.webContents.id
}

export function registerSystemPluginHandlers(
  getMainWindow: () => BrowserWindow | null,
  manager: SystemPluginWindowManager
) {
  ipcMain.handle('systemPlugin:setActive', (event, pluginId?: string | null) => {
    if (!isMainWindowCaller(event, getMainWindow)) return false
    manager.setActiveSystemPlugin(pluginId)
    return true
  })

  ipcMain.handle('systemPlugin:notifyReadyForAttach', (event, requestId: string) => {
    if (!isMainWindowCaller(event, getMainWindow)) return false
    if (typeof requestId !== 'string' || requestId.trim().length === 0) return false
    return manager.notifyReadyForAttach(requestId.trim())
  })

  ipcMain.handle('systemPlugin:getActive', (event) => {
    if (!isMainWindowCaller(event, getMainWindow)) return null
    return manager.getActiveSystemPlugin()
  })
}
