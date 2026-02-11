import { ChildProcess, spawn } from 'child_process'
import { platform } from 'os'
import { statSync, existsSync } from 'fs'
import { basename, extname, join } from 'path'

export interface FileSearchResult {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

export interface AppSearchResult {
  name: string
  path: string
  kind: 'application' | 'shortcut' | 'executable'
}

const SEARCH_KEY_FILES = 'files'
const SEARCH_KEY_APPS = 'apps'

export class PluginDesktop {
  private searchProcesses: Map<string, ChildProcess> = new Map()
  private appDisplayNameCache: Map<string, string> = new Map()

  /**
   * 搜索系统文件
   * @param query 搜索关键词
   * @param limit 结果数量限制
   */
  async searchFiles(query: string, limit: number = 100): Promise<FileSearchResult[]> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []

    this.cancelSearchProcess(SEARCH_KEY_FILES)

    const os = platform()
    let results: string[] = []

    try {
      if (os === 'darwin') {
        // macOS: Spotlight
        results = await this.runCommand('mdfind', ['-name', normalizedQuery], limit, SEARCH_KEY_FILES)
      } else if (os === 'win32') {
        // Windows: 优先 Everything，其次 Windows Search 索引
        try {
          const esPath = this.resolveEsPath()
          results = await this.runCommand(esPath, [normalizedQuery, '-n', limit.toString()], limit, SEARCH_KEY_FILES)
        } catch (error) {
          console.log('[Desktop] Everything failed, fallback to Windows Search', error)
          results = await this.fallbackWindowsSearch(normalizedQuery, limit, SEARCH_KEY_FILES)
        }
      } else if (os === 'linux') {
        // Linux: locate
        results = await this.runCommand('locate', ['-i', '-l', limit.toString(), normalizedQuery], limit, SEARCH_KEY_FILES)
      }
    } catch (error) {
      if (this.isKilledProcessError(error)) {
        return []
      }
      console.error('[Desktop] File search failed:', error)
      return []
    }

    return this.formatFileResults(results)
  }

  /**
   * 搜索系统应用
   * @param query 搜索关键词
   * @param limit 结果数量限制
   */
  async searchApps(query: string, limit: number = 30): Promise<AppSearchResult[]> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []

    this.cancelSearchProcess(SEARCH_KEY_APPS)

    const os = platform()
    let results: string[] = []

    try {
      if (os === 'darwin') {
        // macOS: Spotlight 全量检索后过滤 .app
        results = await this.runCommand(
          'mdfind',
          ['-name', normalizedQuery],
          Math.max(limit * 4, 40),
          SEARCH_KEY_APPS
        )
      } else if (os === 'win32') {
        // Windows: 优先 Everything，其次 Start Menu / 索引降级方案
        try {
          const esPath = this.resolveEsPath()
          results = await this.runCommand(
            esPath,
            [normalizedQuery, '-n', Math.max(limit * 4, 60).toString()],
            Math.max(limit * 4, 60),
            SEARCH_KEY_APPS
          )
        } catch (error) {
          console.log('[Desktop] Everything app search failed, fallback to Windows Search', error)
          results = await this.fallbackWindowsAppSearch(normalizedQuery, limit)
        }
      } else {
        // Linux: 暂未实现系统应用索引
        return []
      }
    } catch (error) {
      if (this.isKilledProcessError(error)) {
        return []
      }
      console.error('[Desktop] App search failed:', error)
      return []
    }

    return this.formatAppResults(results, limit, os)
  }

  /**
   * 获取 es.exe (Everything CLI) 的路径
   * 优先级:
   * 1. 开发/生产环境下的架构特定版本: es-{arch}.exe (如 es-x64.exe)
   * 2. 开发/生产环境下的通用版本: es.exe
   * 3. 全局 PATH 中的 es
   */
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

  private formatFileResults(results: string[]): FileSearchResult[] {
    const formatted: FileSearchResult[] = []

    for (const filePath of results) {
      if (!filePath || filePath.trim().length === 0) continue
      try {
        const cleanPath = filePath.trim()
        const stats = statSync(cleanPath)
        formatted.push({
          name: basename(cleanPath),
          path: cleanPath,
          isDirectory: stats.isDirectory(),
          size: stats.size
        })
      } catch {
        // ignore invalid paths
      }
    }

    return formatted
  }

  private async formatAppResults(results: string[], limit: number, os: NodeJS.Platform): Promise<AppSearchResult[]> {
    const appCandidates: Array<{ path: string; kind: AppSearchResult['kind'] }> = []
    const seen = new Set<string>()

    for (const rawPath of results) {
      const appPath = rawPath.trim()
      if (!appPath || seen.has(appPath) || !existsSync(appPath)) {
        continue
      }

      const ext = extname(appPath).toLowerCase()
      let kind: AppSearchResult['kind'] = 'application'
      let valid = false

      if (os === 'darwin') {
        valid = appPath.toLowerCase().endsWith('.app')
        kind = 'application'
      } else if (os === 'win32') {
        if (ext === '.lnk') {
          kind = 'shortcut'
          valid = true
        } else if (ext === '.exe') {
          kind = 'executable'
          valid = true
        } else if (ext === '.appref-ms') {
          kind = 'application'
          valid = true
        }
      }

      if (!valid) continue

      appCandidates.push({ path: appPath, kind })
      seen.add(appPath)

      if (appCandidates.length >= limit) {
        break
      }
    }

    if (appCandidates.length === 0) return []

    const appResults = await Promise.all(
      appCandidates.map(async ({ path: appPath, kind }) => {
        const name = await this.resolveAppDisplayName(appPath, os)
        return { name, path: appPath, kind }
      })
    )

    return appResults
  }

  private async resolveAppDisplayName(appPath: string, os: NodeJS.Platform): Promise<string> {
    const fallbackName = this.normalizeAppDisplayName(basename(appPath), os)
    if (os !== 'darwin') {
      return fallbackName
    }

    const cachedName = this.appDisplayNameCache.get(appPath)
    if (cachedName) {
      return cachedName
    }

    const resolved = await this.resolveDarwinAppDisplayName(appPath)
    const finalName = resolved || fallbackName
    this.setCachedAppDisplayName(appPath, finalName)
    return finalName
  }

  private async resolveDarwinAppDisplayName(appPath: string): Promise<string | undefined> {
    try {
      const rawDisplayName = await this.runQuickCommand('mdls', ['-name', 'kMDItemDisplayName', '-raw', appPath], 1500)
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
        // ignore JSON parse errors and fall back to raw string
      }
    }
    return trimmed
  }

  private setCachedAppDisplayName(appPath: string, name: string): void {
    if (this.appDisplayNameCache.has(appPath)) {
      this.appDisplayNameCache.delete(appPath)
    }
    this.appDisplayNameCache.set(appPath, name)
    while (this.appDisplayNameCache.size > 400) {
      const oldestKey = this.appDisplayNameCache.keys().next().value as string | undefined
      if (!oldestKey) break
      this.appDisplayNameCache.delete(oldestKey)
    }
  }

  private normalizeAppDisplayName(filename: string, os: NodeJS.Platform): string {
    if (os === 'darwin') {
      return filename.replace(/\.app$/i, '')
    }
    return filename
      .replace(/\.lnk$/i, '')
      .replace(/\.exe$/i, '')
      .replace(/\.appref-ms$/i, '')
  }

  private async fallbackWindowsSearch(query: string, limit: number, searchKey: string): Promise<string[]> {
    const safeQuery = query.replace(/'/g, "''")
    const psScript = `
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
    return this.runCommand('powershell', ['-Command', psScript], limit, searchKey)
  }

  private async fallbackWindowsAppSearch(query: string, limit: number): Promise<string[]> {
    const safeQuery = query.replace(/'/g, "''")
    const psScript = `
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
    return this.runCommand('powershell', ['-Command', psScript], limit, SEARCH_KEY_APPS)
  }

  private runCommand(cmd: string, args: string[], limit: number, searchKey: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args)
      this.searchProcesses.set(searchKey, child)

      let output = ''
      let error = ''
      let killedByLimit = false

      child.stdout.on('data', (data) => {
        const chunk = data.toString()
        output += chunk
        const lines = output.match(/\n/g)
        if (lines && lines.length >= limit) {
          killedByLimit = true
          child.kill()
        }
      })

      child.stderr.on('data', (data) => {
        error += data.toString()
      })

      child.on('error', (err) => {
        this.clearSearchProcess(searchKey, child)
        reject(err)
      })

      child.on('close', (code) => {
        this.clearSearchProcess(searchKey, child)

        const parsedLines = output.split(/\r?\n/).filter((line) => line.trim() !== '')

        if (child.killed && killedByLimit) {
          resolve(parsedLines.slice(0, limit))
          return
        }

        if (code !== 0 && code !== null) {
          if (child.killed) {
            resolve([])
            return
          }

          if (cmd === 'locate' && code === 1) {
            resolve([])
            return
          }

          if (output.trim() === '') {
            reject(new Error(`Command failed: ${cmd} ${error}`))
            return
          }
        }

        resolve(parsedLines.slice(0, limit))
      })
    })
  }

  private runQuickCommand(cmd: string, args: string[], timeoutMs: number = 1500): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args)
      let stdout = ''
      let stderr = ''
      let settled = false

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          child.kill()
        } catch {
          // ignore
        }
        reject(new Error(`Command timed out: ${cmd}`))
      }, timeoutMs)

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code !== 0 && code !== null) {
          reject(new Error(`Command failed: ${cmd} ${stderr}`))
          return
        }
        resolve(stdout)
      })
    })
  }

  private cancelSearchProcess(searchKey: string): void {
    const processRef = this.searchProcesses.get(searchKey)
    if (!processRef) return
    try {
      processRef.kill()
    } catch {
      // ignore
    } finally {
      this.searchProcesses.delete(searchKey)
    }
  }

  private clearSearchProcess(searchKey: string, current?: ChildProcess): void {
    const processRef = this.searchProcesses.get(searchKey)
    if (!processRef) return
    if (!current || processRef === current) {
      this.searchProcesses.delete(searchKey)
    }
  }

  private isKilledProcessError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.message.includes('SIGTERM') || error.message.includes('SIGKILL')
  }
}

export const pluginDesktop = new PluginDesktop()
