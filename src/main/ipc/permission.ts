import { ipcMain } from 'electron'
import { permissionManager, type PermissionType } from '../plugin/permission-manager'
import { isMediaPermissionType } from '../plugin/media-permission-policy'

function hasDeclaredMediaPermission(sender: Electron.WebContents, type: PermissionType): boolean {
  if (!isMediaPermissionType(type)) return true
  return permissionManager.canCallerAccessMediaPermission(sender, type)
}

export function registerPermissionHandlers() {
  ipcMain.handle('permission:getStatus', (event, type: PermissionType) => {
    if (!hasDeclaredMediaPermission(event.sender, type)) return 'denied'
    return permissionManager.getStatus(type)
  })

  ipcMain.handle('permission:request', (event, type: PermissionType) => {
    if (!hasDeclaredMediaPermission(event.sender, type)) return 'denied'
    return permissionManager.request(type)
  })

  ipcMain.handle('permission:canRequest', (event, type: PermissionType) => {
    if (!hasDeclaredMediaPermission(event.sender, type)) return false
    return permissionManager.canRequest(type)
  })

  ipcMain.handle('permission:openSystemSettings', (event, type: PermissionType) => {
    if (!hasDeclaredMediaPermission(event.sender, type)) return false
    return permissionManager.openSystemSettings(type)
  })

  ipcMain.handle('permission:isAccessibilityTrusted', () => {
    return permissionManager.isAccessibilityTrusted()
  })
}
