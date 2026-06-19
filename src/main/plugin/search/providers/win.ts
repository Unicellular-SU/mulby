import { existsSync, readdirSync, readFileSync } from 'fs'
import { stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { isSystemSearchQueryEligible } from '../../../../shared/system-search'
import { EverythingSdk, type EverythingRawResult } from './everything-sdk'
import type {
  AppSearchResult,
  DesktopSearchProvider,
  FileSearchResult,
  SearchExecutionContext,
  SearchRankingContext
} from '../types'
import log from 'electron-log'

const SEARCH_KEY_FILES = 'win-files'
const SEARCH_KEY_FILES_FALLBACK = 'win-files-fallback'
const SEARCH_KEY_APPS_REGISTRY = 'win-apps-registry'
const SEARCH_KEY_APPS_APPX = 'win-apps-appx'
const SEARCH_KEY_APPX_ICONS = 'win-appx-icons'

const CATALOG_TTL_MS = 10 * 60 * 1000

interface WindowsCatalogEntry extends AppSearchResult {
  aliases: string[]
}

export class WindowsSearchProvider implements DesktopSearchProvider {
  private catalogCache: { items: WindowsCatalogEntry[]; expiresAt: number } | null = null
  private catalogLoading: Promise<WindowsCatalogEntry[]> | null = null
  private readonly everything = new EverythingSdk()

  constructor(
    private readonly execution: SearchExecutionContext,
    private readonly ranking: SearchRankingContext
  ) {}

  warmupAppSearchIndex(): void {
    void this.getCatalog()
      .then((catalog) => {
        // catalog 构建完成后，预计算所有应用名的拼音索引
        const names: string[] = []
        for (const entry of catalog) {
          names.push(entry.name)
          if (entry.aliases) {
            names.push(...entry.aliases)
          }
        }
        this.ranking.preheatKeywordIndexes(names)
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

    // 候选池取 limit*3，给打分排序留足空间（与旧 es.exe 行为一致）。
    const candidatePool = Math.max(limit * 3, 60)

    // 首选：Everything SDK 进程内 IPC。无子进程派生，元数据（大小/目录属性）直接来自索引，无需 statSync。
    const sdkResults = this.everything.query(normalizedQuery, candidatePool)
    if (sdkResults) {
      return this.rankSdkResults(sdkResults, normalizedQuery, limit)
    }

    // 回退链：es.exe 子进程 → Windows Search (OleDB)。仅在 DLL 缺失 / 架构不支持 / Everything 未运行时走到。
    let paths: string[] = []
    try {
      const esPath = this.resolveEsPath()
      paths = await this.execution.runCommand(esPath, [normalizedQuery, '-n', String(candidatePool)], candidatePool, SEARCH_KEY_FILES)
    } catch {
      try {
        paths = await this.fallbackWindowsSearch(normalizedQuery, candidatePool, SEARCH_KEY_FILES_FALLBACK)
      } catch (fallbackError) {
        if (this.execution.isKilledProcessError(fallbackError)) {
          return []
        }
        log.error('windows file fallback failed:', fallbackError)
        return []
      }
    }

    return this.buildResultsFromPaths(paths, normalizedQuery, limit)
  }

  /** Everything SDK 结果已自带 name/path/size/isDirectory，只需打分排序后截断。 */
  private rankSdkResults(rawResults: EverythingRawResult[], query: string, limit: number): FileSearchResult[] {
    const formatted: FileSearchResult[] = []
    for (const raw of rawResults) {
      const item: FileSearchResult = {
        name: raw.name,
        path: raw.path,
        isDirectory: raw.isDirectory,
        size: raw.size,
        source: 'everything'
      }
      item.score = this.ranking.scoreFile(item, query)
      formatted.push(item)
    }
    return formatted
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)
  }

  /**
   * 回退路径（es.exe / Windows Search）只返回路径字符串，需补齐元数据。
   * 使用异步 stat 并发取元数据（Promise.allSettled），而非同步 statSync 串行阻塞主进程事件循环——
   * 这样即便走到回退链，也不会拖累插件 / 应用搜索的 IPC 应答。
   */
  private async buildResultsFromPaths(paths: string[], query: string, limit: number): Promise<FileSearchResult[]> {
    const statResults = await Promise.allSettled(
      paths.map(async (rawPath) => {
        const filePath = rawPath.trim()
        if (!filePath) throw new Error('empty path')
        const stats = await stat(filePath)
        const item: FileSearchResult = {
          name: basename(filePath),
          path: filePath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          source: 'everything'
        }
        item.score = this.ranking.scoreFile(item, query)
        return item
      })
    )

    const formatted: FileSearchResult[] = []
    for (const result of statResults) {
      if (result.status === 'fulfilled') {
        formatted.push(result.value)
      }
    }

    return formatted
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)
  }

  async searchApps(query: string, limit: number): Promise<AppSearchResult[]> {
    const normalizedQuery = query.trim()
    if (!isSystemSearchQueryEligible(normalizedQuery)) return []

    // 内存优先搜索：直接从 catalog 缓存匹配，零外部进程开销
    // catalog 由 warmupAppSearchIndex() 在启动时构建（开始菜单 + 注册表 + AppX）
    const catalog = await this.getCatalog()
    const results = this.sortEntriesByQuery(catalog, normalizedQuery).slice(0, limit)

    return results.map((entry) => ({
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      iconPath: entry.iconPath,
      source: entry.source,
      score: entry.score
    }))
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

  /**
   * 在 PowerShell 脚本前注入 UTF-8 编码设置，
   * 确保子进程 stdout 使用 UTF-8 而非系统默认 OEM/ANSI 编码页（如 GBK）。
   * 这样 Node.js 默认的 Buffer.toString('utf8') 就能正确解码中文等非 ASCII 字符。
   */
  private wrapPsUtf8(script: string): string {
    return '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' + script
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

      const appxApps = await this.collectAppxApps()
      if (appxApps.length > 0) {
        this.mergeAppxEntries(map, appxApps)
      }

      // 为 AppX 独立条目预解析 UWP Logo 图标路径
      await this.resolveAppxIconPaths(map)

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
    const script = this.wrapPsUtf8(`
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
    `)

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

  private async collectAppxApps(): Promise<{ name: string; appId: string }[]> {
    const script = this.wrapPsUtf8('Get-StartApps | ForEach-Object { Write-Output ("$($_.Name)|||$($_.AppID)") }')

    try {
      const lines = await this.execution.runCommand(
        'powershell',
        ['-NoProfile', '-Command', script],
        3000,
        SEARCH_KEY_APPS_APPX
      )
      const results: { name: string; appId: string }[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const sepIndex = trimmed.indexOf('|||')
        if (sepIndex < 0) continue
        const name = trimmed.slice(0, sepIndex).trim()
        const appId = trimmed.slice(sepIndex + 3).trim()
        if (name && appId) {
          results.push({ name, appId })
        }
      }
      return results
    } catch {
      return []
    }
  }

  private mergeAppxEntries(map: Map<string, WindowsCatalogEntry>, apps: { name: string; appId: string }[]): void {
    // 构建名称桶，用于快速匹配
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

    for (const { name: appxName, appId } of apps) {
      const normalized = this.normalizeName(appxName)
      if (!normalized) continue

      // 精确匹配：名称完全一致
      const direct = nameBuckets.get(normalized)
      if (direct && direct.length > 0) {
        direct.forEach((entry) => {
          if (!entry.aliases.includes(appxName)) {
            entry.aliases.push(appxName)
          }
        })
        continue
      }

      // 近似匹配：包含关系
      let matched = false
      for (const entry of map.values()) {
        const entryNorm = this.normalizeName(entry.name)
        if (!entryNorm) continue
        if (entryNorm.includes(normalized) || normalized.includes(entryNorm)) {
          if (!entry.aliases.includes(appxName)) {
            entry.aliases.push(appxName)
          }
          matched = true
          break
        }
      }

      // 无法匹配到现有条目 → 创建独立的 AppX catalog 条目
      if (!matched) {
        const appPath = `shell:AppsFolder\\${appId}`
        const key = appPath.toLowerCase()
        if (!map.has(key)) {
          map.set(key, this.createCatalogEntry(appxName, appPath, 'application', 'appx'))
        }
      }
    }
  }

  /**
   * 为 source === 'appx' 的 catalog 条目批量预解析 UWP Logo 图标路径。
   * 使用单次 PowerShell 获取 PackageFamilyName → InstallLocation 映射，
   * 再从 AppxManifest.xml 解析 Logo 路径，设置 iconPath。
   */
  private async resolveAppxIconPaths(map: Map<string, WindowsCatalogEntry>): Promise<void> {
    // 收集需要解析图标的 AppX 条目
    const appxEntries: { entry: WindowsCatalogEntry; familyName: string }[] = []
    for (const entry of map.values()) {
      if (entry.source !== 'appx') continue
      // AppID 格式: shell:AppsFolder\{PackageFamilyName}!{EntryPoint}
      const appId = entry.path.replace(/^shell:AppsFolder\\/, '')
      const bangIndex = appId.indexOf('!')
      const familyName = bangIndex > 0 ? appId.slice(0, bangIndex) : appId
      if (familyName) {
        appxEntries.push({ entry, familyName })
      }
    }

    if (appxEntries.length === 0) return

    // 单次 PowerShell 获取所有 AppX 包的 PackageFamilyName → InstallLocation
    const script = this.wrapPsUtf8('Get-AppxPackage | Where-Object { $_.InstallLocation } | ForEach-Object { Write-Output "$($_.PackageFamilyName)|||$($_.InstallLocation)" }')
    let lines: string[] = []
    try {
      lines = await this.execution.runCommand(
        'powershell',
        ['-NoProfile', '-Command', script],
        5000,
        SEARCH_KEY_APPX_ICONS
      )
    } catch {
      return
    }

    // 构建 PackageFamilyName → InstallLocation 映射
    const locationMap = new Map<string, string>()
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const sepIndex = trimmed.indexOf('|||')
      if (sepIndex < 0) continue
      const familyName = trimmed.slice(0, sepIndex).trim()
      const installLocation = trimmed.slice(sepIndex + 3).trim()
      if (familyName && installLocation) {
        locationMap.set(familyName.toLowerCase(), installLocation)
      }
    }

    // 为每个 AppX 条目解析 Logo 路径
    for (const { entry, familyName } of appxEntries) {
      const installLocation = locationMap.get(familyName.toLowerCase())
      if (!installLocation) continue

      const logoPath = this.findAppxLogoAsset(installLocation)
      if (logoPath) {
        entry.iconPath = logoPath
      }
    }
  }

  /**
   * 从 AppX 安装目录的 AppxManifest.xml 解析 Logo 路径，
   * 并查找实际的 scale 变体文件（.scale-200.png 等）。
   */
  private findAppxLogoAsset(installLocation: string): string | null {
    try {
      const manifestPath = join(installLocation, 'AppxManifest.xml')
      if (!existsSync(manifestPath)) return null

      const manifest = readFileSync(manifestPath, 'utf-8')

      // 优先查找 Square44x44Logo（小图标，适合列表显示），其次 Square150x150Logo，最后 Logo
      const logoPatterns = [
        /Square44x44Logo\s*=\s*"([^"]+)"/i,
        /Square150x150Logo\s*=\s*"([^"]+)"/i,
        /Logo\s*=\s*"([^"]+)"/i
      ]

      let relativeLogoPath: string | null = null
      for (const pattern of logoPatterns) {
        const match = manifest.match(pattern)
        if (match?.[1]) {
          relativeLogoPath = match[1].trim()
          break
        }
      }

      if (!relativeLogoPath) return null

      // Logo 路径形如 "Assets\StoreLogo.png"，实际文件可能是 scale 变体
      const logoDir = join(installLocation, dirname(relativeLogoPath))
      const logoBasename = basename(relativeLogoPath)
      const logoNameWithoutExt = logoBasename.replace(/\.[^.]+$/, '')
      const logoExt = extname(logoBasename) || '.png'

      // 直接路径
      const directPath = join(installLocation, relativeLogoPath)
      if (existsSync(directPath)) return directPath

      // 查找 scale 变体（优先高分辨率）
      const scaleVariants = [
        `${logoNameWithoutExt}.scale-200${logoExt}`,
        `${logoNameWithoutExt}.scale-150${logoExt}`,
        `${logoNameWithoutExt}.scale-100${logoExt}`,
        `${logoNameWithoutExt}.scale-400${logoExt}`,
        `${logoNameWithoutExt}.targetsize-256${logoExt}`,
        `${logoNameWithoutExt}.targetsize-48${logoExt}`,
        `${logoNameWithoutExt}.targetsize-32${logoExt}`,
        `${logoNameWithoutExt}.targetsize-24${logoExt}`
      ]

      if (existsSync(logoDir)) {
        for (const variant of scaleVariants) {
          const variantPath = join(logoDir, variant)
          if (existsSync(variantPath)) return variantPath
        }
      }

      return null
    } catch {
      return null
    }
  }

  private async fallbackWindowsSearch(query: string, limit: number, searchKey: string): Promise<string[]> {
    const safeQuery = query.replace(/'/g, "''")
    const script = this.wrapPsUtf8(`
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
    `)

    return this.execution.runCommand('powershell', ['-NoProfile', '-Command', script], limit, searchKey)
  }

}
