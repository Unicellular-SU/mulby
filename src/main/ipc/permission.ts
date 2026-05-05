import { ipcMain } from 'electron'
import { permissionManager, type PermissionType } from '../plugin/permission-manager'
import {
  isPluginManifestPermissionType,
  type PluginManifestPermissionType
} from '../plugin/media-permission-policy'

type PermissionApiType = PermissionType | 'notifications'

function manifestPermissionForPermissionApi(type: PermissionApiType): PluginManifestPermissionType | null {
  if (type === 'notifications') return 'notification'
  if (isPluginManifestPermissionType(type)) return type
  return null
}

function normalizePermissionApiType(type: PermissionApiType): PermissionType | null {
  if (type === 'notifications') return 'notification'
  return type
}

function assertDeclaredPermission(sender: Electron.WebContents, type: PermissionApiType): void {
  const permission = manifestPermissionForPermissionApi(type)
  if (!permission) return
  permissionManager.ensureCallerAccessPluginPermissions(sender, [permission])
}

export function registerPermissionHandlers() {
  ipcMain.handle('permission:getStatus', (event, type: PermissionApiType) => {
    assertDeclaredPermission(event.sender, type)
    const normalized = normalizePermissionApiType(type)
    return normalized ? permissionManager.getStatus(normalized) : 'unknown'
  })

  ipcMain.handle('permission:request', (event, type: PermissionApiType) => {
    assertDeclaredPermission(event.sender, type)
    const normalized = normalizePermissionApiType(type)
    return normalized ? permissionManager.request(normalized) : Promise.resolve('unknown' as const)
  })

  ipcMain.handle('permission:canRequest', (event, type: PermissionApiType) => {
    assertDeclaredPermission(event.sender, type)
    const normalized = normalizePermissionApiType(type)
    return normalized ? permissionManager.canRequest(normalized) : false
  })

  ipcMain.handle('permission:openSystemSettings', (event, type: PermissionApiType) => {
    assertDeclaredPermission(event.sender, type)
    const normalized = normalizePermissionApiType(type)
    return normalized ? permissionManager.openSystemSettings(normalized) : false
  })

  ipcMain.handle('permission:isAccessibilityTrusted', (event) => {
    permissionManager.ensureCallerAccessPluginPermissions(event.sender, ['accessibility'])
    return permissionManager.isAccessibilityTrusted()
  })
}
