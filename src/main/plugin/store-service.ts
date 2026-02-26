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
  PluginStoreIndex,
  PluginStoreInstallFromUrlInput,
  PluginStorePlugin,
  PluginStoreSourceSyncResult
} from '../../shared/types/plugin-store'
import { appSettingsManager } from '../services/app-settings'
import type { InstallResult } from './installer'
import { PluginInstaller } from './installer'
import { PluginManager } from './manager'
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
      return a.plugin.name.localeCompare(b.plugin.name)
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
          sourceName: remote.sourceName
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
        sourceName: remote.sourceName
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

  async installFromUrl(input: PluginStoreInstallFromUrlInput): Promise<InstallResult> {
    const downloadUrl = String(input.downloadUrl || '').trim()
    if (!downloadUrl || !isHttpUrl(downloadUrl)) {
      return { success: false, error: '无效的下载地址' }
    }

    const tempDir = join(app.getPath('temp'), 'mulby-plugin-store')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    const safeId = String(input.pluginId || 'plugin').replace(/[^a-zA-Z0-9._-]/g, '_')
    const safeVersion = String(input.version || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_')
    const tempFilePath = join(tempDir, `${safeId}-${safeVersion}-${Date.now()}.inplugin`)

    try {
      const binary = await this.requestBinary(downloadUrl, DOWNLOAD_TIMEOUT_MS)
      writeFileSync(tempFilePath, binary)

      const result = await this.installer.install(tempFilePath)
      if (result.success && result.action !== 'already-installed') {
        await this.manager.init()
        if (result.pluginName) {
          await this.manager.initializePlugin(result.pluginName)
        }
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载或安装失败'
      return { success: false, error: message }
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
        sourceName: item.sourceName
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
      const id = String(candidate.id || '').trim()
      const name = String(candidate.name || '').trim()
      const pluginVersion = String(candidate.version || '').trim()
      const description = String(candidate.description || '').trim()
      const rawDownloadUrl = String(candidate.downloadUrl || '').trim()
      if (!id || !name || !pluginVersion || !description || !rawDownloadUrl) {
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
      const lastPackageTime = String(candidate.lastPackageTime || '').trim()
      plugins.push({
        id,
        name,
        version: pluginVersion,
        description,
        downloadUrl,
        author: author || undefined,
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
}
