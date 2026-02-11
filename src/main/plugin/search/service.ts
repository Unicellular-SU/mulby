import { ChildProcess, spawn } from 'child_process'
import { platform } from 'os'
import { SearchRanking } from './ranking'
import { DarwinSearchProvider } from './providers/darwin'
import { WindowsSearchProvider } from './providers/win'
import { LinuxSearchProvider } from './providers/linux'
import type {
  AppSearchResult,
  DesktopSearchProvider,
  FileSearchResult,
  SearchExecutionContext
} from './types'

export class DesktopSearchService implements SearchExecutionContext {
  private searchProcesses: Map<string, ChildProcess> = new Map()
  private ranking = new SearchRanking()

  private darwinProvider = new DarwinSearchProvider(this, this.ranking)
  private windowsProvider = new WindowsSearchProvider(this, this.ranking)
  private linuxProvider = new LinuxSearchProvider(this, this.ranking)

  private getProvider(): DesktopSearchProvider | null {
    const os = platform()
    if (os === 'darwin') return this.darwinProvider
    if (os === 'win32') return this.windowsProvider
    if (os === 'linux') return this.linuxProvider
    return null
  }

  warmupAppSearchIndex(): void {
    const provider = this.getProvider()
    provider?.warmupAppSearchIndex?.()
  }

  async searchFiles(query: string, limit: number = 100): Promise<FileSearchResult[]> {
    const provider = this.getProvider()
    if (!provider) return []

    try {
      return await provider.searchFiles(query, limit)
    } catch (error) {
      if (this.isKilledProcessError(error)) {
        return []
      }
      console.error('desktop file search failed:', error)
      return []
    }
  }

  async searchApps(query: string, limit: number = 30): Promise<AppSearchResult[]> {
    const provider = this.getProvider()
    if (!provider) return []

    try {
      return await provider.searchApps(query, limit)
    } catch (error) {
      if (this.isKilledProcessError(error)) {
        return []
      }
      console.error('desktop app search failed:', error)
      return []
    }
  }

  runCommand(cmd: string, args: string[], limit: number, searchKey: string): Promise<string[]> {
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

          if ((cmd === 'locate' || cmd === 'plocate' || cmd === 'find') && code === 1) {
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

  runQuickCommand(cmd: string, args: string[], timeoutMs: number = 1500): Promise<string> {
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

  cancelSearchProcess(searchKey: string): void {
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

  isKilledProcessError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.message.includes('SIGTERM') || error.message.includes('SIGKILL')
  }

  private clearSearchProcess(searchKey: string, current?: ChildProcess): void {
    const processRef = this.searchProcesses.get(searchKey)
    if (!processRef) return
    if (!current || processRef === current) {
      this.searchProcesses.delete(searchKey)
    }
  }
}

export const desktopSearchService = new DesktopSearchService()
