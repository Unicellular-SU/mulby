import { app, shell } from 'electron'
import { compareVersions } from '../plugin/version'

const DEFAULT_RELEASE_PAGE_URL = 'https://github.com/Unicellular-SU/mulby/releases'
const DEFAULT_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Unicellular-SU/mulby/releases/latest'

function normalizeVersion(input: string): string {
  return String(input || '').trim().replace(/^v/i, '')
}

function safeString(input: unknown): string {
  return String(input || '').trim()
}

function resolveReleasePageUrl(): string {
  return safeString(process.env['MULBY_UPDATE_RELEASE_PAGE_URL']) || DEFAULT_RELEASE_PAGE_URL
}

function resolveLatestReleaseApiUrl(): string {
  return safeString(process.env['MULBY_UPDATE_LATEST_API_URL']) || DEFAULT_LATEST_RELEASE_API_URL
}

function isHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export type UpdateCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'

export interface UpdateCenterState {
  status: UpdateCheckStatus
  currentVersion: string
  latestVersion?: string
  hasUpdate: boolean
  releasePageUrl: string
  latestReleaseApiUrl: string
  releaseName?: string
  releasePublishedAt?: string
  releaseNotes?: string
  message?: string
  lastCheckedAt?: number
}

const updateCenterState: UpdateCenterState = {
  status: 'idle',
  currentVersion: normalizeVersion(app.getVersion()),
  hasUpdate: false,
  releasePageUrl: resolveReleasePageUrl(),
  latestReleaseApiUrl: resolveLatestReleaseApiUrl()
}

function patchState(patch: Partial<UpdateCenterState>): UpdateCenterState {
  Object.assign(updateCenterState, patch)
  return getUpdateCenterState()
}

export function getUpdateCenterState(): UpdateCenterState {
  return {
    ...updateCenterState
  }
}

export async function checkAppUpdates(): Promise<UpdateCenterState> {
  const currentVersion = normalizeVersion(app.getVersion())
  patchState({
    status: 'checking',
    currentVersion,
    message: '正在检查更新...'
  })

  const latestReleaseApiUrl = resolveLatestReleaseApiUrl()
  const releasePageUrlFallback = resolveReleasePageUrl()
  if (!isHttpUrl(latestReleaseApiUrl)) {
    return patchState({
      status: 'error',
      latestReleaseApiUrl,
      releasePageUrl: releasePageUrlFallback,
      message: '更新源未配置或格式无效，请检查 MULBY_UPDATE_LATEST_API_URL。'
    })
  }

  try {
    const response = await fetch(latestReleaseApiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Mulby/${currentVersion}`
      },
      cache: 'no-store'
    })

    if (!response.ok) {
      throw new Error(`更新检查失败（HTTP ${response.status}）`)
    }

    const payload = await response.json() as Record<string, unknown>
    const tagName = safeString(payload['tag_name'])
    const latestVersion = normalizeVersion(tagName || safeString(payload['name']))
    if (!latestVersion) {
      throw new Error('更新源返回无效版本信息')
    }

    const releasePageUrl = safeString(payload['html_url']) || releasePageUrlFallback
    const releaseName = safeString(payload['name']) || tagName || latestVersion
    const releasePublishedAt = safeString(payload['published_at']) || undefined
    const releaseNotes = safeString(payload['body']) || undefined
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0

    return patchState({
      status: hasUpdate ? 'update-available' : 'up-to-date',
      currentVersion,
      latestVersion,
      hasUpdate,
      releasePageUrl,
      latestReleaseApiUrl,
      releaseName,
      releasePublishedAt,
      releaseNotes,
      message: hasUpdate ? `发现新版本 ${latestVersion}` : '当前已是最新版本',
      lastCheckedAt: Date.now()
    })
  } catch (error) {
    return patchState({
      status: 'error',
      currentVersion,
      latestReleaseApiUrl,
      releasePageUrl: releasePageUrlFallback,
      hasUpdate: false,
      message: error instanceof Error ? error.message : '更新检查失败',
      lastCheckedAt: Date.now()
    })
  }
}

export async function openAppReleasePage(): Promise<boolean> {
  const releasePageUrl = safeString(updateCenterState.releasePageUrl) || resolveReleasePageUrl()
  if (!isHttpUrl(releasePageUrl)) {
    return false
  }
  await shell.openExternal(releasePageUrl)
  return true
}
