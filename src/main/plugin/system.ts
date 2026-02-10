import { app, nativeImage, NativeImage } from 'electron'
import * as os from 'os'
import * as crypto from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname, join } from 'path'
import { spawnSync } from 'child_process'

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

export class PluginSystem {
  private _nativeId: string | null = null
  private fileIconCache: Map<string, string> = new Map()
  private static readonly MAX_FILE_ICON_CACHE = 1500
  private static readonly ICON_DEBUG_ENABLED = !app.isPackaged || process.env.INTOOLS_ICON_DEBUG === '1'
  private static readonly DEFAULT_ICON_SIZE = 128
  private static readonly MIN_ICON_SIZE = 24
  private static readonly MAX_ICON_SIZE = 256
  private static readonly DEFAULT_BATCH_CONCURRENCY = 6
  private static readonly MAX_BATCH_CONCURRENCY = 12

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

  /**
   * 获取文件/文件夹的系统图标
   * @param filePath 文件路径、扩展名（如 .txt）或 'folder'
   * @returns base64 Data URL 格式的图标
   */
  async getFileIcon(filePath: string, options: SystemIconSingleOptions = {}): Promise<string> {
    const normalizedPath = filePath.trim()
    if (!normalizedPath) return ''

    const kind = this.resolveIconKind(normalizedPath, options.kind)
    const size = this.normalizeIconSize(options.size)
    return this.getFileIconInternal(normalizedPath, { kind, size })
  }

  async getFileIcons(
    requests: SystemIconRequest[],
    options: SystemIconBatchOptions = {}
  ): Promise<SystemIconResult[]> {
    if (!Array.isArray(requests) || requests.length === 0) {
      return []
    }

    const defaultSize = this.normalizeIconSize(options.size)
    const concurrency = this.normalizeConcurrency(options.concurrency)
    const results = new Array<SystemIconResult>(requests.length)
    const localInflight = new Map<string, Promise<string>>()

    await this.runWithConcurrency(requests, concurrency, async (request, index) => {
      const normalizedPath = (request.path || '').trim()
      const kind = this.resolveIconKind(normalizedPath, request.kind)
      const size = this.normalizeIconSize(request.size ?? defaultSize)
      const key = request.key || `${kind}:${normalizedPath}`

      if (!normalizedPath) {
        results[index] = { key, path: normalizedPath, kind, icon: '' }
        return
      }

      const cacheKey = this.buildIconCacheKey(normalizedPath, kind, size)
      let pending = localInflight.get(cacheKey)
      if (!pending) {
        pending = this.getFileIconInternal(normalizedPath, { kind, size })
        localInflight.set(cacheKey, pending)
      }

      const icon = await pending
      results[index] = {
        key,
        path: normalizedPath,
        kind,
        icon
      }
    })

    return results
  }

  clearFileIconCache(): void {
    this.fileIconCache.clear()
  }

  private async getFileIconInternal(
    normalizedPath: string,
    options: { kind: SystemIconKind; size: number }
  ): Promise<string> {
    const cacheKey = this.buildIconCacheKey(normalizedPath, options.kind, options.size)
    const cached = this.fileIconCache.get(cacheKey)
    if (cached) {
      this.logIconDebug('cache-hit', {
        path: normalizedPath,
        kind: options.kind,
        size: options.size,
        dataUrlLength: cached.length
      })
      return cached
    }

    const ext = extname(normalizedPath).toLowerCase()
    let exists: boolean | undefined
    let isDirectory: boolean | undefined
    if (PluginSystem.ICON_DEBUG_ENABLED) {
      exists = existsSync(normalizedPath)
      isDirectory = exists ? (() => {
        try {
          return statSync(normalizedPath).isDirectory()
        } catch {
          return false
        }
      })() : false
      this.logIconDebug('request', {
        path: normalizedPath,
        kind: options.kind,
        size: options.size,
        ext,
        exists,
        isDirectory
      })
    }

    const resolved = await this.resolveNativeIcon(normalizedPath, options)
    if (!this.isUsableNativeIcon(resolved.icon)) {
      this.logIconDebug('icon-empty', {
        path: normalizedPath,
        kind: options.kind,
        size: options.size,
        ext,
        exists,
        source: resolved.source,
        error: resolved.error
      })
      return ''
    }

    const normalizedIcon = this.normalizeIcon(resolved.icon, options.size)
    if (!this.isUsableNativeIcon(normalizedIcon)) {
      this.logIconDebug('icon-empty-after-normalize', {
        path: normalizedPath,
        kind: options.kind,
        size: options.size,
        source: resolved.source
      })
      return ''
    }

    const dataUrl = normalizedIcon.toDataURL()
    const iconSize = normalizedIcon.getSize()
    if (!this.isValidIconDataUrl(dataUrl)) {
      this.logIconDebug('icon-invalid-data-url', {
        path: normalizedPath,
        kind: options.kind,
        size: options.size,
        source: resolved.source,
        width: iconSize.width,
        height: iconSize.height,
        dataUrlLength: dataUrl.length,
        dataUrlPrefix: dataUrl.slice(0, 48)
      })
      return ''
    }

    this.setFileIconCache(cacheKey, dataUrl)
    this.logIconDebug('icon-ready', {
      path: normalizedPath,
      kind: options.kind,
      size: options.size,
      source: resolved.source,
      width: iconSize.width,
      height: iconSize.height,
      dataUrlLength: dataUrl.length
    })
    return dataUrl
  }

  private async resolveNativeIcon(
    normalizedPath: string,
    options: { kind: SystemIconKind; size: number }
  ): Promise<{ icon: NativeImage; source: string; error?: string }> {
    const ext = extname(normalizedPath).toLowerCase()
    const isMacAppBundle = process.platform === 'darwin' && ext === '.app'

    if (options.kind === 'app' && isMacAppBundle) {
      const bundleIcon = this.resolveMacAppBundleIcon(normalizedPath)
      if (this.isUsableNativeIcon(bundleIcon)) {
        return { icon: bundleIcon, source: 'bundle' }
      }
      this.logIconDebug('bundle-icon-miss', { path: normalizedPath })
    }

    if (options.kind === 'file' && this.isDirectImagePath(normalizedPath)) {
      const directImage = nativeImage.createFromPath(normalizedPath)
      if (this.isUsableNativeIcon(directImage)) {
        return { icon: directImage, source: 'direct-image' }
      }
    }

    const thumbnail = await this.tryCreateThumbnail(normalizedPath, options.size)
    if (this.isUsableNativeIcon(thumbnail)) {
      return { icon: thumbnail, source: 'thumbnail' }
    }

    const sizeCandidates: Array<'large' | 'normal' | 'small'> =
      isMacAppBundle ? ['normal', 'small'] : ['large', 'normal', 'small']
    let lastError: string | undefined

    for (const candidate of sizeCandidates) {
      try {
        const icon = await app.getFileIcon(normalizedPath, { size: candidate })
        if (this.isUsableNativeIcon(icon)) {
          return { icon, source: `app.getFileIcon:${candidate}` }
        }
        const iconSize = icon.getSize()
        this.logIconDebug('icon-candidate-invalid', {
          path: normalizedPath,
          source: `app.getFileIcon:${candidate}`,
          width: iconSize.width,
          height: iconSize.height,
          isEmpty: icon.isEmpty()
        })
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    return { icon: nativeImage.createEmpty(), source: 'none', error: lastError }
  }

  private async tryCreateThumbnail(filePath: string, targetSize: number): Promise<NativeImage> {
    try {
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, {
        width: targetSize,
        height: targetSize
      })
      if (this.isUsableNativeIcon(thumbnail)) {
        return thumbnail
      }
      const size = thumbnail.getSize()
      this.logIconDebug('thumbnail-invalid', {
        path: filePath,
        width: size.width,
        height: size.height,
        isEmpty: thumbnail.isEmpty()
      })
      return nativeImage.createEmpty()
    } catch (error) {
      this.logIconDebug('thumbnail-error', {
        path: filePath,
        error: error instanceof Error ? error.message : String(error)
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
        const size = icon.getSize()
        if (this.isUsableNativeIcon(icon)) {
          this.logIconDebug('bundle-icon-path', {
            appBundlePath,
            iconPath,
            width: size.width,
            height: size.height
          })
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

  private logIconDebug(stage: string, payload: Record<string, unknown>): void {
    if (!PluginSystem.ICON_DEBUG_ENABLED) {
      return
    }
    const message = JSON.stringify({
      stage,
      ...payload,
      ts: Date.now()
    })
    console.log(`[icon-debug] ${message}`)
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
