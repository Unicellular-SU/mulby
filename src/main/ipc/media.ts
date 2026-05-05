import { ipcMain } from 'electron'
import { pluginMedia } from '../plugin/media'
import { permissionManager } from '../plugin/permission-manager'
import {
  createSystemPermissionDeniedError,
  isMediaDevicePermissionType,
  type MediaDevicePermissionType
} from '../plugin/media-permission-policy'
import log from 'electron-log'

function assertDeclaredMediaPermission(sender: Electron.WebContents, mediaType: string): asserts mediaType is MediaDevicePermissionType {
  if (!isMediaDevicePermissionType(mediaType)) {
    throw new Error(`Unknown media permission: ${mediaType}`)
  }
  permissionManager.ensureCallerAccessMediaPermissions(sender, [mediaType])
}

export function registerMediaHandlers() {
  // 获取媒体访问权限状态
  ipcMain.handle('media:getAccessStatus', (event, mediaType: string) => {
    assertDeclaredMediaPermission(event.sender, mediaType)
    return pluginMedia.getMediaAccessStatus(mediaType)
  })

  // 请求媒体访问权限
  ipcMain.handle('media:askForAccess', async (event, mediaType: string) => {
    assertDeclaredMediaPermission(event.sender, mediaType)
    const granted = await pluginMedia.askForMediaAccess(mediaType)
    if (!granted) {
      log.warn(`[IPC:media] ${createSystemPermissionDeniedError(mediaType).message}`)
    }
    return granted
  })

  // 检查摄像头权限
  ipcMain.handle('media:hasCameraAccess', (event) => {
    assertDeclaredMediaPermission(event.sender, 'camera')
    return pluginMedia.hasCameraAccess()
  })

  // 检查麦克风权限
  ipcMain.handle('media:hasMicrophoneAccess', (event) => {
    assertDeclaredMediaPermission(event.sender, 'microphone')
    return pluginMedia.hasMicrophoneAccess()
  })
}
