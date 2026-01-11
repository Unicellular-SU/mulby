import log from 'electron-log'
import { net } from 'electron'
import { permissionManager } from './permission-manager'

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

export type GeolocationAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

// 动态加载 electron-get-location（仅 macOS 可用）
let getLocationNative: (() => Promise<string>) | null = null
if (process.platform === 'darwin') {
  try {
    getLocationNative = require('electron-get-location')
    log.info('[Geolocation] Loaded electron-get-location for macOS native location')
  } catch (error) {
    log.warn('[Geolocation] Failed to load electron-get-location:', error)
  }
}

export class PluginGeolocation {
  /**
   * 检查位置权限状态
   */
  getAccessStatus(): GeolocationAccessStatus {
    log.info('[Geolocation] Getting access status...')
    log.info(`[Geolocation] Platform: ${process.platform}`)

    const status = permissionManager.getStatus('geolocation')
    log.info(`[Geolocation] Permission manager status: ${status}`)

    // 标准化返回值
    switch (status) {
      case 'granted':
        return 'granted'
      case 'denied':
        return 'denied'
      case 'not-determined':
        return 'not-determined'
      case 'restricted':
      case 'limited':
        return 'restricted'
      default:
        return 'unknown'
    }
  }

  /**
   * 请求位置权限
   */
  async requestAccess(): Promise<GeolocationAccessStatus> {
    log.info('[Geolocation] Requesting access...')

    const currentStatus = this.getAccessStatus()
    log.info(`[Geolocation] Current status before request: ${currentStatus}`)

    if (currentStatus === 'granted') {
      log.info('[Geolocation] Already granted, no need to request')
      return 'granted'
    }

    if (currentStatus === 'denied' || currentStatus === 'restricted') {
      log.warn(`[Geolocation] Cannot request: status is ${currentStatus}`)
      log.info('[Geolocation] User needs to enable location in system settings')
      // 打开系统设置
      permissionManager.openSystemSettings('geolocation')
      return currentStatus
    }

    // 尝试请求权限
    const result = await permissionManager.request('geolocation')
    log.info(`[Geolocation] Request result: ${result}`)

    return this.getAccessStatus()
  }

  /**
   * 检查是否可以获取位置
   */
  canGetPosition(): boolean {
    const status = this.getAccessStatus()
    const canGet = status === 'granted'
    log.info(`[Geolocation] Can get position: ${canGet} (status: ${status})`)
    return canGet
  }

  /**
   * 打开系统位置设置
   */
  openSettings(): void {
    log.info('[Geolocation] Opening system location settings')
    permissionManager.openSystemSettings('geolocation')
  }

  /**
   * 获取当前位置
   * macOS: 优先使用原生 Core Location API (精确定位)
   * 后备: 使用 IP 地理位置 (约 5km 精度)
   */
  async getCurrentPosition(): Promise<GeolocationPosition> {
    log.info('[Geolocation] Getting current position...')

    // macOS: 尝试使用原生定位（带超时）
    if (process.platform === 'darwin' && getLocationNative) {
      try {
        log.info('[Geolocation] Using native macOS Core Location...')

        // 添加 10 秒超时
        const result = await this.withTimeout(
          getLocationNative(),
          10000,
          'Native location timeout'
        )
        log.info('[Geolocation] Native location result:', result)

        // electron-get-location 返回格式: "latitude,longitude" 或包含更多信息
        const parts = result.split(',').map((s: string) => parseFloat(s.trim()))
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return {
            latitude: parts[0],
            longitude: parts[1],
            accuracy: 10, // 原生定位精度约 10 米
            timestamp: Date.now()
          }
        }
      } catch (error) {
        log.warn('[Geolocation] Native location failed, falling back to IP:', error)
      }
    }

    // 后备：IP 地理位置
    return this.getPositionByIP()
  }

  /**
   * 带超时的 Promise 包装器
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(errorMessage))
      }, timeoutMs)

      promise
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  /**
   * 使用 IP 地理位置作为后备
   */
  private async getPositionByIP(): Promise<GeolocationPosition> {
    log.info('[Geolocation] Using IP geolocation fallback...')

    // 尝试多个 IP 地理位置服务
    const services = [
      {
        name: 'freegeoip.app',
        url: 'https://freegeoip.app/json/',
        parse: (data: any) => ({
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: 5000, // IP 定位精度约 5km
        })
      },
      {
        name: 'ip-api.com',
        url: 'http://ip-api.com/json/?fields=lat,lon,status,message',
        parse: (data: any) => ({
          latitude: data.lat,
          longitude: data.lon,
          accuracy: 5000,
        })
      },
      {
        name: 'ipwho.is',
        url: 'https://ipwho.is/',
        parse: (data: any) => ({
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: 5000,
        })
      }
    ]

    for (const service of services) {
      try {
        log.info(`[Geolocation] Trying ${service.name}...`)
        const result = await this.fetchLocation(service.url)
        const parsed = service.parse(result)

        if (parsed.latitude && parsed.longitude) {
          log.info(`[Geolocation] Got position from ${service.name}:`, parsed)
          return {
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            accuracy: parsed.accuracy,
            timestamp: Date.now()
          }
        }
      } catch (error) {
        log.warn(`[Geolocation] ${service.name} failed:`, error)
      }
    }

    throw new Error('无法获取位置信息，所有定位服务均失败')
  }

  private fetchLocation(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const request = net.request(url)
      let data = ''

      request.on('response', (response) => {
        response.on('data', (chunk) => {
          data += chunk.toString()
        })
        response.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('Failed to parse response'))
          }
        })
      })

      request.on('error', (error) => {
        reject(error)
      })

      request.end()
    })
  }
}

export const pluginGeolocation = new PluginGeolocation()
