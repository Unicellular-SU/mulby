import { app, nativeImage, NativeImage, shell } from 'electron'
import * as os from 'os'
import * as crypto from 'crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'fs'
import { lstat, readdir } from 'fs/promises'
import { extname, join } from 'path'
import { execFile, spawnSync } from 'child_process'
import { promisify } from 'util'
import {
  getActiveWindow as resolveActiveWindowFromOs,
  getCachedActiveWindow,
  onActiveWindowChange,
  type ActiveWindowInfo,
} from '../services/active-window'
import { recordCrashBreadcrumb } from '../services/crash-breadcrumbs'

const EXTENSION_ONLY_ICON_REQUEST_RE = /^\.[a-z0-9][a-z0-9.+_-]{0,63}$/i
const DARWIN_SYNTHETIC_ICON_HELPER_TIMEOUT_MS = 2500
const DARWIN_SYNTHETIC_ICON_HELPER_MAX_BUFFER = 1024 * 1024
const execFileAsync = promisify(execFile)

export function isExtensionOnlyIconRequest(filePath: string): boolean {
  const normalized = filePath.trim()
  return EXTENSION_ONLY_ICON_REQUEST_RE.test(normalized) &&
    !normalized.includes('/') &&
    !normalized.includes('\\')
}

export function isSyntheticSystemIconRequest(filePath: string): boolean {
  const normalized = filePath.trim()
  return isExtensionOnlyIconRequest(normalized) || normalized.toLowerCase() === 'folder'
}

export function shouldUseNativeThumbnailForIcon(
  _filePath: string,
  _kind: SystemIconKind,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform !== 'win32'
}

export interface SystemInfo {
  platform: NodeJS.Platform
  arch: string
  hostname: string
  username: string
  homedir: string
  tmpdir: string
  cpus: number
  totalmem: number
  freemem: number
  uptime: number
  osVersion: string
  osRelease: string
}

export interface AppInfo {
  name: string
  version: string
  locale: string
  isPackaged: boolean
  userDataPath: string
}

export interface AppResourceProcessUsage {
  pid: number
  type: string
  name?: string
  cpuPercent: number
  workingSetBytes: number
}

export interface AppResourceDiskUsage {
  userDataPath: string
  userDataBytes: number
  fileCount: number
  directoryCount: number
  truncated: boolean
  scannedAt: number
}

export interface AppResourceUsage {
  sampledAt: number
  cpuPercent: number
  memoryBytes: number
  processCount: number
  disk: AppResourceDiskUsage
  processes: AppResourceProcessUsage[]
}

// 路径类型定义
export type PathName =
  | 'home' | 'appData' | 'userData' | 'temp' | 'exe'
  | 'desktop' | 'documents' | 'downloads' | 'music'
  | 'pictures' | 'videos' | 'logs'

export type SystemIconKind = 'app' | 'file'

export interface SystemIconRequest {
  key: string
  path: string
  kind?: SystemIconKind
  size?: number
}

export interface SystemIconResult {
  key: string
  path: string
  kind: SystemIconKind
  icon: string
}

export interface SystemIconSingleOptions {
  size?: number
  kind?: SystemIconKind
}

export interface SystemIconBatchOptions {
  size?: number
  concurrency?: number
}

export interface SystemIconTraceContext {
  pluginId?: string
  callerSource?: 'app' | 'plugin' | 'untrusted'
  windowId?: number
  webContentsId?: number
  channel?: string
}

export class PluginSystem {
  private _nativeId: string | null = null
  private fileIconCache: Map<string, string> = new Map()
  private appResourceDiskCache: AppResourceDiskUsage | null = null
  private appResourceDiskScan: Promise<AppResourceDiskUsage> | null = null
  private static readonly MAX_FILE_ICON_CACHE = 1500

  private static readonly DEFAULT_ICON_SIZE = 128
  private static readonly MIN_ICON_SIZE = 24
  private static readonly MAX_ICON_SIZE = 256
  private static readonly DEFAULT_BATCH_CONCURRENCY = 6
  private static readonly MAX_BATCH_CONCURRENCY = 12
  private static readonly APP_DISK_CACHE_TTL_MS = 30_000
  private static readonly APP_DISK_SCAN_MAX_ENTRIES = 8_000
  private static readonly APP_DISK_SCAN_MAX_MS = 300

  /**
   * 获取系统信息
   */
  getSystemInfo(): SystemInfo {
    return {
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      username: os.userInfo().username,
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
      cpus: os.cpus().length,
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      uptime: os.uptime(),
      osVersion: os.version(),
      osRelease: os.release()
    }
  }

  /**
   * 获取应用信息
   */
  getAppInfo(): AppInfo {
    return {
      name: app.getName(),
      version: app.getVersion(),
      locale: app.getLocale(),
      isPackaged: app.isPackaged,
      userDataPath: app.getPath('userData')
    }
  }

  /**
   * 获取当前应用自身资源占用。
   * CPU/内存来自 Electron 进程树，硬盘占用只统计用户数据目录，避免扫描整块磁盘。
   */
  async getAppResourceUsage(): Promise<AppResourceUsage> {
    const metrics = app.getAppMetrics()
    const processes = metrics.map((metric) => {
      const workingSetBytes = Math.max(0, metric.memory.workingSetSize || 0) * 1024
      return {
        pid: metric.pid,
        type: metric.type || 'Unknown',
        name: metric.name,
        cpuPercent: this.roundResourceNumber(metric.cpu.percentCPUUsage || 0),
        workingSetBytes
      }
    })

    const cpuPercent = this.roundResourceNumber(
      processes.reduce((total, processUsage) => total + processUsage.cpuPercent, 0)
    )
    const memoryBytes = processes.reduce((total, processUsage) => total + processUsage.workingSetBytes, 0)
    const disk = await this.getAppDiskUsage()

    return {
      sampledAt: Date.now(),
      cpuPercent,
      memoryBytes,
      processCount: processes.length,
      disk,
      processes
    }
  }

  /**
   * 获取特定路径
   * 扩展支持 'exe' 和 'logs' 类型
   */
  getPath(name: PathName): string {
    return app.getPath(name)
  }

  /**
   * 获取环境变量
   */
  getEnv(name: string): string | undefined {
    return process.env[name]
  }

  /**
   * 获取系统空闲时间（秒）
   */
  getIdleTime(): number {
    const { powerMonitor } = require('electron')
    return powerMonitor.getSystemIdleTime()
  }

  private async getAppDiskUsage(): Promise<AppResourceDiskUsage> {
    const now = Date.now()
    if (
      this.appResourceDiskCache &&
      now - this.appResourceDiskCache.scannedAt < PluginSystem.APP_DISK_CACHE_TTL_MS
    ) {
      return this.appResourceDiskCache
    }

    if (this.appResourceDiskScan) {
      return this.appResourceDiskScan
    }

    this.appResourceDiskScan = this.scanDirectoryUsage(app.getPath('userData'))
      .then((usage) => {
        this.appResourceDiskCache = usage
        return usage
      })
      .finally(() => {
        this.appResourceDiskScan = null
      })

    return this.appResourceDiskScan
  }

  private async scanDirectoryUsage(root: string): Promise<AppResourceDiskUsage> {
    const startedAt = Date.now()
    const stack = [root]
    let userDataBytes = 0
    let fileCount = 0
    let directoryCount = 0
    let visitedEntries = 0
    let truncated = false

    while (stack.length > 0) {
      if (
        visitedEntries >= PluginSystem.APP_DISK_SCAN_MAX_ENTRIES ||
        Date.now() - startedAt >= PluginSystem.APP_DISK_SCAN_MAX_MS
      ) {
        truncated = true
        break
      }

      const current = stack.pop()
      if (!current) break

      let stat
      try {
        stat = await lstat(current)
      } catch {
        continue
      }

      visitedEntries += 1

      if (stat.isSymbolicLink()) {
        continue
      }

      if (stat.isDirectory()) {
        directoryCount += 1
        try {
          const children = await readdir(current, { withFileTypes: true })
          for (const child of children) {
            stack.push(join(current, child.name))
          }
        } catch {
          // 忽略无权限或已被删除的目录，资源卡片只用于展示近似占用。
        }
        continue
      }

      if (stat.isFile()) {
        fileCount += 1
        userDataBytes += stat.size
      }
    }

    return {
      userDataPath: root,
      userDataBytes,
      fileCount,
      directoryCount,
      truncated,
      scannedAt: Date.now()
    }
  }

  private roundResourceNumber(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.round(value * 10) / 10
  }

  /**
   * 监听系统活动窗口改变
   */
  onActiveWindowChange(callback: (info: ActiveWindowInfo) => void): () => void {
    return onActiveWindowChange(callback)
  }

  /**
   * 同步读取主进程已缓存的前台窗口（零等待；主应用会常驻订阅以维持缓存）。
   * 可在插件 Worker 后端通过 mulby.system.getCachedActiveWindow() 安全调用（返回值可序列化）。
   */
  getCachedActiveWindow(): ActiveWindowInfo | null {
    return getCachedActiveWindow()
  }

  /**
   * 异步抓取前台窗口（可能触发系统查询）；多数场景用 getCachedActiveWindow 即可。
   */
  async getActiveWindow(): Promise<ActiveWindowInfo | null> {
    return resolveActiveWindowFromOs()
  }

  /**
   * 获取文件/文件夹的系统图标
   * @param filePath 文件路径、扩展名（如 .txt）或 'folder'
   * @returns base64 Data URL 格式的图标
   */
  async getFileIcon(
    filePath: string,
    options: SystemIconSingleOptions = {},
    traceContext?: SystemIconTraceContext
  ): Promise<string> {
    const normalizedPath = filePath.trim()
    if (!normalizedPath) {
      this.recordIconBreadcrumb('system.icon:getFileIcon:empty', traceContext)
      return ''
    }

    const kind = this.resolveIconKind(normalizedPath, options.kind)
    const size = this.normalizeIconSize(options.size)
    this.recordIconBreadcrumb('system.icon:getFileIcon:start', traceContext, {
      path: normalizedPath,
      kind,
      size,
      platform: process.platform
    })
    try {
      const icon = await this.getFileIconInternal(normalizedPath, { kind, size }, traceContext)
      this.recordIconBreadcrumb('system.icon:getFileIcon:done', traceContext, {
        path: normalizedPath,
        kind,
        hasIcon: Boolean(icon),
        length: icon.length
      })
      return icon
    } catch (error) {
      this.recordIconBreadcrumb('system.icon:getFileIcon:error', traceContext, {
        path: normalizedPath,
        kind,
        error
      })
      throw error
    }
  }

  async getFileIcons(
    requests: SystemIconRequest[],
    options: SystemIconBatchOptions = {},
    traceContext?: SystemIconTraceContext
  ): Promise<SystemIconResult[]> {
    if (!Array.isArray(requests) || requests.length === 0) {
      this.recordIconBreadcrumb('system.icon:getFileIcons:empty', traceContext)
      return []
    }

    const defaultSize = this.normalizeIconSize(options.size)
    const concurrency = this.normalizeConcurrency(options.concurrency)
    const results = new Array<SystemIconResult>(requests.length)
    const localInflight = new Map<string, Promise<string>>()

    this.recordIconBreadcrumb('system.icon:getFileIcons:start', traceContext, {
      count: requests.length,
      defaultSize,
      concurrency,
      platform: process.platform
    })

    try {
      await this.runWithConcurrency(requests, concurrency, async (request, index) => {
        const normalizedPath = (request.path || '').trim()
        const kind = this.resolveIconKind(normalizedPath, request.kind)
        const size = this.normalizeIconSize(request.size ?? defaultSize)
        const key = request.key || `${kind}:${normalizedPath}`

        this.recordIconBreadcrumb('system.icon:getFileIcons:item:start', traceContext, {
          index,
          key,
          path: normalizedPath,
          kind,
          size
        })

        if (!normalizedPath) {
          results[index] = { key, path: normalizedPath, kind, icon: '' }
          return
        }

        const cacheKey = this.buildIconCacheKey(normalizedPath, kind, size)
        let pending = localInflight.get(cacheKey)
        if (!pending) {
          pending = this.getFileIconInternal(normalizedPath, { kind, size }, traceContext)
          localInflight.set(cacheKey, pending)
        }

        const icon = await pending
        results[index] = {
          key,
          path: normalizedPath,
          kind,
          icon
        }
        this.recordIconBreadcrumb('system.icon:getFileIcons:item:done', traceContext, {
          index,
          key,
          path: normalizedPath,
          hasIcon: Boolean(icon),
          length: icon.length
        })
      })

      this.recordIconBreadcrumb('system.icon:getFileIcons:done', traceContext, {
        count: requests.length,
        icons: results.filter((result) => Boolean(result?.icon)).length
      })

      return results
    } catch (error) {
      this.recordIconBreadcrumb('system.icon:getFileIcons:error', traceContext, {
        count: requests.length,
        error
      })
      throw error
    }
  }

  clearFileIconCache(): void {
    this.fileIconCache.clear()
  }

  private recordIconBreadcrumb(
    event: string,
    traceContext: SystemIconTraceContext | undefined,
    data: Record<string, unknown> = {}
  ): void {
    recordCrashBreadcrumb(event, {
      pluginId: traceContext?.pluginId,
      callerSource: traceContext?.callerSource,
      windowId: traceContext?.windowId,
      webContentsId: traceContext?.webContentsId,
      channel: traceContext?.channel,
      ...data
    })
  }

  private async getFileIconInternal(
    normalizedPath: string,
    options: { kind: SystemIconKind; size: number },
    traceContext?: SystemIconTraceContext
  ): Promise<string> {
    const cacheKey = this.buildIconCacheKey(normalizedPath, options.kind, options.size)
    const cached = this.fileIconCache.get(cacheKey)
    if (cached) {
      this.recordIconBreadcrumb('system.icon:cache-hit', traceContext, {
        path: normalizedPath,
        kind: options.kind,
        size: options.size
      })
      return cached
    }



    this.recordIconBreadcrumb('system.icon:resolve:start', traceContext, {
      path: normalizedPath,
      kind: options.kind,
      size: options.size
    })
    const resolved = await this.resolveNativeIcon(normalizedPath, options, traceContext)
    this.recordIconBreadcrumb('system.icon:resolve:done', traceContext, {
      path: normalizedPath,
      source: resolved.source,
      error: resolved.error
    })
    if (!this.isUsableNativeIcon(resolved.icon)) {
      this.recordIconBreadcrumb('system.icon:unusable-native-icon', traceContext, {
        path: normalizedPath,
        source: resolved.source
      })
      return ''
    }

    this.recordIconBreadcrumb('system.icon:normalize:before', traceContext, {
      path: normalizedPath,
      source: resolved.source,
      targetSize: options.size
    })
    const normalizedIcon = this.normalizeIcon(resolved.icon, options.size)
    this.recordIconBreadcrumb('system.icon:normalize:after', traceContext, {
      path: normalizedPath,
      source: resolved.source
    })
    if (!this.isUsableNativeIcon(normalizedIcon)) {
      this.recordIconBreadcrumb('system.icon:unusable-normalized-icon', traceContext, {
        path: normalizedPath,
        source: resolved.source
      })
      return ''
    }

    this.recordIconBreadcrumb('system.icon:toDataURL:before', traceContext, {
      path: normalizedPath,
      source: resolved.source
    })
    const dataUrl = normalizedIcon.toDataURL()
    this.recordIconBreadcrumb('system.icon:toDataURL:after', traceContext, {
      path: normalizedPath,
      source: resolved.source,
      length: dataUrl.length
    })

    if (!this.isValidIconDataUrl(dataUrl)) {
      this.recordIconBreadcrumb('system.icon:invalid-data-url', traceContext, {
        path: normalizedPath,
        source: resolved.source,
        length: dataUrl.length
      })
      return ''
    }

    this.setFileIconCache(cacheKey, dataUrl)

    return dataUrl
  }

  private async resolveNativeIcon(
    normalizedPath: string,
    options: { kind: SystemIconKind; size: number },
    traceContext?: SystemIconTraceContext
  ): Promise<{ icon: NativeImage; source: string; error?: string }> {
    this.recordIconBreadcrumb('system.icon.native:start', traceContext, {
      path: normalizedPath,
      kind: options.kind,
      size: options.size,
      platform: process.platform
    })

    const syntheticIcon = await this.resolveDarwinSyntheticIcon(normalizedPath, options.size, traceContext)
    if (syntheticIcon) {
      return syntheticIcon
    }

    const ext = extname(normalizedPath).toLowerCase()
    const isMacAppBundle = process.platform === 'darwin' && ext === '.app'

    if (options.kind === 'app' && isMacAppBundle) {
      this.recordIconBreadcrumb('system.icon.native:macBundle:before', traceContext, {
        path: normalizedPath
      })
      const bundleIcon = this.resolveMacAppBundleIcon(normalizedPath)
      if (this.isUsableNativeIcon(bundleIcon)) {
        this.recordIconBreadcrumb('system.icon.native:macBundle:hit', traceContext, {
          path: normalizedPath
        })
        return { icon: bundleIcon, source: 'bundle' }
      }

    }

    // Windows .lnk 快捷方式：解析目标路径，用目标 .exe 请求图标
    if (process.platform === 'win32' && ext === '.lnk') {
      try {
        const shortcutDetails = shell.readShortcutLink(normalizedPath)
        const targetPath = shortcutDetails.target
        if (targetPath && targetPath !== normalizedPath && existsSync(targetPath)) {
          return this.resolveNativeIcon(targetPath, options, traceContext)
        }
      } catch {
        // readShortcutLink 失败时继续走默认流程
      }
    }

    if (options.kind === 'file' && this.isDirectImagePath(normalizedPath)) {
      this.recordIconBreadcrumb('system.icon.native:createFromPath:before', traceContext, {
        path: normalizedPath
      })
      const directImage = nativeImage.createFromPath(normalizedPath)
      this.recordIconBreadcrumb('system.icon.native:createFromPath:returned', traceContext, {
        path: normalizedPath
      })
      const usable = this.isUsableNativeIcon(directImage)
      this.recordIconBreadcrumb('system.icon.native:createFromPath:after', traceContext, {
        path: normalizedPath,
        usable
      })
      if (usable) {
        return { icon: directImage, source: 'direct-image' }
      }
    }

    if (shouldUseNativeThumbnailForIcon(normalizedPath, options.kind)) {
      const thumbnail = await this.tryCreateThumbnail(normalizedPath, options.size, traceContext)
      if (this.isUsableNativeIcon(thumbnail)) {
        return { icon: thumbnail, source: 'thumbnail' }
      }
    }

    const sizeCandidates: Array<'large' | 'normal' | 'small'> =
      isMacAppBundle ? ['normal', 'small'] : ['large', 'normal', 'small']
    let lastError: string | undefined

    for (const candidate of sizeCandidates) {
      try {
        this.recordIconBreadcrumb('system.icon.native:appGetFileIcon:before', traceContext, {
          path: normalizedPath,
          candidate
        })
        const icon = await app.getFileIcon(normalizedPath, { size: candidate })
        this.recordIconBreadcrumb('system.icon.native:appGetFileIcon:returned', traceContext, {
          path: normalizedPath,
          candidate
        })
        const usable = this.isUsableNativeIcon(icon)
        this.recordIconBreadcrumb('system.icon.native:appGetFileIcon:after', traceContext, {
          path: normalizedPath,
          candidate,
          usable
        })
        if (usable) {
          return { icon, source: `app.getFileIcon:${candidate}` }
        }


      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        this.recordIconBreadcrumb('system.icon.native:appGetFileIcon:error', traceContext, {
          path: normalizedPath,
          candidate,
          error
        })
      }
    }

    return { icon: nativeImage.createEmpty(), source: 'none', error: lastError }
  }

  private async resolveDarwinSyntheticIcon(
    normalizedPath: string,
    size: number,
    traceContext?: SystemIconTraceContext
  ): Promise<{ icon: NativeImage; source: string; error?: string } | null> {
    if (process.platform !== 'darwin' || !isSyntheticSystemIconRequest(normalizedPath)) {
      return null
    }

    this.recordIconBreadcrumb('system.icon.synthetic:start', traceContext, {
      path: normalizedPath,
      size
    })

    if (existsSync(normalizedPath)) {
      this.recordIconBreadcrumb('system.icon.synthetic:real-path-skip', traceContext, {
        path: normalizedPath
      })
      return null
    }

    // Extension-only requests such as ".txt" are not real paths. Passing them
    // into QuickLook/app icon APIs can crash macOS native code, so materialize
    // an app-owned sample path and ask the same system icon API for that path.
    this.recordIconBreadcrumb('system.icon.synthetic:path:before', traceContext, {
      path: normalizedPath
    })
    const syntheticPath = this.resolveDarwinSyntheticIconPath(normalizedPath)
    this.recordIconBreadcrumb('system.icon.synthetic:path:after', traceContext, {
      path: normalizedPath,
      syntheticPath
    })
    if (!syntheticPath) {
      return { icon: nativeImage.createEmpty(), source: 'darwin-synthetic:none' }
    }

    this.recordIconBreadcrumb('system.icon.synthetic:helper:before', traceContext, {
      path: normalizedPath,
      syntheticPath,
      size
    })
    const helperStartedAt = Date.now()
    const helperResult = await this.resolveDarwinSyntheticIconWithHelper(syntheticPath, size)
    this.recordIconBreadcrumb('system.icon.synthetic:helper:after', traceContext, {
      path: normalizedPath,
      syntheticPath,
      hasIcon: this.isUsableNativeIcon(helperResult.icon),
      error: helperResult.error,
      elapsedMs: Date.now() - helperStartedAt
    })

    if (this.isUsableNativeIcon(helperResult.icon)) {
      return {
        icon: helperResult.icon,
        source: 'darwin-synthetic:nsworkspace-helper'
      }
    }

    return {
      icon: nativeImage.createEmpty(),
      source: 'darwin-synthetic:none',
      error: helperResult.error
    }
  }

  private async resolveDarwinSyntheticIconWithHelper(
    filePath: string,
    size: number
  ): Promise<{ icon: NativeImage; error?: string }> {
    const script = `
ObjC.import('AppKit');
ObjC.import('Foundation');
const path = $.NSString.alloc.initWithUTF8String(${JSON.stringify(filePath)});
const image = $.NSWorkspace.sharedWorkspace.iconForFile(path);
image.setSize($.NSMakeSize(${Math.max(1, Math.round(size))}, ${Math.max(1, Math.round(size))}));
const tiff = image.TIFFRepresentation;
const bitmap = $.NSBitmapImageRep.imageRepWithData(tiff);
const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
png.base64EncodedStringWithOptions(0).js;
`

    try {
      const result = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], {
        encoding: 'utf-8',
        timeout: DARWIN_SYNTHETIC_ICON_HELPER_TIMEOUT_MS,
        maxBuffer: DARWIN_SYNTHETIC_ICON_HELPER_MAX_BUFFER
      })

      const base64 = String(result.stdout || '').trim()
      if (!base64) {
        return {
          icon: nativeImage.createEmpty(),
          error: 'osascript returned empty icon data'
        }
      }

      return {
        icon: nativeImage.createFromDataURL(`data:image/png;base64,${base64}`)
      }
    } catch (error) {
      return {
        icon: nativeImage.createEmpty(),
        error: this.formatProcessError(error)
      }
    }
  }

  private formatProcessError(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error)
    }

    const processError = error as Error & {
      stderr?: unknown
      code?: unknown
      signal?: unknown
    }
    const stderr = processError.stderr ? String(processError.stderr).trim() : ''
    if (stderr) {
      return stderr
    }

    const details = [error.message]
    if (processError.code !== undefined) {
      details.push(`code=${String(processError.code)}`)
    }
    if (processError.signal !== undefined) {
      details.push(`signal=${String(processError.signal)}`)
    }
    return details.join(' ')
  }

  private resolveDarwinSyntheticIconPath(filePath: string): string | null {
    try {
      const root = join(app.getPath('temp'), 'mulby-icon-samples')
      mkdirSync(root, { recursive: true })

      if (filePath.trim().toLowerCase() === 'folder') {
        const folderPath = join(root, 'folder')
        mkdirSync(folderPath, { recursive: true })
        return folderPath
      }

      if (!isExtensionOnlyIconRequest(filePath)) {
        return null
      }

      const extension = filePath.trim().toLowerCase()
      const samplePath = join(root, `sample${extension}`)
      const fd = openSync(samplePath, 'a')
      closeSync(fd)
      return samplePath
    } catch {
      return null
    }
  }

  private async tryCreateThumbnail(
    filePath: string,
    targetSize: number,
    traceContext?: SystemIconTraceContext
  ): Promise<NativeImage> {
    try {
      this.recordIconBreadcrumb('system.icon.thumbnail:before', traceContext, {
        path: filePath,
        targetSize
      })
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, {
        width: targetSize,
        height: targetSize
      })
      this.recordIconBreadcrumb('system.icon.thumbnail:returned', traceContext, {
        path: filePath
      })
      const usable = this.isUsableNativeIcon(thumbnail)
      this.recordIconBreadcrumb('system.icon.thumbnail:after', traceContext, {
        path: filePath,
        usable
      })
      if (usable) {
        return thumbnail
      }


      return nativeImage.createEmpty()
    } catch (error) {
      this.recordIconBreadcrumb('system.icon.thumbnail:error', traceContext, {
        path: filePath,
        error
      })
      return nativeImage.createEmpty()
    }
  }

  private resolveMacAppBundleIcon(appBundlePath: string): NativeImage {
    if (!existsSync(appBundlePath)) {
      return nativeImage.createEmpty()
    }

    const plistPath = join(appBundlePath, 'Contents', 'Info.plist')
    if (!existsSync(plistPath)) {
      return nativeImage.createEmpty()
    }

    try {
      const plist = this.readMacPlistAsXml(plistPath)
      if (!plist) {
        return nativeImage.createEmpty()
      }
      const iconNames = this.extractMacBundleIconNames(plist)

      for (const iconName of iconNames) {
        const withExt = extname(iconName) ? iconName : `${iconName}.icns`
        const iconPath = join(appBundlePath, 'Contents', 'Resources', withExt)
        if (!existsSync(iconPath)) continue
        const icon = nativeImage.createFromPath(iconPath)

        if (this.isUsableNativeIcon(icon)) {

          return icon
        }
      }
    } catch {
      // ignore plist parse failure
    }

    return nativeImage.createEmpty()
  }

  private extractMacBundleIconNames(plist: string): string[] {
    const names: string[] = []

    const direct = plist.match(/<key>\s*CFBundleIconFile\s*<\/key>\s*<string>\s*([^<]+)\s*<\/string>/i)
    if (direct?.[1]) {
      names.push(direct[1].trim())
    }

    const filesBlock = plist.match(/<key>\s*CFBundleIconFiles\s*<\/key>\s*<array>([\s\S]*?)<\/array>/i)
    if (filesBlock?.[1]) {
      const matches = filesBlock[1].matchAll(/<string>\s*([^<]+)\s*<\/string>/gi)
      for (const match of matches) {
        const value = match[1]?.trim()
        if (value) {
          names.push(value)
        }
      }
    }

    const iconNameMatches = plist.matchAll(/<key>\s*CFBundleIconName\s*<\/key>\s*<string>\s*([^<]+)\s*<\/string>/gi)
    for (const match of iconNameMatches) {
      const value = match[1]?.trim()
      if (value) {
        names.push(value)
      }
    }

    return Array.from(new Set(names))
  }

  private readMacPlistAsXml(plistPath: string): string {
    try {
      const content = readFileSync(plistPath, 'utf-8')
      if (content.includes('<plist')) {
        return content
      }
    } catch {
      // ignore and fallback to plutil
    }

    const result = spawnSync('plutil', ['-convert', 'xml1', '-o', '-', plistPath], { encoding: 'utf-8' })
    if (result.status !== 0) {
      return ''
    }
    return result.stdout || ''
  }

  private normalizeIcon(icon: NativeImage, targetSize: number): NativeImage {
    if (!this.isUsableNativeIcon(icon)) {
      return icon
    }
    const size = icon.getSize()
    const maxEdge = Math.max(size.width, size.height)
    if (maxEdge <= targetSize) {
      return icon
    }
    const ratio = targetSize / maxEdge
    const width = Math.max(1, Math.round(size.width * ratio))
    const height = Math.max(1, Math.round(size.height * ratio))
    return icon.resize({ width, height })
  }

  private isUsableNativeIcon(icon: NativeImage): boolean {
    if (!icon || icon.isEmpty()) return false
    const size = icon.getSize()
    return size.width > 0 && size.height > 0
  }

  private isDirectImagePath(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.heic', '.icns', '.ico'].includes(ext)
  }

  private isValidIconDataUrl(dataUrl: string): boolean {
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl) && dataUrl.length > 64
  }

  private normalizeIconSize(size?: number): number {
    if (!Number.isFinite(size)) {
      return PluginSystem.DEFAULT_ICON_SIZE
    }
    const safe = Math.round(size as number)
    return Math.max(
      PluginSystem.MIN_ICON_SIZE,
      Math.min(PluginSystem.MAX_ICON_SIZE, safe)
    )
  }

  private normalizeConcurrency(concurrency?: number): number {
    if (!Number.isFinite(concurrency)) {
      return PluginSystem.DEFAULT_BATCH_CONCURRENCY
    }
    const safe = Math.round(concurrency as number)
    return Math.max(1, Math.min(PluginSystem.MAX_BATCH_CONCURRENCY, safe))
  }

  private resolveIconKind(filePath: string, kind?: SystemIconKind): SystemIconKind {
    if (kind) {
      return kind
    }
    return filePath.toLowerCase().endsWith('.app') ? 'app' : 'file'
  }

  private buildIconCacheKey(filePath: string, kind: SystemIconKind, size: number): string {
    return `${kind}:${size}:${filePath}`
  }

  private setFileIconCache(key: string, value: string): void {
    if (this.fileIconCache.has(key)) {
      this.fileIconCache.delete(key)
    }
    this.fileIconCache.set(key, value)
    while (this.fileIconCache.size > PluginSystem.MAX_FILE_ICON_CACHE) {
      const firstKey = this.fileIconCache.keys().next().value as string | undefined
      if (!firstKey) break
      this.fileIconCache.delete(firstKey)
    }
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    task: (item: T, index: number) => Promise<void>
  ): Promise<void> {
    if (items.length === 0) return
    const workerCount = Math.min(concurrency, items.length)
    let nextIndex = 0

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const current = nextIndex
          nextIndex += 1
          await task(items[current], current)
        }
      })
    )
  }



  /**
   * 获取设备唯一标识
   * 使用机器信息生成稳定的设备 ID
   */
  getNativeId(): string {
    if (this._nativeId) {
      return this._nativeId
    }

    // 使用多个硬件特征生成稳定的设备标识
    const machineInfo = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || '',
      os.totalmem().toString(),
      os.homedir()
    ].join('|')

    this._nativeId = crypto
      .createHash('sha256')
      .update(machineInfo)
      .digest('hex')
      .substring(0, 32)

    return this._nativeId
  }

  /**
   * 判断是否为开发环境
   * 插件应用开发环境：未打包运行
   */
  isDev(): boolean {
    return !app.isPackaged
  }

  /**
   * 判断是否为 macOS
   */
  isMacOS(): boolean {
    return process.platform === 'darwin'
  }

  /**
   * 判断是否为 Windows
   */
  isWindows(): boolean {
    return process.platform === 'win32'
  }

  /**
   * 判断是否为 Linux
   */
  isLinux(): boolean {
    return process.platform === 'linux'
  }
}

export const pluginSystem = new PluginSystem()
