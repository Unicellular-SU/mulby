import log from 'electron-log'
import { net, BrowserWindow, WebContents } from 'electron'
import { permissionManager, type PermissionStatus } from './permission-manager'
import { GEOLOCATION_NATIVE_TIMEOUT_MS } from '../constants/timing'
import { getLinuxGeoCluePosition } from '../services/linux-geoclue-location'
import { getWindowsLocationServicePosition } from '../services/windows-location-service'
import {
  GeolocationResolutionError,
  resolveGeolocationAccessRequest,
  resolveGeolocationPosition,
  selectProvidersForPlatform,
  type GeolocationAccessStatus,
  type GeolocationOptions,
  type GeolocationPosition,
  type GeolocationProvider,
  type GeolocationProviderName
} from './geolocation-orchestrator'

export type {
  GeolocationAccessStatus,
  GeolocationAttempt,
  GeolocationDesiredAccuracy,
  GeolocationOptions,
  GeolocationPosition,
  GeolocationProvider,
  GeolocationProviderName,
  GeolocationSource
} from './geolocation-orchestrator'

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

interface IpGeolocationParseResult {
  latitude: unknown
  longitude: unknown
  accuracy: number
}

interface IpGeolocationService {
  name: GeolocationProviderName
  url: string
  parse: (data: Record<string, unknown>) => IpGeolocationParseResult
}

interface PluginGeolocationDeps {
  providers?: GeolocationProvider[]
}

const GEOLOCATION_ERROR_PERMISSION_DENIED = 1
const GEOLOCATION_ERROR_TIMEOUT = 3

export class PluginGeolocation {
  private nativeAccessStatus: GeolocationAccessStatus | null = null
  private nativeAccessAttempted = false
  private readonly injectedProviders: GeolocationProvider[] | null

  constructor(deps: PluginGeolocationDeps = {}) {
    this.injectedProviders = deps.providers || null
  }

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
        return this.nativeAccessAttempted ? 'denied' : 'not-determined'
      }
      return 'unknown'
    }

    return this.normalizePermissionStatus(permissionManager.getStatus('geolocation'))
  }

  async requestAccess(_webContents?: WebContents): Promise<GeolocationAccessStatus> {
    const currentStatus = this.getAccessStatus()
    log.info(`[Geolocation] Requesting access, current status: ${currentStatus}`)

    if (currentStatus === 'granted') {
      return 'granted'
    }

    if (process.platform === 'darwin') {
      this.nativeAccessAttempted = true
      const outcome = await resolveGeolocationAccessRequest({
        currentStatus,
        requestSystemAccess: async () => this.normalizePermissionStatus(
          await permissionManager.request('geolocation', { openSystemSettingsOnDenied: false })
        )
      })

      this.setNativeAccessStatus(outcome.cacheStatus)
      if (outcome.shouldOpenSettings) {
        permissionManager.openSystemSettings('geolocation')
      }
      return outcome.status
    }

    const status = await permissionManager.request('geolocation')
    return this.normalizePermissionStatus(status)
  }

  canGetPosition(): boolean {
    const status = this.getAccessStatus()
    return status !== 'denied' && status !== 'restricted'
  }

  openSettings(): void {
    permissionManager.openSystemSettings('geolocation')
  }

  async getCurrentPosition(
    webContents?: WebContents,
    options: GeolocationOptions = {}
  ): Promise<GeolocationPosition> {
    const providers = this.injectedProviders || this.createProviders(webContents)
    try {
      const position = await resolveGeolocationPosition(providers, {
        desiredAccuracy: options.desiredAccuracy || 'best',
        allowFallback: options.allowFallback !== false,
        timeoutMs: options.timeoutMs || GEOLOCATION_NATIVE_TIMEOUT_MS
      })
      if (position.source !== 'ip') {
        this.setNativeAccessStatus('granted')
      }
      return position
    } catch (error) {
      const status = this.classifyNativeError(error)
      if (status === 'denied' || status === 'restricted') {
        this.setNativeAccessStatus(status)
      }
      if (error instanceof GeolocationResolutionError) {
        log.warn('[Geolocation] All providers failed:', error.attempts)
      }
      throw error
    }
  }

  private createProviders(webContents?: WebContents): GeolocationProvider[] {
    const providers: GeolocationProvider[] = [
      {
        name: 'macos-corelocation',
        source: 'native',
        isAvailable: () => process.platform === 'darwin',
        locate: async (context) => this.getMacOSCoreLocationPosition(context.timeoutMs)
      },
      {
        name: 'windows-location-service',
        source: 'native',
        isAvailable: () => process.platform === 'win32',
        locate: async (context) => getWindowsLocationServicePosition(context.timeoutMs)
      },
      {
        name: 'linux-geoclue',
        source: 'native',
        isAvailable: () => process.platform === 'linux',
        locate: async (context) => getLinuxGeoCluePosition(context.timeoutMs)
      },
      {
        name: 'electron-web',
        source: 'web',
        isAvailable: () => this.pickWebContents(webContents) !== null,
        locate: async (context) => this.getElectronWebPosition(webContents, context.timeoutMs)
      },
      {
        name: 'ip',
        source: 'ip',
        isAvailable: () => true,
        locate: async () => this.getPositionByIP()
      }
    ]

    return selectProvidersForPlatform(providers)
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

  private async getMacOSCoreLocationPosition(timeoutMs: number): Promise<Omit<GeolocationPosition, 'fallbackUsed' | 'attempts'>> {
    if (process.platform !== 'darwin') {
      throw new Error('CoreLocation is only available on macOS')
    }

    const getLocation = require('electron-get-location') as () => Promise<{
      latitude?: string
      longitude?: string
    }>

    const result = await withTimeout(getLocation(), timeoutMs, 'CoreLocation')
    const latitude = this.parseCoordinate(result.latitude)
    const longitude = this.parseCoordinate(result.longitude)
    if (latitude === null || longitude === null) {
      throw new Error('CoreLocation returned invalid coordinates')
    }

    return {
      latitude,
      longitude,
      accuracy: 100,
      source: 'native',
      provider: 'macos-corelocation',
      timestamp: Date.now()
    }
  }

  private async getElectronWebPosition(
    preferredWebContents: WebContents | undefined,
    timeoutMs: number
  ): Promise<Omit<GeolocationPosition, 'fallbackUsed' | 'attempts'>> {
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
        const parseError: ProbeError = new Error('Electron Web Geolocation returned invalid coordinates')
        parseError.code = null
        throw parseError
      }

      log.info(
        `[Geolocation] Electron Web Geolocation success (webContents=${target.id}, secure=${coords.secureContext}, accuracy=${accuracy})`
      )

      return {
        latitude,
        longitude,
        accuracy,
        source: 'web',
        provider: 'electron-web',
        altitude: this.parseCoordinate(coords.altitude) ?? undefined,
        altitudeAccuracy: this.parseCoordinate(coords.altitudeAccuracy) ?? undefined,
        heading: this.parseCoordinate(coords.heading) ?? undefined,
        speed: this.parseCoordinate(coords.speed) ?? undefined,
        timestamp: Number.isFinite(coords.timestamp) ? coords.timestamp : Date.now()
      }
    }

    const probeError: ProbeError = new Error(
      `Electron Web Geolocation failed: ${probeResult.error.message}; code=${probeResult.error.code}; secure=${probeResult.error.secureContext}`
    )
    probeError.code = probeResult.error.code

    log.warn(
      `[Geolocation] Electron Web Geolocation failed (webContents=${target.id}, code=${probeResult.error.code}, secure=${probeResult.error.secureContext}, hasGeo=${probeResult.error.hasGeolocation}): ${probeResult.error.message}`
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

  private async getPositionByIP(): Promise<Omit<GeolocationPosition, 'fallbackUsed' | 'attempts'>> {
    log.info('[Geolocation] Using IP geolocation fallback...')

    const services: IpGeolocationService[] = [
      {
        name: 'freegeoip.app',
        url: 'https://freegeoip.app/json/',
        parse: (data: Record<string, unknown>) => ({
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: 5000
        })
      },
      {
        name: 'ip-api.com',
        url: 'http://ip-api.com/json/?fields=lat,lon,status,message',
        parse: (data: Record<string, unknown>) => ({
          latitude: data.lat,
          longitude: data.lon,
          accuracy: 5000
        })
      },
      {
        name: 'ipwho.is',
        url: 'https://ipwho.is/',
        parse: (data: Record<string, unknown>) => ({
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: 5000
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
            provider: service.name,
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timeout)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeout)
        reject(error)
      })
  })
}

export const pluginGeolocation = new PluginGeolocation()
