import { app, shell, BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { compareVersions } from '../plugin/version'

const DEFAULT_RELEASE_PAGE_URL = 'https://github.com/Unicellular-SU/mulby-releases/releases'
const DEFAULT_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Unicellular-SU/mulby-releases/releases/latest'

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

// ==================== 状态定义 ====================

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateDownloadProgress {
  /** 已传输字节 */
  bytesPerSecond: number
  /** 百分比 0-100 */
  percent: number
  /** 已下载字节 */
  transferred: number
  /** 总字节数 */
  total: number
}

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
  /** 下载进度（仅 downloading 状态有效） */
  downloadProgress?: UpdateDownloadProgress
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

// ==================== electron-updater 集成 ====================

/** 向所有窗口推送更新状态 */
function broadcastUpdateState(): void {
  const state = getUpdateCenterState()
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('updateCenter:stateChanged', state)
    } catch {
      // 窗口可能已被销毁，忽略
    }
  }
}

/** 初始化 autoUpdater，在 app ready 后调用 */
export function initAutoUpdater(): void {
  // 配置 autoUpdater
  autoUpdater.autoDownload = false // 不自动下载，由用户触发
  autoUpdater.autoInstallOnAppQuit = true // 退出时自动安装已下载的更新
  autoUpdater.allowPrerelease = false

  // 检查更新开始
  autoUpdater.on('checking-for-update', () => {
    patchState({
      status: 'checking',
      message: '正在检查更新...'
    })
    broadcastUpdateState()
  })

  // 发现新版本
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    patchState({
      status: 'update-available',
      hasUpdate: true,
      latestVersion: normalizeVersion(info.version),
      releaseName: info.releaseName || info.version,
      releasePublishedAt: info.releaseDate || undefined,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      message: `发现新版本 ${normalizeVersion(info.version)}`,
      lastCheckedAt: Date.now()
    })
    broadcastUpdateState()
  })

  // 当前已是最新
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    patchState({
      status: 'up-to-date',
      hasUpdate: false,
      latestVersion: normalizeVersion(info.version),
      message: '当前已是最新版本',
      lastCheckedAt: Date.now()
    })
    broadcastUpdateState()
  })

  // 下载进度
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    patchState({
      status: 'downloading',
      message: `正在下载更新 ${Math.round(progress.percent)}%`,
      downloadProgress: {
        bytesPerSecond: progress.bytesPerSecond,
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total
      }
    })
    broadcastUpdateState()
  })

  // 下载完成
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    patchState({
      status: 'downloaded',
      message: `新版本 ${normalizeVersion(info.version)} 已下载完成，可以安装`,
      downloadProgress: undefined
    })
    broadcastUpdateState()
  })

  // 错误处理
  autoUpdater.on('error', (error: Error) => {
    patchState({
      status: 'error',
      message: error.message || '更新检查失败',
      downloadProgress: undefined,
      lastCheckedAt: Date.now()
    })
    broadcastUpdateState()
  })
}

// ==================== 对外 API ====================

/** 检查更新（生产环境走 electron-updater，开发环境回退到 GitHub API） */
export async function checkAppUpdates(): Promise<UpdateCenterState> {
  // 非打包环境下 electron-updater 不可用，回退到手动 API 检查
  if (!app.isPackaged) {
    return checkAppUpdatesFallback()
  }

  const currentVersion = normalizeVersion(app.getVersion())
  patchState({ currentVersion })

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    patchState({
      status: 'error',
      currentVersion,
      hasUpdate: false,
      message: error instanceof Error ? error.message : '更新检查失败',
      lastCheckedAt: Date.now()
    })
  }

  return getUpdateCenterState()
}

/** 手动检查更新（通过 GitHub API，不依赖 electron-updater） */
export async function checkAppUpdatesFallback(): Promise<UpdateCenterState> {
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

/** 下载更新 */
export async function downloadUpdate(): Promise<UpdateCenterState> {
  if (updateCenterState.status !== 'update-available') {
    return getUpdateCenterState()
  }

  try {
    patchState({
      status: 'downloading',
      message: '正在开始下载...',
      downloadProgress: { bytesPerSecond: 0, percent: 0, transferred: 0, total: 0 }
    })
    broadcastUpdateState()
    await autoUpdater.downloadUpdate()
  } catch (error) {
    patchState({
      status: 'error',
      message: error instanceof Error ? error.message : '下载更新失败',
      downloadProgress: undefined
    })
    broadcastUpdateState()
  }

  return getUpdateCenterState()
}

/** 安装更新并重启 */
export function installUpdate(): void {
  if (updateCenterState.status !== 'downloaded') {
    return
  }
  // quitAndInstall 会退出应用并安装更新
  autoUpdater.quitAndInstall(false, true)
}

/** 打开发布页面 */
export async function openAppReleasePage(): Promise<boolean> {
  const releasePageUrl = safeString(updateCenterState.releasePageUrl) || resolveReleasePageUrl()
  if (!isHttpUrl(releasePageUrl)) {
    return false
  }
  await shell.openExternal(releasePageUrl)
  return true
}
