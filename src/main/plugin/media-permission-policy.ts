export type MediaDevicePermissionType = 'microphone' | 'camera'
export type MediaPermissionType = MediaDevicePermissionType | 'screen'
export type PluginManifestPermissionType =
  | MediaPermissionType
  | 'inputMonitor'
  | 'geolocation'
  | 'accessibility'
  | 'contacts'
  | 'notification'
  | 'calendar'
  | 'clipboard'

export interface MediaPermissionManifest {
  microphone?: boolean
  camera?: boolean
  screen?: boolean
  inputMonitor?: boolean
  geolocation?: boolean
  accessibility?: boolean
  contacts?: boolean
  notification?: boolean
  calendar?: boolean
  clipboard?: boolean
}

export interface MediaPermissionDetails {
  mediaTypes?: Array<'audio' | 'video'>
  mediaType?: 'audio' | 'video' | 'unknown'
  [key: string]: unknown
}

export interface MediaPermissionResolutionOptions {
  desktopCapture?: boolean
  desktopAudio?: boolean
}

export type PluginPermissionError = Error & {
  code: 'MISSING_PLUGIN_PERMISSION' | 'SYSTEM_PERMISSION_DENIED'
  permission: PluginManifestPermissionType
}

export function createMissingPluginPermissionError(
  pluginId: string,
  permission: PluginManifestPermissionType
): PluginPermissionError {
  const error = new Error(`Plugin "${pluginId}" lacks manifest.permissions.${permission}`) as PluginPermissionError
  error.code = 'MISSING_PLUGIN_PERMISSION'
  error.permission = permission
  return error
}

export function createSystemPermissionDeniedError(permission: MediaPermissionType): PluginPermissionError {
  const label: Record<MediaPermissionType, string> = {
    screen: 'Screen recording',
    microphone: 'Microphone',
    camera: 'Camera'
  }
  const error = new Error(`${label[permission]} permission denied by system`) as PluginPermissionError
  error.code = 'SYSTEM_PERMISSION_DENIED'
  error.permission = permission
  return error
}

export function resolveRequiredMediaPermissions(
  permission: string,
  details?: MediaPermissionDetails,
  options: MediaPermissionResolutionOptions = {}
): MediaPermissionType[] | null {
  if (permission !== 'media') return null

  const requested = new Set<'audio' | 'video'>()
  const mediaTypes = details?.mediaTypes
  if (Array.isArray(mediaTypes)) {
    for (const mediaType of mediaTypes) {
      if (mediaType === 'audio' || mediaType === 'video') {
        requested.add(mediaType)
      }
    }
  }

  if (details?.mediaType === 'audio' || details?.mediaType === 'video') {
    requested.add(details.mediaType)
  }

  const desktopCapture = options.desktopCapture === true || hasDesktopCaptureConstraint(details)
  if (desktopCapture && requested.size === 0) {
    requested.add('video')
    if (options.desktopAudio === true) {
      requested.add('audio')
    }
  }

  const required: MediaPermissionType[] = []
  if (desktopCapture) {
    required.push('screen')
    return required
  }

  if (requested.has('audio')) required.push('microphone')
  if (requested.has('video')) required.push('camera')
  return required
}

export function isMediaPermissionType(type: string): type is MediaPermissionType {
  return type === 'microphone' || type === 'camera' || type === 'screen'
}

export function isMediaDevicePermissionType(type: string): type is MediaDevicePermissionType {
  return type === 'microphone' || type === 'camera'
}

export function isPluginManifestPermissionType(type: string): type is PluginManifestPermissionType {
  return type === 'microphone' ||
    type === 'camera' ||
    type === 'screen' ||
    type === 'inputMonitor' ||
    type === 'geolocation' ||
    type === 'accessibility' ||
    type === 'contacts' ||
    type === 'notification' ||
    type === 'calendar' ||
    type === 'clipboard'
}

export function getMissingPluginPermissions(
  permissions: MediaPermissionManifest | undefined,
  required: readonly PluginManifestPermissionType[]
): PluginManifestPermissionType[] {
  return required.filter((type) => permissions?.[type] !== true)
}

export function getMissingMediaPermissions(
  permissions: MediaPermissionManifest | undefined,
  required: readonly MediaPermissionType[]
): MediaPermissionType[] {
  return getMissingPluginPermissions(permissions, required) as MediaPermissionType[]
}

export function hasDeclaredMediaPermissions(
  permissions: MediaPermissionManifest | undefined,
  required: readonly MediaPermissionType[]
): boolean {
  return getMissingMediaPermissions(permissions, required).length === 0
}

function hasDesktopCaptureConstraint(value: unknown, depth = 0): boolean {
  if (!value || depth > 6) return false
  if (Array.isArray(value)) {
    return value.some((item) => hasDesktopCaptureConstraint(item, depth + 1))
  }
  if (typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  if (record.chromeMediaSource === 'desktop') return true

  for (const child of Object.values(record)) {
    if (hasDesktopCaptureConstraint(child, depth + 1)) return true
  }
  return false
}
