import { app, net } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import type { Plugin } from '../../shared/types/plugin'
import type { StoreSource } from '../../shared/types/settings'
import type {
  InstalledPluginUpdateInfo,
  InstalledPluginUpdateResult,
  PluginStoreBatchUpdateItemResult,
  PluginStoreBatchUpdateResult,
  PluginStoreEntry,
  PluginStoreFetchResult,
  PluginStoreIcon,
  PluginStoreIndex,
  PluginStoreInstallResult,
  PluginStoreInstallFromUrlInput,
  PluginStorePlugin,
  PluginStoreScreenshot,
  PluginStoreSourceSyncResult
} from '../../shared/types/plugin-store'
import { appSettingsManager } from '../services/app-settings'
import { PluginInstaller } from './installer'
import { PluginManager } from './manager'
import { computeSha256Hex, isAllowedStoreTransport, normalizeSha256 } from './store-security'
import { compareVersions } from './version'

interface SourceFetchResult {
  source: StoreSource
  lastSyncAt: number
  success: boolean
  plugins: PluginStorePlugin[]
  error?: string
}

const REQUEST_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 60_000

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export class PluginStoreService {
  private manager: PluginManager
  private installer: PluginInstaller
  private userPluginsDir: string

  constructor(manager: PluginManager, installer: PluginInstaller) {
    this.manager = manager
    this.installer = installer
    this.userPluginsDir = resolve(join(app.getPath('userData'), 'plugins'))
  }

  async fetchStoreEntries(): Promise<PluginStoreFetchResult> {
    const settings = appSettingsManager.getSettings()
    const enabledSources = [...settings.storeSources]
      .filter((source) => source.enabled)
      .sort((a, b) => a.priority - b.priority)

    if (enabledSources.length === 0) {
      return {
        entries: [],
        sources: [],
        fetchedAt: Date.now()
      }
    }

    const fetched = await Promise.all(enabledSources.map((source) => this.fetchSingleSource(source)))
    this.persistSourceSyncState(fetched)

    const sourceStates: PluginStoreSourceSyncResult[] = fetched.map((item) => ({
      sourceId: item.source.id,
      sourceName: item.source.name,
      url: item.source.url,
      success: item.success,
      lastSyncAt: item.lastSyncAt,
      error: item.error
    }))

    const selectedById = new Map<string, { plugin: PluginStorePlugin; source: StoreSource }>()
    for (const source of enabledSources) {
      const result = fetched.find((item) => item.source.id === source.id)
      if (!result || !result.success) continue

      for (const plugin of result.plugins) {
        const existing = selectedById.get(plugin.id)
        if (!existing) {
          selectedById.set(plugin.id, { plugin, source })
          continue
        }

        const compare = compareVersions(plugin.version, existing.plugin.version)
        if (compare > 0 || (compare === 0 && source.priority < existing.source.priority)) {
          selectedById.set(plugin.id, { plugin, source })
        }
      }
    }

    const installedVersions = this.getInstalledVersionMap()
    const entries: PluginStoreEntry[] = Array.from(selectedById.values()).map(({ plugin, source }) => {
      const installedVersion = installedVersions.get(plugin.id)
      const status = installedVersion && compareVersions(plugin.version, installedVersion) > 0
        ? 'updatable'
        : installedVersion
          ? 'installed'
          : 'not-installed'
      return {
        plugin,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        sourcePriority: source.priority,
        installState: {
          status,
          installedVersion,
          remoteVersion: plugin.version
        }
      }
    })

    entries.sort((a, b) => {
      const statusRank: Record<string, number> = { updatable: 0, 'not-installed': 1, installed: 2 }
      const statusDiff = statusRank[a.installState.status] - statusRank[b.installState.status]
      if (statusDiff !== 0) return statusDiff
      return this.getPluginLabel(a.plugin).localeCompare(this.getPluginLabel(b.plugin))
    })

    return {
      entries,
      sources: sourceStates,
      fetchedAt: Date.now()
    }
  }

  async checkInstalledUpdates(): Promise<InstalledPluginUpdateResult> {
    const fetched = await this.fetchStoreEntries()
    const remoteMap = new Map<string, PluginStoreEntry>()
    for (const entry of fetched.entries) {
      remoteMap.set(entry.plugin.id, entry)
    }

    const installed = this.manager.getAll().filter((plugin) => this.isUserInstalledPlugin(plugin))
    const updates: InstalledPluginUpdateInfo[] = installed.map((plugin) => {
      const installedVersion = String(plugin.manifest.version || '0.0.0')
      const remote = remoteMap.get(plugin.id)
      if (!remote) {
        return {
          pluginId: plugin.id,
          pluginName: plugin.manifest.name,
          displayName: plugin.manifest.displayName,
          installedVersion,
          status: 'no-source'
        }
      }

      const compare = compareVersions(remote.plugin.version, installedVersion)
      if (compare > 0) {
        return {
          pluginId: plugin.id,
          pluginName: plugin.manifest.name,
          displayName: plugin.manifest.displayName,
          installedVersion,
          status: 'updatable',
          remoteVersion: remote.plugin.version,
          downloadUrl: remote.plugin.downloadUrl,
          sourceId: remote.sourceId,
          sourceName: remote.sourceName,
          sourceUrl: remote.sourceUrl,
          publisher: remote.plugin.publisher,
          homepage: remote.plugin.homepage,
          repository: remote.plugin.repository,
          sha256: remote.plugin.sha256
        }
      }

      return {
        pluginId: plugin.id,
        pluginName: plugin.manifest.name,
        displayName: plugin.manifest.displayName,
        installedVersion,
        status: 'latest',
        remoteVersion: remote.plugin.version,
        sourceId: remote.sourceId,
        sourceName: remote.sourceName,
        sourceUrl: remote.sourceUrl,
        publisher: remote.plugin.publisher,
        homepage: remote.plugin.homepage,
        repository: remote.plugin.repository,
        sha256: remote.plugin.sha256
      }
    })

    updates.sort((a, b) => {
      const statusRank: Record<string, number> = { updatable: 0, latest: 1, 'no-source': 2 }
      const statusDiff = statusRank[a.status] - statusRank[b.status]
      if (statusDiff !== 0) return statusDiff
      return a.displayName.localeCompare(b.displayName)
    })

    return {
      updates,
      sources: fetched.sources,
      fetchedAt: fetched.fetchedAt
    }
  }

  async installFromUrl(input: PluginStoreInstallFromUrlInput): Promise<PluginStoreInstallResult> {
    const downloadUrl = String(input.downloadUrl || '').trim()
    if (!downloadUrl || !isHttpUrl(downloadUrl)) {
      return { success: false, error: '无效的下载地址' }
    }

    if (!isAllowedStoreTransport(downloadUrl)) {
      return { success: false, error: 'Plugin downloads must use HTTPS. Only localhost may use HTTP.' }
    }

    const tempDir = join(app.getPath('temp'), 'mulby-plugin-store')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    const safeId = String(input.pluginId || 'plugin').replace(/[^a-zA-Z0-9._-]/g, '_')
    const safeVersion = String(input.version || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_')
    const tempFilePath = join(tempDir, `${safeId}-${safeVersion}-${Date.now()}.inplugin`)
    const expectedSha256 = normalizeSha256(input.sha256)

    try {
      const binary = await this.requestBinary(downloadUrl, DOWNLOAD_TIMEOUT_MS)
      const integrityDigest = computeSha256Hex(binary)
      if (expectedSha256 && integrityDigest !== expectedSha256) {
        return {
          success: false,
          error: 'Downloaded plugin checksum did not match the store index.',
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceUrl: input.sourceUrl,
          integrityStatus: 'verified',
          integrityDigest
        }
      }
      writeFileSync(tempFilePath, binary)

      const result = await this.installer.install(tempFilePath, {
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl,
        downloadUrl,
        publisher: input.publisher,
        homepage: input.homepage,
        repository: input.repository,
        sha256: expectedSha256,
        integrityStatus: expectedSha256 ? 'verified' : 'missing',
        integrityDigest,
        downloadedAt: Date.now()
      })
      if (result.success && result.action !== 'already-installed') {
        await this.manager.init()
        if (result.pluginName) {
          await this.manager.initializePlugin(result.pluginName)
        }
      }
      return {
        ...result,
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl,
        integrityStatus: expectedSha256 ? 'verified' : 'missing',
        integrityDigest
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载或安装失败'
      return {
        success: false,
        error: message,
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl,
        integrityStatus: expectedSha256 ? 'verified' : 'missing'
      }
    } finally {
      try {
        rmSync(tempFilePath, { force: true })
      } catch {
        // ignore cleanup error
      }
    }
  }

  async updateAll(pluginIds?: string[]): Promise<PluginStoreBatchUpdateResult> {
    const updateInfo = await this.checkInstalledUpdates()
    const idFilter = Array.isArray(pluginIds) && pluginIds.length > 0 ? new Set(pluginIds) : null

    const candidates = updateInfo.updates.filter((item) => {
      if (item.status !== 'updatable') return false
      if (!idFilter) return true
      return idFilter.has(item.pluginId)
    })

    const results: PluginStoreBatchUpdateItemResult[] = []
    for (const item of candidates) {
      const installResult = await this.installFromUrl({
        pluginId: item.pluginId,
        version: item.remoteVersion,
        downloadUrl: item.downloadUrl || '',
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        publisher: item.publisher,
        homepage: item.homepage,
        repository: item.repository,
        sha256: item.sha256
      })
      results.push({
        pluginId: item.pluginId,
        pluginName: item.pluginName,
        displayName: item.displayName,
        fromVersion: item.installedVersion,
        toVersion: item.remoteVersion || item.installedVersion,
        success: installResult.success,
        error: installResult.success ? undefined : installResult.error
      })
    }

    return {
      results,
      sources: updateInfo.sources,
      fetchedAt: updateInfo.fetchedAt
    }
  }

  private getInstalledVersionMap(): Map<string, string> {
    const map = new Map<string, string>()
    for (const plugin of this.manager.getAll()) {
      map.set(plugin.id, String(plugin.manifest.version || '0.0.0'))
    }
    return map
  }

  private isUserInstalledPlugin(plugin: Plugin): boolean {
    return resolve(plugin.path).startsWith(this.userPluginsDir)
  }

  private persistSourceSyncState(fetched: SourceFetchResult[]): void {
    const settings = appSettingsManager.getSettings()
    const byId = new Map(fetched.map((item) => [item.source.id, item] as const))

    const nextSources = settings.storeSources.map((source) => {
      const result = byId.get(source.id)
      if (!result) return source
      return {
        ...source,
        lastSyncAt: result.lastSyncAt,
        lastError: result.success ? undefined : result.error
      }
    })
    appSettingsManager.updateSettings({ storeSources: nextSources })
  }
  async fetchAdhocSource(url: string): Promise<SourceFetchResult> {
    return this.fetchSingleSource({
      id: 'adhoc_temp',
      name: 'Adhoc Source',
      url,
      priority: 0,
      enabled: true
    })
  }

  private async fetchSingleSource(source: StoreSource): Promise<SourceFetchResult> {
    const lastSyncAt = Date.now()
    try {
      if (!isHttpUrl(source.url)) {
        return {
          source,
          success: false,
          plugins: [],
          lastSyncAt,
          error: '来源地址必须为 http(s) URL'
        }
      }

      if (!isAllowedStoreTransport(source.url)) {
        return {
          source,
          success: false,
          plugins: [],
          lastSyncAt,
          error: 'Store sources must use HTTPS. Only localhost may use HTTP.'
        }
      }

      const body = await this.requestText(source.url, REQUEST_TIMEOUT_MS)
      const index = this.parseIndex(source.url, body)
      return {
        source,
        success: true,
        plugins: index.plugins,
        lastSyncAt
      }
    } catch (error) {
      return {
        source,
        success: false,
        plugins: [],
        lastSyncAt,
        error: error instanceof Error ? error.message : '加载失败'
      }
    }
  }

  private parseIndex(sourceUrl: string, body: string): PluginStoreIndex {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new Error('索引 JSON 解析失败')
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('索引结构无效')
    }

    const index = parsed as Record<string, unknown>
    const version = String(index.version || '').trim()
    if (!version) {
      throw new Error('索引缺少 version')
    }

    if (!Array.isArray(index.plugins)) {
      throw new Error('索引缺少 plugins 数组')
    }

    const plugins: PluginStorePlugin[] = []
    for (const row of index.plugins) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const candidate = row as Record<string, unknown>
      const id = String(candidate.id || candidate.pluginId || candidate.name || '').trim()
      const name = String(candidate.name || candidate.id || candidate.pluginId || '').trim()
      const displayName = this.resolveOptionalText(candidate.displayName)
      const pluginVersion = String(candidate.version || '').trim()
      const description = this.resolveOptionalText(candidate.description)
      const details = this.resolveOptionalText(candidate.details)
        || this.resolveOptionalText(candidate.detail)
        || this.resolveOptionalText(candidate.longDescription)
        || this.resolveOptionalText(candidate.readme)
      const rawDownloadUrl = String(candidate.downloadUrl || '').trim()
      if (!id || !name || !pluginVersion || !rawDownloadUrl) {
        continue
      }

      const summary = description || details
      if (!summary) {
        continue
      }

      let downloadUrl: string
      try {
        downloadUrl = new URL(rawDownloadUrl, sourceUrl).toString()
      } catch {
        continue
      }
      if (!isHttpUrl(downloadUrl)) {
        continue
      }

      const author = String(candidate.author || '').trim()
      const publisher = String(candidate.publisher || '').trim()
      const type = this.resolveOptionalText(candidate.type)
      const lastPackageTime = String(candidate.lastPackageTime || '').trim()
      const icon = this.resolveStoreIcon(candidate.icon ?? candidate.iconUrl, sourceUrl)
      const banner = this.resolveOptionalUrl(candidate.banner ?? candidate.bannerUrl, sourceUrl)
      const screenshots = this.resolveStoreScreenshots(
        candidate.screenshots ?? candidate.screenShots ?? candidate.gallery,
        sourceUrl
      )
      const tags = this.resolveOptionalStringList(candidate.tags)
      const categories = this.resolveOptionalStringList(candidate.categories)
      const license = this.resolveOptionalText(candidate.license)
      const homepage = this.resolveOptionalUrl(candidate.homepage, sourceUrl)
      const repository = this.resolveOptionalUrl(candidate.repository, sourceUrl)
      const sha256 = normalizeSha256(candidate.sha256)
      if (candidate.sha256 !== undefined && !sha256) {
        continue
      }
      plugins.push({
        id,
        name,
        displayName,
        version: pluginVersion,
        description: summary,
        downloadUrl,
        type,
        author: author || undefined,
        publisher: publisher || undefined,
        icon,
        banner,
        screenshots,
        details,
        tags,
        categories,
        license,
        homepage,
        repository,
        sha256,
        lastPackageTime: lastPackageTime || undefined
      })
    }

    return { version, plugins }
  }

  private requestText(url: string, timeoutMs: number): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const request = net.request({ url, method: 'GET' })
      const timer = setTimeout(() => {
        request.abort()
        rejectPromise(new Error('请求超时'))
      }, timeoutMs)

      const chunks: Buffer[] = []
      request.on('response', (response) => {
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          clearTimeout(timer)
          if (response.statusCode < 200 || response.statusCode >= 300) {
            rejectPromise(new Error(`请求失败（${response.statusCode}）`))
            return
          }
          resolvePromise(Buffer.concat(chunks).toString('utf-8'))
        })
        response.on('error', (error: Error) => {
          clearTimeout(timer)
          rejectPromise(error)
        })
      })
      request.on('error', (error: Error) => {
        clearTimeout(timer)
        rejectPromise(error)
      })
      request.end()
    })
  }

  private requestBinary(url: string, timeoutMs: number): Promise<Buffer> {
    return new Promise((resolvePromise, rejectPromise) => {
      const request = net.request({ url, method: 'GET' })
      const timer = setTimeout(() => {
        request.abort()
        rejectPromise(new Error('下载超时'))
      }, timeoutMs)

      const chunks: Buffer[] = []
      request.on('response', (response) => {
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          clearTimeout(timer)
          if (response.statusCode < 200 || response.statusCode >= 300) {
            rejectPromise(new Error(`下载失败（${response.statusCode}）`))
            return
          }
          resolvePromise(Buffer.concat(chunks))
        })
        response.on('error', (error: Error) => {
          clearTimeout(timer)
          rejectPromise(error)
        })
      })
      request.on('error', (error: Error) => {
        clearTimeout(timer)
        rejectPromise(error)
      })
      request.end()
    })
  }

  private getPluginLabel(plugin: PluginStorePlugin): string {
    return String(plugin.displayName || plugin.name || plugin.id).trim()
  }

  private resolveOptionalText(value: unknown): string | undefined {
    const text = String(value || '').trim()
    return text || undefined
  }

  private resolveOptionalStringList(value: unknown): string[] | undefined {
    const normalized = Array.isArray(value)
      ? value.map((item) => String(item || '').trim())
      : typeof value === 'string'
        ? value.split(',').map((item) => item.trim())
        : []
    const deduped = Array.from(new Set(normalized.filter(Boolean)))
    return deduped.length > 0 ? deduped : undefined
  }

  private resolveStoreIcon(value: unknown, baseUrl: string): PluginStoreIcon | undefined {
    if (typeof value === 'string') {
      const raw = value.trim()
      if (!raw) return undefined
      const resolved = this.resolveOptionalUrl(raw, baseUrl)
      if (resolved) return { type: 'url', value: resolved }
      if (raw.length <= 4) return { type: 'emoji', value: raw }
      return undefined
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }

    const icon = value as Record<string, unknown>
    const iconType = String(icon.type || '').trim().toLowerCase()
    const rawValue = String(icon.value ?? icon.url ?? '').trim()
    if (!rawValue) return undefined
    if (iconType === 'emoji') {
      return { type: 'emoji', value: rawValue }
    }
    const resolved = this.resolveOptionalUrl(rawValue, baseUrl)
    if (!resolved) return undefined
    return { type: 'url', value: resolved }
  }

  private resolveStoreScreenshots(value: unknown, baseUrl: string): PluginStoreScreenshot[] | undefined {
    if (!Array.isArray(value)) return undefined
    const screenshots: PluginStoreScreenshot[] = []
    for (const row of value) {
      if (typeof row === 'string') {
        const url = this.resolveOptionalUrl(row, baseUrl)
        if (url) {
          screenshots.push({ url })
        }
        continue
      }

      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        continue
      }

      const shot = row as Record<string, unknown>
      const url = this.resolveOptionalUrl(shot.url ?? shot.src, baseUrl)
      if (!url) continue
      const caption = this.resolveOptionalText(shot.caption ?? shot.title ?? shot.alt)
      screenshots.push(caption ? { url, caption } : { url })
    }
    return screenshots.length > 0 ? screenshots : undefined
  }

  private resolveOptionalUrl(value: unknown, baseUrl: string): string | undefined {
    const raw = String(value || '').trim()
    if (!raw) return undefined
    try {
      const resolved = new URL(raw, baseUrl).toString()
      return isHttpUrl(resolved) ? resolved : undefined
    } catch {
      return undefined
    }
  }
}
