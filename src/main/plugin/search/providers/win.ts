import { existsSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { isSystemSearchQueryEligible } from '../../../../shared/system-search'
import type {
  AppSearchResult,
  DesktopSearchProvider,
  FileSearchResult,
  SearchExecutionContext,
  SearchRankingContext
} from '../types'

const SEARCH_KEY_FILES = 'win-files'
const SEARCH_KEY_APPS = 'win-apps'
const SEARCH_KEY_FILES_FALLBACK = 'win-files-fallback'
const SEARCH_KEY_APPS_FALLBACK = 'win-apps-fallback'
const SEARCH_KEY_APPS_REGISTRY = 'win-apps-registry'
const SEARCH_KEY_APPS_APPX = 'win-apps-appx'

const CATALOG_TTL_MS = 10 * 60 * 1000

interface WindowsCatalogEntry extends AppSearchResult {
  aliases: string[]
}

export class WindowsSearchProvider implements DesktopSearchProvider {
  private catalogCache: { items: WindowsCatalogEntry[]; expiresAt: number } | null = null
  private catalogLoading: Promise<WindowsCatalogEntry[]> | null = null

  constructor(
    private readonly execution: SearchExecutionContext,
    private readonly ranking: SearchRankingContext
  ) {}

  warmupAppSearchIndex(): void {
    void this.getCatalog()
      .then(() => {
        // no-op
      })
      .catch(() => {
        // ignore warmup errors
      })
  }

  async searchFiles(query: string, limit: number): Promise<FileSearchResult[]> {
    const normalizedQuery = query.trim()
    this.execution.cancelSearchProcess(SEARCH_KEY_FILES)
    this.execution.cancelSearchProcess(SEARCH_KEY_FILES_FALLBACK)
    if (!isSystemSearchQueryEligible(normalizedQuery)) return []

    let paths: string[] = []
    try {
      const esPath = this.resolveEsPath()
      paths = await this.execution.runCommand(esPath, [normalizedQuery, '-n', String(Math.max(limit * 3, 60))], Math.max(limit * 3, 60), SEARCH_KEY_FILES)
    } catch {
      try {
        paths = await this.fallbackWindowsSearch(normalizedQuery, Math.max(limit * 3, 60), SEARCH_KEY_FILES_FALLBACK)
      } catch (fallbackError) {
        if (this.execution.isKilledProcessError(fallbackError)) {
          return []
        }
        console.error('windows file fallback failed:', fallbackError)
        return []
      }
    }

    const formatted: FileSearchResult[] = []
    for (const rawPath of paths) {
      const filePath = rawPath.trim()
      if (!filePath) continue
      try {
        const stats = statSync(filePath)
        const item: FileSearchResult = {
          name: basename(filePath),
          path: filePath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          source: 'everything'
        }
        item.score = this.ranking.scoreFile(item, normalizedQuery)
        formatted.push(item)
      } catch {
        // ignore invalid paths
      }
    }

    return formatted
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)
  }

  async searchApps(query: string, limit: number): Promise<AppSearchResult[]> {
    const normalizedQuery = query.trim()
    this.execution.cancelSearchProcess(SEARCH_KEY_APPS)
    this.execution.cancelSearchProcess(SEARCH_KEY_APPS_FALLBACK)
    this.execution.cancelSearchProcess(SEARCH_KEY_APPS_REGISTRY)
    this.execution.cancelSearchProcess(SEARCH_KEY_APPS_APPX)
    if (!isSystemSearchQueryEligible(normalizedQuery)) return []

    const quickLimit = Math.max(limit * 3, 90)
    let quickPaths: string[] = []

    try {
      const esPath = this.resolveEsPath()
      quickPaths = await this.execution.runCommand(esPath, [normalizedQuery, '-n', String(Math.max(limit * 4, 120))], Math.max(limit * 4, 120), SEARCH_KEY_APPS)
    } catch {
      try {
        quickPaths = await this.fallbackWindowsAppSearch(normalizedQuery, Math.max(limit * 4, 120))
      } catch (fallbackError) {
        if (this.execution.isKilledProcessError(fallbackError)) {
          return []
        }
        // ignore app fallback errors
      }
    }

    const quickEntries = this.formatPathEntries(quickPaths, 'everything')
    const quickResults = this.sortEntriesByQuery(quickEntries, normalizedQuery).slice(0, quickLimit)

    const catalog = await this.getCatalog()
    const catalogMatches = this.sortEntriesByQuery(catalog, normalizedQuery).slice(0, quickLimit)

    const merged = new Map<string, WindowsCatalogEntry>()
    for (const entry of [...quickResults, ...catalogMatches]) {
      const key = entry.path.toLowerCase()
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, entry)
        continue
      }
      if ((entry.score || 0) > (existing.score || 0)) {
        merged.set(key, entry)
      }
    }

    const finalResults = Array.from(merged.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)
      .map((entry) => ({
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        source: entry.source,
        score: entry.score
      }))

    return finalResults
  }

  private resolveEsPath(): string {
    const arch = process.arch
    const platformAppPath = process.env.NODE_ENV === 'development'
      ? join(process.cwd(), 'resources', 'bin')
      : join(process.resourcesPath, 'bin')

    const archSpecificName = `es-${arch}.exe`
    const archPath = join(platformAppPath, archSpecificName)
    if (existsSync(archPath)) {
      return archPath
    }

    const commonPath = join(platformAppPath, 'es.exe')
    if (existsSync(commonPath)) {
      return commonPath
    }

    return 'es'
  }

  private resolveKindFromPath(filePath: string): AppSearchResult['kind'] | null {
    const ext = extname(filePath).toLowerCase()
    if (ext === '.lnk') return 'shortcut'
    if (ext === '.exe') return 'executable'
    if (ext === '.appref-ms') return 'application'
    return null
  }

  private normalizeName(value: string): string {
    return value.trim().toLowerCase().normalize('NFKC')
  }

  private createCatalogEntry(name: string, filePath: string, kind: AppSearchResult['kind'], source: string): WindowsCatalogEntry {
    return {
      name,
      path: filePath,
      kind,
      source,
      aliases: [name]
    }
  }

  private formatPathEntries(paths: string[], source: string): WindowsCatalogEntry[] {
    const entries: WindowsCatalogEntry[] = []
    const seen = new Set<string>()

    for (const rawPath of paths) {
      const appPath = rawPath.trim()
      if (!appPath) continue
      const dedupeKey = appPath.toLowerCase()
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      if (!existsSync(appPath)) continue
      const kind = this.resolveKindFromPath(appPath)
      if (!kind) continue

      const name = this.ranking.normalizeAppDisplayName(basename(appPath))
      entries.push(this.createCatalogEntry(name, appPath, kind, source))
    }

    return entries
  }

  private scoreCatalogEntry(entry: WindowsCatalogEntry, query: string): number {
    const baseScore = this.ranking.scoreApp(entry, query, this.ranking.normalizeAppDisplayName(basename(entry.path)))
    let aliasScore = 0
    for (const alias of entry.aliases) {
      aliasScore = Math.max(aliasScore, this.ranking.scoreText(alias, query))
    }
    return Math.max(baseScore, aliasScore)
  }

  private sortEntriesByQuery(entries: WindowsCatalogEntry[], query: string): WindowsCatalogEntry[] {
    return entries
      .map((entry) => ({ ...entry, score: this.scoreCatalogEntry(entry, query) }))
      .filter((entry) => (entry.score || 0) > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
  }

  private async getCatalog(): Promise<WindowsCatalogEntry[]> {
    const now = Date.now()
    if (this.catalogCache && this.catalogCache.expiresAt > now) {
      return this.catalogCache.items
    }

    if (this.catalogLoading) {
      return this.catalogLoading
    }

    this.catalogLoading = this.buildCatalog()
      .then((items) => {
        this.catalogCache = {
          items,
          expiresAt: Date.now() + CATALOG_TTL_MS
        }
        return items
      })
      .finally(() => {
        this.catalogLoading = null
      })

    return this.catalogLoading
  }

  private buildCatalog(): Promise<WindowsCatalogEntry[]> {
    return Promise.resolve().then(async () => {
      const map = new Map<string, WindowsCatalogEntry>()

      for (const entry of this.collectStartMenuApps()) {
        map.set(entry.path.toLowerCase(), entry)
      }

      for (const entry of await this.collectRegistryApps()) {
        const key = entry.path.toLowerCase()
        const existing = map.get(key)
        if (!existing) {
          map.set(key, entry)
        } else {
          existing.aliases = Array.from(new Set([...existing.aliases, ...entry.aliases]))
          if (entry.name.length < existing.name.length) {
            existing.name = entry.name
          }
        }
      }

      const appxNames = await this.collectAppxNames()
      if (appxNames.length > 0) {
        this.attachAppxAliases(map, appxNames)
      }

      return Array.from(map.values())
    })
  }

  private collectStartMenuApps(): WindowsCatalogEntry[] {
    const roots = [
      join(process.env.ProgramData || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    ].filter((value) => value.length > 0 && existsSync(value))

    const entries: WindowsCatalogEntry[] = []
    const visited = new Set<string>()

    for (const root of roots) {
      const stack = [root]
      while (stack.length > 0) {
        const current = stack.pop() as string
        if (visited.has(current)) continue
        visited.add(current)

        let children
        try {
          children = readdirSync(current, { withFileTypes: true, encoding: 'utf8' })
        } catch {
          continue
        }

        for (const child of children) {
          const absolutePath = join(current, child.name)
          if (child.isDirectory()) {
            stack.push(absolutePath)
            continue
          }

          const kind = this.resolveKindFromPath(absolutePath)
          if (!kind) continue

          const name = this.ranking.normalizeAppDisplayName(basename(absolutePath))
          entries.push(this.createCatalogEntry(name, absolutePath, kind, 'start-menu'))
        }
      }
    }

    return entries
  }

  private parseRegistryPath(raw: string): string {
    let value = raw.trim().replace(/^"+|"+$/g, '')
    value = value.replace(/,\s*-?\d+\s*$/, '')

    value = value.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '')

    if (value.toLowerCase().startsWith('rundll32')) {
      return ''
    }

    return value
  }

  private async collectRegistryApps(): Promise<WindowsCatalogEntry[]> {
    const script = `
      $targets = @(
        "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
        "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
      )

      foreach ($target in $targets) {
        Get-ItemProperty -Path $target -ErrorAction SilentlyContinue |
          Where-Object { $_.DisplayName -and ($_.DisplayIcon -or $_.InstallLocation) } |
          ForEach-Object {
            $name = $_.DisplayName
            $icon = $_.DisplayIcon
            $location = $_.InstallLocation
            $candidate = $null

            if ($icon) {
              $candidate = ($icon -split ',')[0]
              $candidate = $candidate.Trim('"')
            }

            if (-not $candidate -and $location) {
              $probe = Join-Path $location ($name + '.exe')
              if (Test-Path $probe) {
                $candidate = $probe
              }
            }

            if ($name -and $candidate) {
              Write-Output "$name|||$candidate"
            }
          }
      }
    `

    let lines: string[] = []
    try {
      lines = await this.execution.runCommand(
        'powershell',
        ['-NoProfile', '-Command', script],
        4000,
        SEARCH_KEY_APPS_REGISTRY
      )
    } catch {
      return []
    }

    const entries: WindowsCatalogEntry[] = []
    const seen = new Set<string>()

    for (const line of lines) {
      const parts = line.split('|||')
      if (parts.length < 2) continue

      const name = parts[0].trim()
      const parsedPath = this.parseRegistryPath(parts.slice(1).join('|||'))
      if (!name || !parsedPath) continue
      if (!existsSync(parsedPath)) continue

      const kind = this.resolveKindFromPath(parsedPath)
      if (!kind) continue

      const dedupeKey = parsedPath.toLowerCase()
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      entries.push(this.createCatalogEntry(name, parsedPath, kind, 'registry'))
    }

    return entries
  }

  private async collectAppxNames(): Promise<string[]> {
    const script = 'Get-StartApps | ForEach-Object { Write-Output $_.Name }'

    try {
      const lines = await this.execution.runCommand(
        'powershell',
        ['-NoProfile', '-Command', script],
        3000,
        SEARCH_KEY_APPS_APPX
      )
      return lines.map((line) => line.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  private attachAppxAliases(map: Map<string, WindowsCatalogEntry>, names: string[]): void {
    const nameBuckets = new Map<string, WindowsCatalogEntry[]>()

    for (const entry of map.values()) {
      const key = this.normalizeName(entry.name)
      const bucket = nameBuckets.get(key)
      if (bucket) {
        bucket.push(entry)
      } else {
        nameBuckets.set(key, [entry])
      }
    }

    for (const appxName of names) {
      const normalized = this.normalizeName(appxName)
      if (!normalized) continue

      const direct = nameBuckets.get(normalized)
      if (direct && direct.length > 0) {
        direct.forEach((entry) => {
          if (!entry.aliases.includes(appxName)) {
            entry.aliases.push(appxName)
          }
        })
        continue
      }

      // 近似回填：尝试把 AppX 名称作为包含关系别名挂到相似条目上。
      for (const entry of map.values()) {
        const entryNorm = this.normalizeName(entry.name)
        if (!entryNorm) continue
        if (entryNorm.includes(normalized) || normalized.includes(entryNorm)) {
          if (!entry.aliases.includes(appxName)) {
            entry.aliases.push(appxName)
          }
          break
        }
      }
    }
  }

  private async fallbackWindowsSearch(query: string, limit: number, searchKey: string): Promise<string[]> {
    const safeQuery = query.replace(/'/g, "''")
    const script = `
      $query = "SELECT TOP ${limit} System.ItemPathDisplay FROM SystemIndex WHERE System.ItemName LIKE '%${safeQuery}%'"
      $provider = "Provider=Search.CollatorDSO;Extended Properties='Application=Windows';"
      $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($query, $provider)
      $ds = New-Object System.Data.DataSet
      $adapter.Fill($ds) | Out-Null
      if ($ds.Tables.Count -gt 0) {
        foreach ($row in $ds.Tables[0].Rows) {
          Write-Output $row["System.ItemPathDisplay"]
        }
      }
    `

    return this.execution.runCommand('powershell', ['-NoProfile', '-Command', script], limit, searchKey)
  }

  private async fallbackWindowsAppSearch(query: string, limit: number): Promise<string[]> {
    const safeQuery = query.replace(/'/g, "''")
    const script = `
      $targets = @(
        "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
        "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs"
      )
      $results = New-Object System.Collections.ArrayList
      foreach ($base in $targets) {
        if (-not (Test-Path $base)) { continue }
        Get-ChildItem -Path $base -Recurse -File -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -like '*${safeQuery}*' -and ($_.Extension -ieq '.lnk' -or $_.Extension -ieq '.exe' -or $_.Extension -ieq '.appref-ms') } |
          ForEach-Object {
            if ($results.Count -lt ${limit}) {
              [void]$results.Add($_.FullName)
            }
          }
      }
      foreach ($item in $results) { Write-Output $item }
    `

    return this.execution.runCommand('powershell', ['-NoProfile', '-Command', script], limit, SEARCH_KEY_APPS_FALLBACK)
  }
}
