import type { PERMISSIONS } from './constants'

type PermissionConfig = typeof PERMISSIONS[number]
type MediaPermissionId = 'microphone' | 'camera'

interface PermissionStatusApi {
  permission: {
    getStatus: (id: PermissionConfig['id']) => Promise<string>
  }
  media?: {
    getAccessStatus?: (id: MediaPermissionId) => Promise<string>
  }
}

export async function loadPermissionStatuses({
  permissions,
  api
}: {
  permissions: readonly PermissionConfig[]
  api: PermissionStatusApi
}): Promise<Record<string, string>> {
  const next: Record<string, string> = {}

  for (const item of permissions) {
    if ((item.id === 'microphone' || item.id === 'camera') && api.media?.getAccessStatus) {
      next[item.id] = await api.media.getAccessStatus(item.id)
      continue
    }
    next[item.id] = await api.permission.getStatus(item.id)
  }

  return next
}
