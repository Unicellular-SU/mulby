import log from 'electron-log'
import { net, BrowserWindow, WebContents } from 'electron'
import { permissionManager, type PermissionStatus } from './permission-manager'
import { GEOLOCATION_NATIVE_TIMEOUT_MS } from '../constants/timing'

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

type NativeProbeSuccess = {
  ok: true
  coords: {
    latitude: number
    longitude: number
    accuracy: number
    altitude: number | null
    altitudeAccuracy: number | null
    heading: number | null
    speed: number | null
    timestamp: number
    secureContext: boolean
  }
}

type NativeProbeFailure = {
  ok: false
  error: {
    code: number | null
    message: string
    secureContext: boolean
    hasGeolocation: boolean
  }
}

type NativeProbeResult = NativeProbeSuccess | NativeProbeFailure

type ProbeError = Error & { code?: number | null }

const GEOLOCATION_ERROR_PERMISSION_DENIED = 1
const GEOLOCATION_ERROR_TIMEOUT = 3

interface IpGeolocationParseResult {
  latitude: unknown
  longitude: unknown
  accuracy: number
}

interface IpGeolocationService {
  name: string
  url: string
  parse: (data: Record<string, unknown>) => IpGeolocationParseResult
}

export class PluginGeolocation {
  private nativeAccessStatus: GeolocationAccessStatus | null = null
  private nativeAccessAttempted = false

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
      if (status === 'not-determined' || status === 'unknown') {
        return 'not-determined'
      }
      if (status === 'denied') {
        // node-mac-permissions 在 location 上存在误报 denied 的问题：
        // 未真实请求过时，先按 not-determined 处理，允许触发一次真实请求。
        return this.nativeAccessAttempted ? 'denied' : 'not-determined'
      }
      return 'unknown'
    }

    return this.normalizePermissionStatus(permissionManager.getStatus('geolocation'))
  }

  /**
   * 请求位置权限
   */
  async requestAccess(webContents?: WebContents): Promise<GeolocationAccessStatus> {
    const currentStatus = this.getAccessStatus()
    log.info(`[Geolocation] Requesting access, current status: ${currentStatus}`)

    if (currentStatus === 'granted') {
      return 'granted'
    }

    if ((currentStatus === 'denied' || currentStatus === 'restricted') && this.nativeAccessAttempted) {
      permissionManager.openSystemSettings('geolocation')
      return currentStatus
    }

    if (process.platform === 'darwin') {
      this.nativeAccessAttempted = true
      try {
        await this.getNativePosition(webContents, 15000)
        this.setNativeAccessStatus('granted')
        return 'granted'
      } catch (error) {
        const status = this.classifyNativeError(error)
        if (status === 'denied' || status === 'restricted') {
          this.setNativeAccessStatus(status)
          permissionManager.openSystemSettings('geolocation')
          return status
        }
        if (status === 'not-determined') {
          this.setNativeAccessStatus(null)
          return status
        }
        this.setNativeAccessStatus(status)
        return status
      }
    }

    const status = await permissionManager.request('geolocation')
    return this.normalizePermissionStatus(status)
  }

  /**
   * 检查是否可以获取位置
   */
  canGetPosition(): boolean {
    const status = this.getAccessStatus()
    return status !== 'denied' && status !== 'restricted'
  }

  /**
   * 打开系统位置设置
   */
  openSettings(): void {
    permissionManager.openSystemSettings('geolocation')
  }

  /**
   * 获取当前位置
   * macOS: 优先使用主进程内 geolocation（无外部 helper）
   * 后备: 使用 IP 地理位置 (约 5km 精度)
   */
  async getCurrentPosition(webContents?: WebContents): Promise<GeolocationPosition> {
    if (process.platform === 'darwin') {
      try {
        const nativePosition = await this.getNativePosition(webContents, GEOLOCATION_NATIVE_TIMEOUT_MS)
        this.setNativeAccessStatus('granted')
        return nativePosition
      } catch (error) {
        const status = this.classifyNativeError(error)
        if (status === 'denied' || status === 'restricted') {
          this.setNativeAccessStatus(status)
        }
        log.warn('[Geolocation] Native position failed, fallback to IP:', error)
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

  private pickWebContents(preferred?: WebContents): WebContents | null {
    if (preferred && !preferred.isDestroyed()) {
      return preferred
    }

    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.isDestroyed()) {
      return focused.webContents
    }

    const fallback = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
    if (fallback) {
      return fallback.webContents
    }

    return null
  }

  private async getNativePosition(preferredWebContents: WebContents | undefined, timeoutMs: number): Promise<GeolocationPosition> {
    const target = this.pickWebContents(preferredWebContents)
    if (!target || target.isDestroyed()) {
      const error: ProbeError = new Error('No available webContents to request geolocation')
      error.code = null
      throw error
    }

    const script = `
      new Promise((resolve) => {
        const secureContext = window.isSecureContext === true
        const hasGeolocation = typeof navigator !== 'undefined' && !!navigator.geolocation

        if (!hasGeolocation) {
          resolve({
            ok: false,
            error: {
              code: null,
              message: 'navigator.geolocation is unavailable',
              secureContext,
              hasGeolocation
            }
          })
          return
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              ok: true,
              coords: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                altitude: position.coords.altitude,
                altitudeAccuracy: position.coords.altitudeAccuracy,
                heading: position.coords.heading,
                speed: position.coords.speed,
                timestamp: position.timestamp,
                secureContext
              }
            })
          },
          (error) => {
            resolve({
              ok: false,
              error: {
                code: typeof error.code === 'number' ? error.code : null,
                message: String(error.message || 'Unknown geolocation error'),
                secureContext,
                hasGeolocation
              }
            })
          },
          {
            enableHighAccuracy: true,
            timeout: ${Math.max(1000, Math.floor(timeoutMs))},
            maximumAge: 0
          }
        )
      })
    `

    let probeResult: NativeProbeResult
    try {
      probeResult = await target.executeJavaScript(script, true) as NativeProbeResult
    } catch (error) {
      const probeError: ProbeError = new Error(
        `Failed to execute geolocation probe: ${error instanceof Error ? error.message : String(error)}`
      )
      probeError.code = null
      throw probeError
    }

    if (probeResult.ok) {
      const coords = probeResult.coords
      const latitude = this.parseCoordinate(coords.latitude)
      const longitude = this.parseCoordinate(coords.longitude)
      const accuracy = this.parseCoordinate(coords.accuracy)

      if (latitude === null || longitude === null || accuracy === null) {
        const parseError: ProbeError = new Error('Native geolocation returned invalid coordinates')
        parseError.code = null
        throw parseError
      }

      log.info(
        `[Geolocation] Native probe success (webContents=${target.id}, secure=${coords.secureContext}, accuracy=${accuracy})`
      )

      return {
        latitude,
        longitude,
        accuracy,
        source: 'native',
        altitude: this.parseCoordinate(coords.altitude) ?? undefined,
        altitudeAccuracy: this.parseCoordinate(coords.altitudeAccuracy) ?? undefined,
        heading: this.parseCoordinate(coords.heading) ?? undefined,
        speed: this.parseCoordinate(coords.speed) ?? undefined,
        timestamp: Number.isFinite(coords.timestamp) ? coords.timestamp : Date.now()
      }
    }

    const probeError: ProbeError = new Error(
      `Native geolocation failed: ${probeResult.error.message}; code=${probeResult.error.code}; secure=${probeResult.error.secureContext}`
    )
    probeError.code = probeResult.error.code

    log.warn(
      `[Geolocation] Native probe failed (webContents=${target.id}, code=${probeResult.error.code}, secure=${probeResult.error.secureContext}, hasGeo=${probeResult.error.hasGeolocation}): ${probeResult.error.message}`
    )

    throw probeError
  }

  private classifyNativeError(error: unknown): GeolocationAccessStatus {
    const code = (error as ProbeError | undefined)?.code
    if (code === GEOLOCATION_ERROR_PERMISSION_DENIED) {
      return 'denied'
    }
    if (code === GEOLOCATION_ERROR_TIMEOUT) {
      return 'not-determined'
    }

    const message = String(error instanceof Error ? error.message : error).toLowerCase()
    if (message.includes('timeout') || message.includes('timed out') || message.includes('expired')) {
      return 'not-determined'
    }
    if (message.includes('restricted')) {
      return 'restricted'
    }
    if (
      message.includes('denied') ||
      message.includes('not authorized') ||
      message.includes('not permitted') ||
      message.includes('permission denied')
    ) {
      return 'denied'
    }
    if (message.includes('not determined')) {
      return 'not-determined'
    }
    return 'unknown'
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

    const services: IpGeolocationService[] = [
      {
        name: 'freegeoip.app',
        url: 'https://freegeoip.app/json/',
        parse: (data: Record<string, unknown>) => ({
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: 5000,
        })
      },
      {
        name: 'ip-api.com',
        url: 'http://ip-api.com/json/?fields=lat,lon,status,message',
        parse: (data: Record<string, unknown>) => ({
          latitude: data.lat,
          longitude: data.lon,
          accuracy: 5000,
        })
      },
      {
        name: 'ipwho.is',
        url: 'https://ipwho.is/',
        parse: (data: Record<string, unknown>) => ({
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

  private fetchLocation(url: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const request = net.request(url)
      let data = ''

      request.on('response', (response) => {
        response.on('data', (chunk) => {
          data += chunk.toString()
        })
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data) as unknown
            if (!parsed || typeof parsed !== 'object') {
              reject(new Error('Invalid location response payload'))
              return
            }
            resolve(parsed as Record<string, unknown>)
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
