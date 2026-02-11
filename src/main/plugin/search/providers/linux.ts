import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { spawnSync } from 'child_process'
import type {
  AppSearchResult,
  DesktopSearchProvider,
  FileSearchResult,
  SearchExecutionContext,
  SearchRankingContext
} from '../types'

const SEARCH_KEY_FILES = 'linux-files'
const SEARCH_KEY_FILES_FALLBACK = 'linux-files-fallback'

const APP_CATALOG_TTL_MS = 10 * 60 * 1000

interface LinuxDesktopEntry {
  name: string
  exec: string
  icon?: string
  desktopFilePath: string
}

const DESKTOP_ENTRY_DIRS = [
  '/usr/share/applications',
  '/usr/local/share/applications',
  '/var/lib/snapd/desktop/applications',
  join(process.env.HOME || '', '.local/share/applications')
]

const ICON_THEME_DIRS = [
  '/usr/share/icons/ubuntu-mono-dark',
  '/usr/share/icons/ubuntu-mono-light',
  '/usr/share/icons/Yaru',
  '/usr/share/icons/hicolor',
  '/usr/share/icons/Adwaita',
  '/usr/share/icons/Humanity',
  join(process.env.HOME || '', '.local/share/icons')
]

const ICON_SIZES = ['512x512', '256x256', '128x128', '64x64', '48x48', '32x32', '24x24', 'scalable', '512', '256', '128', '64', '48', '32']
const ICON_TYPES = ['apps', 'categories', 'devices', 'mimetypes', 'legacy', 'actions', 'places', 'status', 'mimes']
const ICON_EXTS = ['.png', '.svg', '.xpm']

export class LinuxSearchProvider implements DesktopSearchProvider {
  private appCatalogCache: { items: AppSearchResult[]; expiresAt: number } | null = null
  private appCatalogLoading: Promise<AppSearchResult[]> | null = null
  private execResolveCache: Map<string, string> = new Map()

  constructor(
    private readonly execution: SearchExecutionContext,
    private readonly ranking: SearchRankingContext
  ) {}

  warmupAppSearchIndex(): void {
    void this.getAppCatalog()
      .then(() => {
        // no-op
      })
      .catch(() => {
        // ignore warmup errors
      })
  }

  async searchFiles(query: string, limit: number): Promise<FileSearchResult[]> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []

    this.execution.cancelSearchProcess(SEARCH_KEY_FILES)
    this.execution.cancelSearchProcess(SEARCH_KEY_FILES_FALLBACK)

    let paths: string[] = []

    try {
      paths = await this.execution.runCommand(
        'plocate',
        ['-i', '-l', String(Math.max(limit * 3, 90)), normalizedQuery],
        Math.max(limit * 3, 90),
        SEARCH_KEY_FILES
      )
    } catch {
      try {
        paths = await this.execution.runCommand(
          'locate',
          ['-i', '-l', String(Math.max(limit * 3, 90)), normalizedQuery],
          Math.max(limit * 3, 90),
          SEARCH_KEY_FILES
        )
      } catch {
        paths = await this.findFallback(normalizedQuery, Math.max(limit * 3, 90))
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
          source: 'locate'
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
    if (!normalizedQuery) return []

    const catalog = await this.getAppCatalog()

    const scored = catalog
      .map((item) => {
        const fallbackName = this.ranking.normalizeAppDisplayName(basename(item.path))
        const score = this.ranking.scoreApp(item, normalizedQuery, fallbackName)
        return { ...item, score }
      })
      .filter((item) => (item.score || 0) > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)

    return scored
  }

  private async findFallback(query: string, limit: number): Promise<string[]> {
    const home = process.env.HOME || ''
    const targetDirs = [
      join(home, 'Desktop'),
      join(home, 'Documents'),
      join(home, 'Downloads'),
      join(home, 'Pictures')
    ].filter((dir) => dir && existsSync(dir))

    if (targetDirs.length === 0) {
      return []
    }

    try {
      return await this.execution.runCommand(
        'find',
        [...targetDirs, '-maxdepth', '6', '-iname', `*${query}*`, '-print'],
        limit,
        SEARCH_KEY_FILES_FALLBACK
      )
    } catch {
      return []
    }
  }

  private async getAppCatalog(): Promise<AppSearchResult[]> {
    const now = Date.now()
    if (this.appCatalogCache && this.appCatalogCache.expiresAt > now) {
      return this.appCatalogCache.items
    }

    if (this.appCatalogLoading) {
      return this.appCatalogLoading
    }

    this.appCatalogLoading = this.buildAppCatalog()
      .then((items) => {
        this.appCatalogCache = {
          items,
          expiresAt: Date.now() + APP_CATALOG_TTL_MS
        }
        return items
      })
      .finally(() => {
        this.appCatalogLoading = null
      })

    return this.appCatalogLoading
  }

  private async buildAppCatalog(): Promise<AppSearchResult[]> {
    const desktopSession = (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase()
    const desktopEntries = this.readDesktopEntries(desktopSession)

    const apps: AppSearchResult[] = []
    const seen = new Set<string>()

    for (const entry of desktopEntries) {
      const execPath = this.resolveExecPath(entry.exec)
      if (!execPath) continue
      if (!existsSync(execPath)) continue

      const key = execPath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      apps.push({
        name: entry.name,
        path: execPath,
        kind: 'application',
        iconPath: entry.icon ? this.resolveLinuxIconPath(entry.icon) || undefined : undefined,
        source: 'desktop-entry'
      })
    }

    return apps
  }

  private readDesktopEntries(desktopSession: string): LinuxDesktopEntry[] {
    const entries: LinuxDesktopEntry[] = []

    for (const baseDir of DESKTOP_ENTRY_DIRS) {
      if (!baseDir || !existsSync(baseDir)) continue

      const stack = [baseDir]
      while (stack.length > 0) {
        const current = stack.pop() as string

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

          if (extname(absolutePath).toLowerCase() !== '.desktop') {
            continue
          }

          const parsed = this.parseDesktopEntryFile(absolutePath, desktopSession)
          if (parsed) {
            entries.push(parsed)
          }
        }
      }
    }

    return entries
  }

  private parseDesktopEntryFile(filePath: string, desktopSession: string): LinuxDesktopEntry | null {
    let content = ''
    try {
      content = readFileSync(filePath, 'utf8')
    } catch {
      return null
    }

    const sectionMatch = content.match(/\[Desktop Entry\]([\s\S]*?)(\n\[[^\]]+\]|$)/)
    if (!sectionMatch) return null

    const section = sectionMatch[1]
    const fields = new Map<string, string>()

    const lines = section.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) continue
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim()
      fields.set(key, value)
    }

    const type = (fields.get('Type') || '').trim()
    if (type && type.toLowerCase() !== 'application') {
      return null
    }

    if ((fields.get('NoDisplay') || '').toLowerCase() === 'true') {
      return null
    }

    if (!this.isDesktopVisible(fields, desktopSession)) {
      return null
    }

    const localeName = this.getLocalizedName(fields)
    const name = localeName || fields.get('Name') || ''
    const exec = fields.get('Exec') || ''
    if (!name || !exec) {
      return null
    }

    return {
      name,
      exec,
      icon: fields.get('Icon') || undefined,
      desktopFilePath: filePath
    }
  }

  private getLocalizedName(fields: Map<string, string>): string {
    const lang = (process.env.LANG || '').split('.')[0]
    if (lang) {
      const exact = fields.get(`Name[${lang}]`)
      if (exact) return exact

      const shortLang = lang.split('_')[0]
      if (shortLang) {
        const short = fields.get(`Name[${shortLang}]`)
        if (short) return short
      }
    }
    return ''
  }

  private isDesktopVisible(fields: Map<string, string>, desktopSession: string): boolean {
    const normalizeList = (value: string | undefined): string[] => {
      if (!value) return []
      return value
        .split(';')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    }

    const onlyShowIn = normalizeList(fields.get('OnlyShowIn'))
    const notShowIn = normalizeList(fields.get('NotShowIn'))

    if (onlyShowIn.length > 0) {
      if (!desktopSession) {
        return false
      }
      const matched = onlyShowIn.some((desktop) => desktopSession.includes(desktop))
      if (!matched) {
        return false
      }
    }

    if (notShowIn.length > 0 && desktopSession) {
      const blocked = notShowIn.some((desktop) => desktopSession.includes(desktop))
      if (blocked) {
        return false
      }
    }

    return true
  }

  private resolveExecPath(execValue: string): string {
    const command = this.extractExecCommand(execValue)
    if (!command) return ''

    if (command.startsWith('/')) {
      return command
    }

    const cached = this.execResolveCache.get(command)
    if (cached !== undefined) {
      return cached
    }

    const whichResult = spawnSync('which', [command], { encoding: 'utf8' })
    let resolved = ''
    if (whichResult.status === 0) {
      const output = (whichResult.stdout || '').trim().split(/\r?\n/)[0]
      if (output) {
        resolved = output
      }
    }

    this.execResolveCache.set(command, resolved)
    return resolved
  }

  private extractExecCommand(execValue: string): string {
    const stripped = execValue
      .replace(/\s+%[A-Za-z]/g, ' ')
      .trim()
    if (!stripped) return ''

    const tokens = this.tokenizeExec(stripped)
    if (tokens.length === 0) return ''

    let index = 0
    if (tokens[0] === 'env') {
      index = 1
      while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) {
        index += 1
      }
    }

    const command = tokens[index] || ''
    return command.trim()
  }

  private tokenizeExec(value: string): string[] {
    const tokens: string[] = []
    let current = ''
    let quote: '"' | "'" | null = null

    for (let i = 0; i < value.length; i += 1) {
      const char = value[i]

      if (quote) {
        if (char === quote) {
          quote = null
          continue
        }
        if (char === '\\' && i + 1 < value.length) {
          current += value[i + 1]
          i += 1
          continue
        }
        current += char
        continue
      }

      if (char === '"' || char === "'") {
        quote = char
        continue
      }

      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current)
          current = ''
        }
        continue
      }

      current += char
    }

    if (current) {
      tokens.push(current)
    }

    return tokens
  }

  private resolveLinuxIconPath(iconValue: string): string {
    const trimmed = iconValue.trim()
    if (!trimmed) return ''

    if (trimmed.startsWith('/')) {
      return existsSync(trimmed) ? trimmed : ''
    }

    for (const themeDir of ICON_THEME_DIRS) {
      if (!existsSync(themeDir)) continue
      for (const size of ICON_SIZES) {
        for (const type of ICON_TYPES) {
          for (const ext of ICON_EXTS) {
            const candidate1 = join(themeDir, size, type, `${trimmed}${ext}`)
            if (existsSync(candidate1)) return candidate1
            const candidate2 = join(themeDir, type, size, `${trimmed}${ext}`)
            if (existsSync(candidate2)) return candidate2
          }
        }
      }
    }

    const pixmapPng = join('/usr/share/pixmaps', `${trimmed}.png`)
    if (existsSync(pixmapPng)) return pixmapPng

    return ''
  }
}
