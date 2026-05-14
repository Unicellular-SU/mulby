import { systemPreferences } from 'electron'

export interface MediaDeviceInfo {
  deviceId: string
  kind: 'audioinput' | 'audiooutput' | 'videoinput'
  label: string
  groupId: string
}

export type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

type MediaPermissionPlatform = NodeJS.Platform

interface MediaSystemPreferences {
  getMediaAccessStatus: (mediaType: 'microphone' | 'camera') => MediaAccessStatus
  askForMediaAccess: (mediaType: 'microphone' | 'camera') => Promise<boolean>
}

interface PluginMediaDeps {
  platform?: MediaPermissionPlatform
  systemPreferences?: MediaSystemPreferences
}

export class PluginMedia {
  private readonly platform: MediaPermissionPlatform
  private readonly systemPreferences: MediaSystemPreferences

  constructor(deps: PluginMediaDeps = {}) {
    this.platform = deps.platform || process.platform
    this.systemPreferences = deps.systemPreferences || systemPreferences
  }

  /**
   * 获取媒体访问权限状态
   * @param mediaType 媒体类型
   */
  getMediaAccessStatus(mediaType: 'microphone' | 'camera'): MediaAccessStatus {
    if (this.platform === 'darwin' || this.platform === 'win32') {
      try {
        return this.systemPreferences.getMediaAccessStatus(mediaType)
      } catch {
        return this.platform === 'win32' ? 'granted' : 'unknown'
      }
    }
    // Windows/Linux 默认返回 granted（权限在使用时由浏览器处理）
    return 'granted'
  }

  /**
   * 请求媒体访问权限 (仅 macOS)
   * @param mediaType 媒体类型
   */
  async askForMediaAccess(mediaType: 'microphone' | 'camera'): Promise<boolean> {
    if (this.platform === 'darwin') {
      return this.systemPreferences.askForMediaAccess(mediaType)
    }
    // Windows/Linux 返回 true（权限在使用时由浏览器处理）
    return true
  }

  /**
   * 检查是否有摄像头权限
   */
  hasCameraAccess(): boolean {
    return this.getMediaAccessStatus('camera') === 'granted'
  }

  /**
   * 检查是否有麦克风权限
   */
  hasMicrophoneAccess(): boolean {
    return this.getMediaAccessStatus('microphone') === 'granted'
  }
}

export function createPluginMedia(deps: PluginMediaDeps = {}): PluginMedia {
  return new PluginMedia(deps)
}

export const pluginMedia = createPluginMedia()
