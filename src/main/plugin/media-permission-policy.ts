export type MediaPermissionType = 'microphone' | 'camera'

export interface MediaPermissionManifest {
  microphone?: boolean
  camera?: boolean
}

export interface MediaPermissionDetails {
  mediaTypes?: Array<'audio' | 'video'>
  mediaType?: 'audio' | 'video' | 'unknown'
}

export function resolveRequiredMediaPermissions(
  permission: string,
  details?: MediaPermissionDetails
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

  const required: MediaPermissionType[] = []
  if (requested.has('audio')) required.push('microphone')
  if (requested.has('video')) required.push('camera')
  return required
}

export function isMediaPermissionType(type: string): type is MediaPermissionType {
  return type === 'microphone' || type === 'camera'
}

export function getMissingMediaPermissions(
  permissions: MediaPermissionManifest | undefined,
  required: readonly MediaPermissionType[]
): MediaPermissionType[] {
  return required.filter((type) => permissions?.[type] !== true)
}

export function hasDeclaredMediaPermissions(
  permissions: MediaPermissionManifest | undefined,
  required: readonly MediaPermissionType[]
): boolean {
  return getMissingMediaPermissions(permissions, required).length === 0
}
