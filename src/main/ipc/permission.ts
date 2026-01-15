import { ipcMain } from 'electron'
import { permissionManager, type PermissionType } from '../plugin/permission-manager'

export function registerPermissionHandlers() {
  ipcMain.handle('permission:getStatus', (_event, type: PermissionType) => {
    return permissionManager.getStatus(type)
  })

  ipcMain.handle('permission:request', (_event, type: PermissionType) => {
    return permissionManager.request(type)
  })

  ipcMain.handle('permission:canRequest', (_event, type: PermissionType) => {
    return permissionManager.canRequest(type)
  })

  ipcMain.handle('permission:openSystemSettings', (_event, type: PermissionType) => {
    return permissionManager.openSystemSettings(type)
  })

  ipcMain.handle('permission:isAccessibilityTrusted', () => {
    return permissionManager.isAccessibilityTrusted()
  })
}
