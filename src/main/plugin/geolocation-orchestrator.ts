export type GeolocationSource = 'native' | 'web' | 'ip'

export type GeolocationAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export type GeolocationProviderName =
  | 'macos-corelocation'
  | 'windows-location-service'
  | 'linux-geoclue'
  | 'electron-web'
  | 'ip'
  | 'freegeoip.app'
  | 'ip-api.com'
  | 'ipwho.is'

export type GeolocationDesiredAccuracy = 'best' | 'balanced' | 'coarse'

export interface GeolocationOptions {
  desiredAccuracy?: GeolocationDesiredAccuracy
  allowFallback?: boolean
  timeoutMs?: number
}

export interface GeolocationAttempt {
  provider: GeolocationProviderName
  source: GeolocationSource
  status: 'success' | 'skipped' | 'error'
  accuracy?: number
  message?: string
}

export interface GeolocationPosition {
  latitude: number
  longitude: number
  accuracy: number
  source: GeolocationSource
  provider: GeolocationProviderName
  altitude?: number
  altitudeAccuracy?: number
  heading?: number
  speed?: number
  timestamp: number
  fallbackUsed: boolean
  attempts: GeolocationAttempt[]
}

export interface GeolocationProviderContext {
  desiredAccuracy: GeolocationDesiredAccuracy
  timeoutMs: number
}

export interface GeolocationProvider {
  name: GeolocationProviderName
  source: GeolocationSource
  isAvailable: () => boolean | Promise<boolean>
  locate: (context: GeolocationProviderContext) => Promise<Omit<GeolocationPosition, 'fallbackUsed' | 'attempts'>>
}

export interface GeolocationAccessRequestInput {
  currentStatus: GeolocationAccessStatus
  requestSystemAccess: () => Promise<GeolocationAccessStatus>
}

export interface GeolocationAccessRequestOutcome {
  status: GeolocationAccessStatus
  cacheStatus: GeolocationAccessStatus | null
  shouldOpenSettings: boolean
}

export async function resolveGeolocationAccessRequest(
  input: GeolocationAccessRequestInput
): Promise<GeolocationAccessRequestOutcome> {
  if (input.currentStatus === 'granted') {
    return {
      status: 'granted',
      cacheStatus: 'granted',
      shouldOpenSettings: false
    }
  }

  if (input.currentStatus === 'denied' || input.currentStatus === 'restricted') {
    return {
      status: input.currentStatus,
      cacheStatus: input.currentStatus,
      shouldOpenSettings: true
    }
  }

  const requestedStatus = normalizeAccessRequestStatus(await input.requestSystemAccess())
  return {
    status: requestedStatus,
    cacheStatus: requestedStatus === 'not-determined' ? null : requestedStatus,
    shouldOpenSettings: requestedStatus === 'denied' || requestedStatus === 'restricted'
  }
}

export function selectProvidersForPlatform(
  providers: GeolocationProvider[],
  platform: NodeJS.Platform = process.platform
): GeolocationProvider[] {
  const webAndIpProviders = providers.filter((provider) => provider.source === 'web' || provider.source === 'ip')
  const nativeProviderName = getNativeProviderNameForPlatform(platform)

  if (!nativeProviderName) {
    return webAndIpProviders
  }

  const nativeProvider = providers.find((provider) => provider.name === nativeProviderName)
  return nativeProvider ? [nativeProvider, ...webAndIpProviders] : webAndIpProviders
}

export class GeolocationResolutionError extends Error {
  readonly attempts: GeolocationAttempt[]

  constructor(message: string, attempts: GeolocationAttempt[]) {
    super(message)
    this.name = 'GeolocationResolutionError'
    this.attempts = attempts
  }
}

const DEFAULT_GEOLOCATION_TIMEOUT_MS = 10_000

export async function resolveGeolocationPosition(
  providers: GeolocationProvider[],
  options: GeolocationOptions = {}
): Promise<GeolocationPosition> {
  const allowFallback = options.allowFallback !== false
  const desiredAccuracy = options.desiredAccuracy || 'best'
  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs || DEFAULT_GEOLOCATION_TIMEOUT_MS))
  const attempts: GeolocationAttempt[] = []

  for (const currentProvider of providers) {
    if (!allowFallback && currentProvider.source === 'ip') {
      continue
    }

    let available = false
    try {
      available = await currentProvider.isAvailable()
    } catch (error) {
      attempts.push({
        provider: currentProvider.name,
        source: currentProvider.source,
        status: 'error',
        message: getErrorMessage(error)
      })
      continue
    }

    if (!available) {
      attempts.push({
        provider: currentProvider.name,
        source: currentProvider.source,
        status: 'skipped',
        message: 'Provider is not available on this platform'
      })
      continue
    }

    try {
      const position = await currentProvider.locate({ desiredAccuracy, timeoutMs })
      const successAttempt: GeolocationAttempt = {
        provider: position.provider,
        source: currentProvider.source,
        status: 'success',
        accuracy: position.accuracy
      }
      const allAttempts = [...attempts, successAttempt]
      return {
        ...position,
        source: currentProvider.source,
        fallbackUsed: allAttempts.some((attempt) => attempt.status === 'error' || attempt.status === 'skipped'),
        attempts: allAttempts
      }
    } catch (error) {
      attempts.push({
        provider: currentProvider.name,
        source: currentProvider.source,
        status: 'error',
        message: getErrorMessage(error)
      })
    }
  }

  const lastError = [...attempts].reverse().find((attempt) => attempt.status === 'error')
  throw new GeolocationResolutionError(
    lastError?.message || 'No geolocation provider returned a position',
    attempts
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function normalizeAccessRequestStatus(status: GeolocationAccessStatus): GeolocationAccessStatus {
  return status === 'unknown' ? 'not-determined' : status
}

function getNativeProviderNameForPlatform(platform: NodeJS.Platform): GeolocationProviderName | null {
  switch (platform) {
    case 'darwin':
      return 'macos-corelocation'
    case 'win32':
      return 'windows-location-service'
    case 'linux':
      return 'linux-geoclue'
    default:
      return null
  }
}
