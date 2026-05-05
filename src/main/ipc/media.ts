import { ipcMain } from 'electron'
import { pluginMedia } from '../plugin/media'
import { permissionManager } from '../plugin/permission-manager'
import { isMediaPermissionType, type MediaPermissionType } from '../plugin/media-permission-policy'

function hasDeclaredMediaPermission(sender: Electron.WebContents, mediaType: string): mediaType is MediaPermissionType {
  if (!isMediaPermissionType(mediaType)) return false
  return permissionManager.canCallerAccessMediaPermission(sender, mediaType)
}

export function registerMediaHandlers() {
  // 获取媒体访问权限状态
  ipcMain.handle('media:getAccessStatus', (event, mediaType: string) => {
    if (!hasDeclaredMediaPermission(event.sender, mediaType)) return 'denied'
    return pluginMedia.getMediaAccessStatus(mediaType)
  })

  // 请求媒体访问权限
  ipcMain.handle('media:askForAccess', async (event, mediaType: string) => {
    if (!hasDeclaredMediaPermission(event.sender, mediaType)) return false
    return pluginMedia.askForMediaAccess(mediaType)
  })

  // 检查摄像头权限
  ipcMain.handle('media:hasCameraAccess', (event) => {
    if (!hasDeclaredMediaPermission(event.sender, 'camera')) return false
    return pluginMedia.hasCameraAccess()
  })

  // 检查麦克风权限
  ipcMain.handle('media:hasMicrophoneAccess', (event) => {
    if (!hasDeclaredMediaPermission(event.sender, 'microphone')) return false
    return pluginMedia.hasMicrophoneAccess()
  })
}
