import { systemPreferences } from 'electron'

export interface MediaDeviceInfo {
  deviceId: string
  kind: 'audioinput' | 'audiooutput' | 'videoinput'
  label: string
  groupId: string
}

export type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export class PluginMedia {
  /**
   * 获取媒体访问权限状态
   * @param mediaType 媒体类型
   */
  getMediaAccessStatus(mediaType: 'microphone' | 'camera'): MediaAccessStatus {
    // macOS 需要检查权限
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus(mediaType)
    }
    // Windows/Linux 默认返回 granted（权限在使用时由浏览器处理）
    return 'granted'
  }

  /**
   * 请求媒体访问权限 (仅 macOS)
   * @param mediaType 媒体类型
   */
  async askForMediaAccess(mediaType: 'microphone' | 'camera'): Promise<boolean> {
    if (process.platform === 'darwin') {
      return systemPreferences.askForMediaAccess(mediaType)
    }
    // Windows/Linux 返回 true（权限在使用时由浏览器处理）
    return true
  }

  /**
   * 检查是否有摄像头权限
   */
  hasCameraAccess(): boolean {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('camera') === 'granted'
    }
    return true
  }

  /**
   * 检查是否有麦克风权限
   */
  hasMicrophoneAccess(): boolean {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('microphone') === 'granted'
    }
    return true
  }
}

export const pluginMedia = new PluginMedia()
