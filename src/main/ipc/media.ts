import { ipcMain } from 'electron'
import { pluginMedia } from '../plugin/media'

export function registerMediaHandlers() {
  // 获取媒体访问权限状态
  ipcMain.handle('media:getAccessStatus', (_, mediaType: 'microphone' | 'camera') => {
    return pluginMedia.getMediaAccessStatus(mediaType)
  })

  // 请求媒体访问权限
  ipcMain.handle('media:askForAccess', async (_, mediaType: 'microphone' | 'camera') => {
    return pluginMedia.askForMediaAccess(mediaType)
  })

  // 检查摄像头权限
  ipcMain.handle('media:hasCameraAccess', () => {
    return pluginMedia.hasCameraAccess()
  })

  // 检查麦克风权限
  ipcMain.handle('media:hasMicrophoneAccess', () => {
    return pluginMedia.hasMicrophoneAccess()
  })
}
