import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import type {
  AppSearchResult,
  DesktopSearchProvider,
  FileSearchResult,
  SearchExecutionContext,
  SearchRankingContext
} from '../types'

const SEARCH_KEY_FILES = 'darwin-files'
const SEARCH_KEY_APPS = 'darwin-apps'
const SEARCH_KEY_APPS_CATALOG = 'darwin-apps-catalog'

const DARWIN_APP_CATALOG_LIMIT = 6000
const DARWIN_APP_CATALOG_TTL_MS = 5 * 60 * 1000
const DARWIN_APP_RESOLVE_CONCURRENCY = 10
const DARWIN_APP_CACHE_FILE = 'darwin-app-catalog-cache.json'
const DARWIN_APP_CACHE_VERSION = 1
const DARWIN_APP_HYDRATE_TOPN = 260

interface PersistedDarwinCatalog {
  version: number
  savedAt: number
  paths: string[]
  displayNames: Record<string, string>
}

export class DarwinSearchProvider implements DesktopSearchProvider {
  private appDisplayNameCache: Map<string, string> = new Map()
  private darwinAppCatalogCache: { paths: string[]; expiresAt: number } | null = null
  private darwinAppCatalogLoading: Promise<string[]> | null = null
  private darwinCacheLoaded = false
  private darwinDisplayNamePending: Set<string> = new Set()
  private persistCacheTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly execution: SearchExecutionContext,
    private readonly ranking: SearchRankingContext
  ) {}

  warmupAppSearchIndex(): void {
    this.ensureDarwinPersistentCacheLoaded()
    void this.getDarwinAppCatalogPaths()
      .then((paths) => {
        if (this.appDisplayNameCache.size >= paths.length && paths.length > 0) {
          return
        }

        const seedPaths = paths.slice(0, DARWIN_APP_HYDRATE_TOPN)
        if (seedPaths.length > 0) {
          this.hydrateDarwinDisplayNames(seedPaths)
        }

        this.hydrateDarwinDisplayNames(paths)
      })
      .catch(() => {
        // ignore warmup errors
      })
  }

  async searchFiles(query: string, limit: number): Promise<FileSearchResult[]> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []

    this.execution.cancelSearchProcess(SEARCH_KEY_FILES)

    let paths: string[] = []
    try {
      const baseLimit = Math.max(limit * 4, 60)
      paths = await this.execution.runCommand('mdfind', ['-name', normalizedQuery], baseLimit, SEARCH_KEY_FILES)

      if (paths.length < limit * 2) {
        const wildcard = this.ranking.buildWildcardPattern(normalizedQuery)
        if (wildcard && wildcard.toLowerCase() !== normalizedQuery.toLowerCase()) {
          const fallback = await this.execution.runCommand('mdfind', ['-name', wildcard], baseLimit, SEARCH_KEY_FILES)
          paths = this.ranking.mergeUniquePaths(paths, fallback, baseLimit)
        }
      }
    } catch (error) {
      if (this.execution.isKilledProcessError(error)) {
        return []
      }
      console.error('darwin file search failed:', error)
      return []
    }

    const formatted: FileSearchResult[] = []
    for (const rawPath of paths) {
      const cleanPath = rawPath.trim()
      if (!cleanPath) continue

      try {
        const stats = statSync(cleanPath)
        formatted.push({
          name: basename(cleanPath),
          path: cleanPath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          source: 'spotlight'
        })
      } catch {
        // ignore invalid paths
      }
    }

    const sorted = formatted
      .map((item) => ({ ...item, score: this.ranking.scoreFile(item, normalizedQuery) }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)

    return sorted
  }

  async searchApps(query: string, limit: number): Promise<AppSearchResult[]> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []

    this.execution.cancelSearchProcess(SEARCH_KEY_APPS)

    let paths: string[] = []
    try {
      const baseLimit = Math.max(limit * 8, 120)
      paths = await this.execution.runCommand('mdfind', ['-name', normalizedQuery], baseLimit, SEARCH_KEY_APPS)

      if (paths.length < limit * 3) {
        const wildcard = this.ranking.buildWildcardPattern(normalizedQuery)
        if (wildcard && wildcard.toLowerCase() !== normalizedQuery.toLowerCase()) {
          const fallback = await this.execution.runCommand('mdfind', ['-name', wildcard], baseLimit, SEARCH_KEY_APPS)
          paths = this.ranking.mergeUniquePaths(paths, fallback, baseLimit)
        }
      }
    } catch (error) {
      if (this.execution.isKilledProcessError(error)) {
        return []
      }
      console.error('darwin app search failed:', error)
      return []
    }

    const quickLimit = Math.max(limit * 3, 90)
    const quickResults = await this.formatAppResults(paths, quickLimit, normalizedQuery, 'spotlight')

    if (quickResults.length >= limit) {
      return quickResults.slice(0, limit)
    }

    const catalogMatches = await this.searchDarwinCatalogByFuzzy(normalizedQuery, quickLimit)
    const merged = new Map<string, AppSearchResult>()

    for (const item of [...quickResults, ...catalogMatches]) {
      if (!merged.has(item.path)) {
        merged.set(item.path, item)
      }
    }

    const finalResults = Array.from(merged.values())
      .map((item) => ({
        ...item,
        score: this.ranking.scoreApp(item, normalizedQuery, this.ranking.normalizeAppDisplayName(basename(item.path)))
      }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)

    return finalResults
  }

  private async formatAppResults(
    paths: string[],
    limit: number,
    query: string,
    source: string
  ): Promise<AppSearchResult[]> {
    const candidates: string[] = []
    const seen = new Set<string>()
    const candidateLimit = Math.max(limit * 8, 120)

    for (const rawPath of paths) {
      const appPath = rawPath.trim()
      if (!appPath || seen.has(appPath) || !existsSync(appPath)) continue
      if (!appPath.toLowerCase().endsWith('.app')) continue

      seen.add(appPath)
      candidates.push(appPath)
      if (candidates.length >= candidateLimit) break
    }

    if (candidates.length === 0) return []

    const raw = await Promise.all(
      candidates.map(async (appPath) => {
        const name = await this.resolveAppDisplayName(appPath)
        const item: AppSearchResult = {
          name,
          path: appPath,
          kind: 'application',
          source
        }
        return item
      })
    )

    return raw
      .map((item) => ({
        ...item,
        score: this.ranking.scoreApp(item, query, this.ranking.normalizeAppDisplayName(basename(item.path)))
      }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)
  }

  private getDarwinCacheFilePath(): string {
    return join(app.getPath('userData'), 'cache', DARWIN_APP_CACHE_FILE)
  }

  private ensureDarwinPersistentCacheLoaded(): void {
    if (this.darwinCacheLoaded) return
    this.darwinCacheLoaded = true

    try {
      const filePath = this.getDarwinCacheFilePath()
      if (!existsSync(filePath)) return

      const raw = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as PersistedDarwinCatalog
      if (parsed.version !== DARWIN_APP_CACHE_VERSION) return

      const validPaths = Array.isArray(parsed.paths)
        ? parsed.paths.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : []
      const validDisplayNames = parsed.displayNames && typeof parsed.displayNames === 'object'
        ? Object.entries(parsed.displayNames)
          .filter(([path, name]) => typeof path === 'string' && typeof name === 'string' && name.length > 0)
        : []

      for (const [path, name] of validDisplayNames) {
        this.appDisplayNameCache.set(path, name)
      }

      if (validPaths.length > 0) {
        this.darwinAppCatalogCache = {
          paths: validPaths,
          expiresAt: Date.now() + Math.floor(DARWIN_APP_CATALOG_TTL_MS / 2)
        }
      }
    } catch {
      // ignore persisted cache load errors
    }
  }

  private schedulePersistDarwinCache(): void {
    if (this.persistCacheTimer) {
      clearTimeout(this.persistCacheTimer)
    }

    this.persistCacheTimer = setTimeout(() => {
      this.persistCacheTimer = null
      try {
        const filePath = this.getDarwinCacheFilePath()
        mkdirSync(dirname(filePath), { recursive: true })

        const payload: PersistedDarwinCatalog = {
          version: DARWIN_APP_CACHE_VERSION,
          savedAt: Date.now(),
          paths: this.darwinAppCatalogCache?.paths ?? [],
          displayNames: Object.fromEntries(this.appDisplayNameCache.entries())
        }

        writeFileSync(filePath, JSON.stringify(payload))
      } catch {
        // ignore persisted cache write errors
      }
    }, 600)
  }

  private async refreshDarwinAppCatalog(): Promise<string[]> {
    const rawPaths = await this.execution.runCommand(
      'mdfind',
      ['kMDItemContentTypeTree == "com.apple.application-bundle"'],
      DARWIN_APP_CATALOG_LIMIT,
      SEARCH_KEY_APPS_CATALOG
    )

    const deduped: string[] = []
    const seen = new Set<string>()

    for (const raw of rawPaths) {
      const appPath = raw.trim()
      if (!appPath || seen.has(appPath)) continue
      if (!appPath.toLowerCase().endsWith('.app')) continue
      if (!existsSync(appPath)) continue

      seen.add(appPath)
      deduped.push(appPath)
    }

    this.darwinAppCatalogCache = {
      paths: deduped,
      expiresAt: Date.now() + DARWIN_APP_CATALOG_TTL_MS
    }
    this.schedulePersistDarwinCache()

    return deduped
  }

  private async getDarwinAppCatalogPaths(): Promise<string[]> {
    this.ensureDarwinPersistentCacheLoaded()

    const now = Date.now()
    if (this.darwinAppCatalogCache && this.darwinAppCatalogCache.expiresAt > now) {
      return this.darwinAppCatalogCache.paths
    }

    if (this.darwinAppCatalogCache && this.darwinAppCatalogCache.paths.length > 0) {
      if (!this.darwinAppCatalogLoading) {
        this.darwinAppCatalogLoading = this.refreshDarwinAppCatalog()
          .catch(() => {
            return this.darwinAppCatalogCache?.paths ?? []
          })
          .finally(() => {
            this.darwinAppCatalogLoading = null
          })
      }

      return this.darwinAppCatalogCache.paths
    }

    if (this.darwinAppCatalogLoading) {
      return this.darwinAppCatalogLoading
    }

    this.darwinAppCatalogLoading = this.refreshDarwinAppCatalog()
    try {
      return await this.darwinAppCatalogLoading
    } finally {
      this.darwinAppCatalogLoading = null
    }
  }

  private async searchDarwinCatalogByFuzzy(query: string, limit: number): Promise<AppSearchResult[]> {
    const paths = await this.getDarwinAppCatalogPaths()
    if (paths.length === 0) return []

    const scored: Array<{ item: AppSearchResult; score: number; needHydrate: boolean }> = []

    for (const appPath of paths) {
      const fallbackName = this.ranking.normalizeAppDisplayName(basename(appPath))
      const cachedName = this.appDisplayNameCache.get(appPath)
      const item: AppSearchResult = {
        name: cachedName || fallbackName,
        path: appPath,
        kind: 'application',
        source: 'catalog'
      }
      const score = this.ranking.scoreApp(item, query, fallbackName)
      if (score > 0) {
        scored.push({ item: { ...item, score }, score, needHydrate: !cachedName })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, limit)
    this.hydrateDarwinDisplayNames(top.filter((entry) => entry.needHydrate).map((entry) => entry.item.path))

    return top.map((entry) => entry.item)
  }

  private hydrateDarwinDisplayNames(paths: string[]): void {
    if (paths.length === 0) return

    const targets = Array.from(new Set(paths)).filter((target) => !this.darwinDisplayNamePending.has(target))
    if (targets.length === 0) return

    targets.forEach((target) => this.darwinDisplayNamePending.add(target))

    let changed = false
    let cursor = 0

    const worker = async () => {
      while (true) {
        const current = cursor
        cursor += 1
        if (current >= targets.length) return

        const appPath = targets[current]
        try {
          const resolved = await this.resolveDarwinAppDisplayName(appPath)
          if (resolved && this.appDisplayNameCache.get(appPath) !== resolved) {
            this.appDisplayNameCache.set(appPath, resolved)
            changed = true
          }
        } catch {
          // ignore individual failures
        } finally {
          this.darwinDisplayNamePending.delete(appPath)
        }
      }
    }

    void Promise.all(Array.from({ length: DARWIN_APP_RESOLVE_CONCURRENCY }, () => worker())).then(() => {
      if (changed) {
        this.schedulePersistDarwinCache()
      }
    })
  }

  private async resolveAppDisplayName(appPath: string): Promise<string> {
    const fallbackName = this.ranking.normalizeAppDisplayName(basename(appPath))
    const cachedName = this.appDisplayNameCache.get(appPath)
    if (cachedName) {
      return cachedName
    }

    const resolved = await this.resolveDarwinAppDisplayName(appPath)
    if (resolved) {
      this.setCachedAppDisplayName(appPath, resolved)
      this.schedulePersistDarwinCache()
      return resolved
    }

    return fallbackName
  }

  private async resolveDarwinAppDisplayName(appPath: string): Promise<string | undefined> {
    try {
      const rawDisplayName = await this.execution.runQuickCommand(
        'mdls',
        ['-name', 'kMDItemDisplayName', '-raw', appPath],
        1500
      )
      const normalized = this.normalizeMdlsValue(rawDisplayName)
      return normalized || undefined
    } catch {
      return undefined
    }
  }

  private normalizeMdlsValue(value: string): string {
    const trimmed = value.trim()
    if (!trimmed || trimmed === '(null)' || trimmed === 'null') {
      return ''
    }

    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed)
        return typeof parsed === 'string' ? parsed.trim() : ''
      } catch {
        // ignore JSON parse errors
      }
    }

    return trimmed
  }

  private setCachedAppDisplayName(appPath: string, name: string): void {
    if (this.appDisplayNameCache.has(appPath)) {
      this.appDisplayNameCache.delete(appPath)
    }
    this.appDisplayNameCache.set(appPath, name)

    while (this.appDisplayNameCache.size > 5000) {
      const oldestKey = this.appDisplayNameCache.keys().next().value as string | undefined
      if (!oldestKey) break
      this.appDisplayNameCache.delete(oldestKey)
    }
  }
}
