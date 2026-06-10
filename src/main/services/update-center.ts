import { app, shell, BrowserWindow, Notification } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import log from 'electron-log'
import type { UpdateSettings } from '../../shared/types/settings'
import { compareVersions } from '../plugin/version'
import {
  downloadMacResourceUpdatePackage,
  fetchMacResourceUpdateManifest,
  installMacResourceUpdatePackage,
  resolveMacResourceManifestUrls,
  shouldUseMacResourceUpdates
} from './mac-resource-update'
import type { MacResourceUpdateManifest } from './mac-resource-update-manifest'

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
  installMode?: 'resource' | 'manual'
  manualInstallReason?: string
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

let macResourceManifest: MacResourceUpdateManifest | null = null
let macResourcePackagePath: string | null = null

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
  if (shouldUseMacResourceUpdates()) {
    patchState({
      latestReleaseApiUrl: resolveMacResourceManifestUrls()[0]
    })
    return
  }

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
      lastCheckedAt: Date.now(),
      installMode: undefined,
      manualInstallReason: undefined
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
      lastCheckedAt: Date.now(),
      installMode: undefined,
      manualInstallReason: undefined
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
      lastCheckedAt: Date.now(),
      installMode: undefined,
      manualInstallReason: undefined
    })
    broadcastUpdateState()
  })
}

// ==================== 对外 API ====================

/** 检查更新（生产环境走 electron-updater，开发环境回退到 GitHub API） */
export async function checkAppUpdates(): Promise<UpdateCenterState> {
  if (shouldUseMacResourceUpdates()) {
    return checkMacResourceUpdates()
  }

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
      lastCheckedAt: Date.now(),
      installMode: undefined,
      manualInstallReason: undefined
    })
  }

  return getUpdateCenterState()
}

async function checkMacResourceUpdates(): Promise<UpdateCenterState> {
  const currentVersion = normalizeVersion(app.getVersion())
  macResourceManifest = null
  macResourcePackagePath = null
  patchState({
    status: 'checking',
    currentVersion,
    hasUpdate: false,
    latestReleaseApiUrl: resolveMacResourceManifestUrls()[0],
    message: '正在检查 macOS 资源更新...',
    downloadProgress: undefined,
    installMode: undefined,
    manualInstallReason: undefined
  })
  broadcastUpdateState()

  try {
    const result = await fetchMacResourceUpdateManifest(currentVersion)
    const latestVersion = normalizeVersion(result.manifest.version)
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    const releasePageUrl = safeString(result.manifest.releasePageUrl) || resolveReleasePageUrl()

    if (!hasUpdate) {
      return patchState({
        status: 'up-to-date',
        currentVersion,
        latestVersion,
        hasUpdate: false,
        releasePageUrl,
        latestReleaseApiUrl: result.manifestUrl,
        releaseName: `Mulby ${latestVersion}`,
        releasePublishedAt: undefined,
        releaseNotes: undefined,
        message: '当前已是最新版本',
        lastCheckedAt: Date.now(),
        installMode: undefined,
        manualInstallReason: undefined,
        downloadProgress: undefined
      })
    }

    macResourceManifest = result.manifest
    const manualReason = result.compatibility.installMode === 'manual'
      ? result.compatibility.manualInstallReason || '此版本需要手动安装完整安装包。'
      : undefined

    return patchState({
      status: 'update-available',
      currentVersion,
      latestVersion,
      hasUpdate: true,
      releasePageUrl,
      latestReleaseApiUrl: result.manifestUrl,
      releaseName: `Mulby ${latestVersion}`,
      releasePublishedAt: undefined,
      releaseNotes: undefined,
      message: manualReason ? `发现新版本 ${latestVersion}，${manualReason}` : `发现新版本 ${latestVersion}`,
      lastCheckedAt: Date.now(),
      installMode: result.compatibility.installMode,
      manualInstallReason: manualReason,
      downloadProgress: undefined
    })
  } catch (error) {
    return patchState({
      status: 'error',
      currentVersion,
      hasUpdate: false,
      latestReleaseApiUrl: resolveMacResourceManifestUrls()[0],
      releasePageUrl: resolveReleasePageUrl(),
      message: error instanceof Error ? error.message : 'macOS 资源更新检查失败',
      lastCheckedAt: Date.now(),
      installMode: undefined,
      manualInstallReason: undefined,
      downloadProgress: undefined
    })
  } finally {
    broadcastUpdateState()
  }
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
      lastCheckedAt: Date.now(),
      installMode: undefined,
      manualInstallReason: undefined
    })
  } catch (error) {
    return patchState({
      status: 'error',
      currentVersion,
      latestReleaseApiUrl,
      releasePageUrl: releasePageUrlFallback,
      hasUpdate: false,
      message: error instanceof Error ? error.message : '更新检查失败',
      lastCheckedAt: Date.now(),
      installMode: undefined,
      manualInstallReason: undefined
    })
  }
}

/** 下载更新 */
export async function downloadUpdate(): Promise<UpdateCenterState> {
  if (shouldUseMacResourceUpdates()) {
    return downloadMacResourceUpdate()
  }

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

async function downloadMacResourceUpdate(): Promise<UpdateCenterState> {
  if (updateCenterState.status !== 'update-available') {
    return getUpdateCenterState()
  }
  if (updateCenterState.installMode === 'manual') {
    return getUpdateCenterState()
  }
  if (!macResourceManifest) {
    return patchState({
      status: 'error',
      message: '资源更新 manifest 缺失，请重新检查更新',
      downloadProgress: undefined
    })
  }

  try {
    patchState({
      status: 'downloading',
      message: '正在下载 macOS 资源更新...',
      downloadProgress: { bytesPerSecond: 0, percent: 0, transferred: 0, total: macResourceManifest.size }
    })
    broadcastUpdateState()

    macResourcePackagePath = await downloadMacResourceUpdatePackage(macResourceManifest, (progress) => {
      patchState({
        status: 'downloading',
        message: `正在下载 macOS 资源更新 ${Math.round(progress.percent)}%`,
        downloadProgress: progress
      })
      broadcastUpdateState()
    })

    patchState({
      status: 'downloaded',
      message: `新版本 ${macResourceManifest.version} 资源更新已下载完成，可以安装`,
      downloadProgress: undefined,
      installMode: 'resource',
      manualInstallReason: undefined
    })
    broadcastUpdateState()
  } catch (error) {
    macResourcePackagePath = null
    patchState({
      status: 'error',
      message: error instanceof Error ? error.message : '下载资源更新失败',
      downloadProgress: undefined
    })
    broadcastUpdateState()
  }

  return getUpdateCenterState()
}

/** 安装更新并重启 */
export function installUpdate(): boolean {
  if (shouldUseMacResourceUpdates()) {
    if (updateCenterState.status !== 'downloaded' || !macResourceManifest || !macResourcePackagePath) {
      return false
    }
    try {
      patchState({
        message: '正在退出并安装 macOS 资源更新...'
      })
      broadcastUpdateState()
      installMacResourceUpdatePackage(macResourceManifest, macResourcePackagePath)
      return true
    } catch (error) {
      patchState({
        status: 'error',
        message: error instanceof Error ? error.message : '安装资源更新失败',
        downloadProgress: undefined
      })
      broadcastUpdateState()
      return false
    }
  }

  if (updateCenterState.status !== 'downloaded') {
    return false
  }
  // quitAndInstall 会退出应用并安装更新
  autoUpdater.quitAndInstall(false, true)
  return true
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

// ==================== 自动检查更新调度器 ====================

export interface AutoUpdateSchedulerOptions {
  /** 读取最新的更新设置（每次调度/检查时实时读取） */
  getSettings: () => UpdateSettings
  /** 用户点击「发现新版本」通知时打开更新中心页面 */
  onOpenUpdateCenter?: () => void
}

/** 启动后首次自动检查的延迟，避免与应用启动抢占资源 */
const AUTO_CHECK_INITIAL_DELAY_MS = 30_000

let schedulerOptions: AutoUpdateSchedulerOptions | null = null
let initialCheckTimer: NodeJS.Timeout | null = null
let periodicCheckTimer: NodeJS.Timeout | null = null
/** 已通知过的版本号，同一版本只弹一次系统通知 */
let lastNotifiedVersion: string | null = null

function clearAutoCheckTimers(): void {
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer)
    initialCheckTimer = null
  }
  if (periodicCheckTimer) {
    clearInterval(periodicCheckTimer)
    periodicCheckTimer = null
  }
}

/**
 * 启动自动更新检查调度器（app ready 后调用一次）
 *
 * 行为：自动检查开启时，启动 30 秒后做首次静默检查，
 * 之后按设置的间隔周期性检查；发现新版本时弹系统通知。
 */
export function startAutoUpdateScheduler(options: AutoUpdateSchedulerOptions): void {
  schedulerOptions = options
  applyAutoUpdateSettings()
}

/** 更新设置变更后重新应用调度（开关 / 间隔变化） */
export function applyAutoUpdateSettings(): void {
  if (!schedulerOptions) return
  clearAutoCheckTimers()

  const settings = schedulerOptions.getSettings()
  if (!settings.autoCheck) {
    log.info('[UpdateCenter] 自动检查更新已关闭')
    return
  }

  const intervalHours = Math.max(1, Math.min(Number(settings.checkIntervalHours) || 6, 168))
  const intervalMs = intervalHours * 3_600_000

  initialCheckTimer = setTimeout(() => {
    initialCheckTimer = null
    void runScheduledUpdateCheck()
  }, AUTO_CHECK_INITIAL_DELAY_MS)

  periodicCheckTimer = setInterval(() => {
    void runScheduledUpdateCheck()
  }, intervalMs)
  // 周期定时器不阻止进程退出
  periodicCheckTimer.unref?.()

  log.info(`[UpdateCenter] 自动检查更新已启用，间隔 ${intervalHours} 小时`)
}

/** 停止自动更新检查调度器 */
export function stopAutoUpdateScheduler(): void {
  clearAutoCheckTimers()
  schedulerOptions = null
}

/** 后台静默检查一次更新，发现新版本时弹系统通知 */
async function runScheduledUpdateCheck(): Promise<void> {
  // 正在检查 / 下载 / 已下载待安装时跳过，避免打断进行中的更新流程
  const busyStatuses: UpdateCheckStatus[] = ['checking', 'downloading', 'downloaded']
  if (busyStatuses.includes(updateCenterState.status)) {
    return
  }

  try {
    const state = await checkAppUpdates()
    if (!state.hasUpdate || !state.latestVersion) return

    const settings = schedulerOptions?.getSettings()
    if (!settings?.notifyOnUpdate) return
    if (lastNotifiedVersion === state.latestVersion) return
    lastNotifiedVersion = state.latestVersion
    notifyUpdateAvailable(state.latestVersion)
  } catch (error) {
    log.warn('[UpdateCenter] 自动检查更新失败:', error)
  }
}

/** 弹出「发现新版本」系统通知，点击后打开更新中心 */
function notifyUpdateAvailable(version: string): void {
  if (!Notification.isSupported()) return
  try {
    const notification = new Notification({
      title: 'Mulby 更新',
      body: `发现新版本 ${version}，点击查看详情`,
      silent: true
    })
    notification.on('click', () => {
      try {
        schedulerOptions?.onOpenUpdateCenter?.()
      } catch (error) {
        log.warn('[UpdateCenter] 打开更新中心失败:', error)
      }
    })
    notification.show()
    log.info(`[UpdateCenter] 已通知用户发现新版本 ${version}`)
  } catch (error) {
    log.warn('[UpdateCenter] 显示更新通知失败:', error)
  }
}
