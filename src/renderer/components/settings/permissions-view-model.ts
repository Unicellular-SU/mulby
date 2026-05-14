import type { PERMISSIONS } from './constants'

export type SettingsPlatform = 'darwin' | 'win32' | 'linux'
export type PermissionConfig = typeof PERMISSIONS[number]
export type PermissionDisplayStatus =
  | 'granted'
  | 'authorized'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'limited'
  | 'runtime-check'
  | 'unknown'

export interface PermissionViewItem extends PermissionConfig {
  rawStatus: string
  displayStatus: PermissionDisplayStatus
  countsAsGranted: boolean | null
}

export interface PermissionOverview {
  text: string
  grantedCount: number
  totalCount: number
  progressMode: 'ratio' | 'managed'
}

interface PermissionViewModelOptions {
  platform: SettingsPlatform
  permissions: readonly PermissionConfig[]
  permissionStatus: Record<string, string>
}

function normalizePermissionStatus(status: string): PermissionDisplayStatus {
  if (
    status === 'granted' ||
    status === 'authorized' ||
    status === 'denied' ||
    status === 'not-determined' ||
    status === 'restricted' ||
    status === 'limited'
  ) {
    return status
  }
  return 'unknown'
}

function getDisplayStatus(
  platform: SettingsPlatform,
  permissionId: PermissionConfig['id'],
  rawStatus: string
): PermissionDisplayStatus {
  if (platform === 'win32' && permissionId === 'geolocation' && rawStatus === 'not-determined') {
    return 'runtime-check'
  }
  return normalizePermissionStatus(rawStatus)
}

function getCountsAsGranted(displayStatus: PermissionDisplayStatus): boolean | null {
  if (displayStatus === 'runtime-check') return null
  return displayStatus === 'granted' || displayStatus === 'authorized'
}

export function getPermissionViewItems({
  platform,
  permissions,
  permissionStatus
}: PermissionViewModelOptions): PermissionViewItem[] {
  return permissions
    .filter((item) => !item.platforms || item.platforms.includes(platform))
    .map((item) => {
      const rawStatus = permissionStatus[item.id] || 'unknown'
      const displayStatus = getDisplayStatus(platform, item.id, rawStatus)
      return {
        ...item,
        rawStatus,
        displayStatus,
        countsAsGranted: getCountsAsGranted(displayStatus)
      }
    })
}

export function getPermissionOverview(options: PermissionViewModelOptions): PermissionOverview {
  const items = getPermissionViewItems(options)

  if (options.platform === 'win32') {
    return {
      text: `${items.length} 项由 Windows 管理`,
      grantedCount: 0,
      totalCount: items.length,
      progressMode: 'managed'
    }
  }

  const countableItems = items.filter((item) => item.countsAsGranted !== null)
  const grantedCount = countableItems.filter((item) => item.countsAsGranted === true).length

  return {
    text: `已授权 ${grantedCount}/${countableItems.length} 项`,
    grantedCount,
    totalCount: countableItems.length,
    progressMode: 'ratio'
  }
}

export function shouldShowPermissionRequestButton({
  platform,
  canRequestProgrammatically,
  displayStatus
}: {
  platform: SettingsPlatform
  canRequestProgrammatically?: boolean
  displayStatus: PermissionDisplayStatus
}): boolean {
  if (platform === 'win32') return false
  return canRequestProgrammatically === true && displayStatus !== 'granted' && displayStatus !== 'authorized'
}
