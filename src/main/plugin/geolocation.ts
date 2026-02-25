import log from 'electron-log'
import { net } from 'electron'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { execFile } from 'child_process'
import { permissionManager, type PermissionStatus } from './permission-manager'

const execFileAsync = promisify(execFile)

export interface GeolocationPosition {
  latitude: number
  longitude: number
  accuracy: number
  source: 'native' | 'ip'
  altitude?: number
  altitudeAccuracy?: number
  heading?: number
  speed?: number
  timestamp: number
}

export type GeolocationAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export class PluginGeolocation {
  private nativeBinaryPath: string | null = null
  private nativeAccessStatus: GeolocationAccessStatus | null = null
  private nativeAccessAttempted = false

  constructor() {
    if (process.platform === 'darwin') {
      this.nativeBinaryPath = this.resolveNativeBinaryPath()
    }
  }

  /**
   * 检查位置权限状态
   */
  getAccessStatus(): GeolocationAccessStatus {
    if (process.platform === 'darwin') {
      if (this.nativeAccessStatus) {
        return this.nativeAccessStatus
      }

      const status = permissionManager.getStatus('geolocation')
      if (status === 'granted') {
        this.setNativeAccessStatus('granted')
        return 'granted'
      }
      if (status === 'restricted' || status === 'limited') {
        this.setNativeAccessStatus('restricted')
        return 'restricted'
      }
      if (status === 'not-determined') {
        return 'not-determined'
      }
      if (status === 'denied') {
        // node-mac-permissions 在 location 上存在误报 denied 的问题：
        // 未真实请求过时，先按 not-determined 处理，允许走一次原生请求流程。
        return this.nativeAccessAttempted ? 'denied' : 'not-determined'
      }
      return 'unknown'
    }

    return this.normalizePermissionStatus(permissionManager.getStatus('geolocation'))
  }

  /**
   * 请求位置权限
   */
  async requestAccess(): Promise<GeolocationAccessStatus> {
    const currentStatus = this.getAccessStatus()
    log.info(`[Geolocation] Requesting access, current status: ${currentStatus}`)

    if (currentStatus === 'granted') {
      return 'granted'
    }

    if ((currentStatus === 'denied' || currentStatus === 'restricted') && this.nativeAccessAttempted) {
      permissionManager.openSystemSettings('geolocation')
      return currentStatus
    }

    // macOS: 通过原生 helper 触发真实授权
    if (process.platform === 'darwin' && this.nativeBinaryPath) {
      this.nativeAccessAttempted = true
      try {
        const nativeResult = await this.fetchNativeLocation(15000)
        const coordinates = this.parseCoordinates(nativeResult)
        if (coordinates) {
          this.setNativeAccessStatus('granted')
          return 'granted'
        }
        this.setNativeAccessStatus('unknown')
        return 'unknown'
      } catch (error) {
        const status = this.classifyNativeError(error)
        this.setNativeAccessStatus(status)
        if (status === 'denied' || status === 'restricted') {
          permissionManager.openSystemSettings('geolocation')
        }
        return status
      }
    }

    if (currentStatus === 'denied' || currentStatus === 'restricted') {
      permissionManager.openSystemSettings('geolocation')
      return currentStatus
    }

    // 非 macOS 的后备逻辑
    const status = await permissionManager.request('geolocation')
    return this.normalizePermissionStatus(status)
  }

  /**
   * 检查是否可以获取位置
   */
  canGetPosition(): boolean {
    return this.getAccessStatus() === 'granted'
  }

  /**
   * 打开系统位置设置
   */
  openSettings(): void {
    permissionManager.openSystemSettings('geolocation')
  }

  /**
   * 获取当前位置
   * macOS: 优先使用原生 Core Location API (精确定位)
   * 后备: 使用 IP 地理位置 (约 5km 精度)
   */
  async getCurrentPosition(): Promise<GeolocationPosition> {
    // macOS: 尝试使用原生定位（带超时）
    if (process.platform === 'darwin' && this.nativeBinaryPath) {
      try {
        const nativeResult = await this.fetchNativeLocation(10000)
        const nativeCoordinates = this.parseCoordinates(nativeResult)
        if (nativeCoordinates) {
          this.setNativeAccessStatus('granted')
          return {
            latitude: nativeCoordinates.latitude,
            longitude: nativeCoordinates.longitude,
            accuracy: 10,
            source: 'native',
            timestamp: Date.now()
          }
        }
        log.warn('[Geolocation] Native location output missing coordinates, fallback to IP')
      } catch (error) {
        const status = this.classifyNativeError(error)
        if (status === 'denied' || status === 'restricted') {
          this.setNativeAccessStatus(status)
        }
        log.warn('[Geolocation] Native location failed, fallback to IP:', error)
      }
    }

    return this.getPositionByIP()
  }

  private normalizePermissionStatus(status: PermissionStatus): GeolocationAccessStatus {
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

  private setNativeAccessStatus(status: GeolocationAccessStatus | null): void {
    this.nativeAccessStatus = status

    let permissionStatus: PermissionStatus | null = null
    if (status === 'granted' || status === 'denied' || status === 'not-determined' || status === 'restricted') {
      permissionStatus = status
    }
    permissionManager.setGeolocationStatus(permissionStatus)
  }

  private resolveNativeBinaryPath(): string | null {
    try {
      const moduleEntry = require.resolve('electron-get-location')
      const moduleDir = dirname(moduleEntry)
      const unpackedDir = moduleDir.replace('app.asar', 'app.asar.unpacked')

      const candidates = [
        join(moduleDir, 'main'),
        join(unpackedDir, 'main'),
        join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'electron-get-location', 'main'),
        join(process.cwd(), 'node_modules', 'electron-get-location', 'main')
      ]

      const found = candidates.find((candidate) => existsSync(candidate))
      if (found) {
        log.info(`[Geolocation] Native helper resolved: ${found}`)
        return found
      }

      log.warn('[Geolocation] Native helper not found in candidates:', candidates)
      return null
    } catch (error) {
      log.warn('[Geolocation] Failed to resolve native helper path:', error)
      return null
    }
  }

  private parseNativeOutput(output: string): Record<string, string> {
    const result: Record<string, string> = {}
    const lines = output.split('\n')

    for (const line of lines) {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex <= 0) continue

      const key = line.slice(0, separatorIndex).trim()
      let value = line.slice(separatorIndex + 1).trim()
      if (!key || !value) continue

      if (key === 'timezone') {
        value = value.replace(' (current)', '')
      }

      result[key] = value
    }

    return result
  }

  private async fetchNativeLocation(timeoutMs: number): Promise<Record<string, string>> {
    if (!this.nativeBinaryPath) {
      throw new Error('Native location helper is unavailable')
    }

    const { stdout, stderr } = await execFileAsync(this.nativeBinaryPath, [], {
      timeout: timeoutMs,
      maxBuffer: 256 * 1024
    })

    const stdoutText = String(stdout ?? '').trim()
    const stderrText = String(stderr ?? '').trim()

    if (stderrText.length > 0) {
      throw new Error(stderrText)
    }

    if (!stdoutText) {
      throw new Error('Native location helper returned empty output')
    }

    if (stdoutText.includes('Error:')) {
      const message = stdoutText.split('Error:').pop()?.trim() || stdoutText
      throw new Error(message)
    }

    const parsed = this.parseNativeOutput(stdoutText)
    if (!parsed.latitude || !parsed.longitude) {
      throw new Error(`Native location helper output missing coordinates: ${stdoutText}`)
    }

    return parsed
  }

  private classifyNativeError(error: unknown): GeolocationAccessStatus {
    const message = String(error instanceof Error ? error.message : error).toLowerCase()
    if (message.includes('restricted')) {
      return 'restricted'
    }
    if (
      message.includes('denied') ||
      message.includes('not authorized') ||
      message.includes('not permitted') ||
      message.includes('kclerrordomain') && (message.includes('code=1') || message.includes('error 1'))
    ) {
      return 'denied'
    }
    if (message.includes('not determined')) {
      return 'not-determined'
    }
    return 'unknown'
  }

  private parseCoordinates(rawLocation: unknown): { latitude: number; longitude: number } | null {
    if (typeof rawLocation === 'string') {
      const parts = rawLocation.split(',')
      if (parts.length >= 2) {
        const latitude = this.parseCoordinate(parts[0])
        const longitude = this.parseCoordinate(parts[1])
        if (latitude !== null && longitude !== null) {
          return { latitude, longitude }
        }
      }
      return null
    }

    if (rawLocation && typeof rawLocation === 'object') {
      const location = rawLocation as Record<string, unknown>
      const latitude = this.parseCoordinate(location.latitude ?? location.lat)
      const longitude = this.parseCoordinate(location.longitude ?? location.lon)
      if (latitude !== null && longitude !== null) {
        return { latitude, longitude }
      }
    }

    return null
  }

  private parseCoordinate(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }

    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.trim())
      return Number.isFinite(parsed) ? parsed : null
    }

    return null
  }

  /**
   * 使用 IP 地理位置作为后备
   */
  private async getPositionByIP(): Promise<GeolocationPosition> {
    log.info('[Geolocation] Using IP geolocation fallback...')

    const services = [
      {
        name: 'freegeoip.app',
        url: 'https://freegeoip.app/json/',
        parse: (data: any) => ({
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: 5000,
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
        const latitude = this.parseCoordinate(parsed.latitude)
        const longitude = this.parseCoordinate(parsed.longitude)

        if (latitude !== null && longitude !== null) {
          log.info(`[Geolocation] Got position from ${service.name}:`, parsed)
          return {
            latitude,
            longitude,
            accuracy: parsed.accuracy,
            source: 'ip',
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
          } catch {
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
