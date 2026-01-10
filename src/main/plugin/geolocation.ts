import { systemPreferences } from 'electron'

export interface GeolocationPosition {
  latitude: number
  longitude: number
  accuracy: number
  altitude?: number
  altitudeAccuracy?: number
  heading?: number
  speed?: number
  timestamp: number
}

export class PluginGeolocation {
  /**
   * 检查位置权限状态 (macOS)
   */
  getAccessStatus(): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('location' as any) || 'unknown'
    }
    return 'granted'
  }
}

export const pluginGeolocation = new PluginGeolocation()
