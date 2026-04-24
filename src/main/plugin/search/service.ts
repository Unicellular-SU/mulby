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
import log from 'electron-log'

/**
 * Windows cmd.exe 参数引用（CreateProcess 前的一层包装）
 *
 * 规则参考 Microsoft CommandLineToArgvW：
 * - 不含空格和特殊字符：原样返回
 * - 含空格：用 `"` 包裹，内部 `"` 转义为 `""`，反斜杠按规则 double 化
 * - 含 cmd.exe 元字符（`&|<>^()`）：额外用 `^` 转义
 */
function quoteCmdArg(arg: string): string {
  if (arg === '') return '""'
  // 没有空格和特殊字符，直接返回
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg

  // 先处理反斜杠 + 引号：CreateProcess 解析规则
  let result = ''
  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i]
    if (ch === '"') {
      result += '\\"'
    } else if (ch === '\\') {
      // 反斜杠本身不需要转义，除非后面紧跟引号（循环下一次处理）
      result += '\\'
    } else {
      result += ch
    }
  }
  // 用双引号包裹
  result = `"${result}"`
  // cmd.exe 元字符需要在引号外再用 `^` 转义（避免 cmd.exe /c 拼接后重解析）
  // 此处由于已完全包含在双引号内，cmd.exe /s /c 会保留整体，不再处理。
  return result
}

export class DesktopSearchService implements SearchExecutionContext {
  /**
   * 在 Windows 上包装 spawn 调用：强制非 PowerShell 子进程使用 UTF-8 编码输出，
   * 解决 es.exe 等控制台程序默认使用系统 OEM 编码页（如 GBK）导致中文路径乱码的问题。
   * PowerShell 命令不走 cmd 包装（其脚本含 $|>&等 cmd 元字符），
   * 由调用方通过 wrapPsUtf8() 注入 [Console]::OutputEncoding = UTF8 处理。
   *
   * 实现要点（修订版）：
   * 1. 使用 `cmd.exe /d /s /c "<command>"`：/s 保留引号不做预处理，/d 忽略 AutoRun
   * 2. 手动对 cmd 与 args 做 CommandLineToArgvW 兼容的引用，防止含空格路径被拆分
   * 3. 启用 windowsVerbatimArguments，让 Node 直接把已拼接好的命令行交给 cmd.exe
   *    —— 这是 Node 官方推荐的 cmd.exe 交互方式
   */
  private spawnUtf8(cmd: string, args: string[]) {
    if (process.platform === 'win32' && !cmd.toLowerCase().includes('powershell')) {
      const quotedCmd = quoteCmdArg(cmd)
      const quotedArgs = args.map(quoteCmdArg).join(' ')
      const fullCommand = `chcp 65001>nul && ${quotedCmd}${quotedArgs ? ' ' + quotedArgs : ''}`
      return spawn('cmd.exe', ['/d', '/s', '/c', `"${fullCommand}"`], {
        stdio: ['ignore', 'pipe', 'pipe'] as const,
        windowsHide: true,
        windowsVerbatimArguments: true
      })
    }
    return spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] as const })
  }

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
      log.error('desktop file search failed:', error)
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
      log.error('desktop app search failed:', error)
      return []
    }
  }

  runCommand(cmd: string, args: string[], limit: number, searchKey: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = this.spawnUtf8(cmd, args)
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
      const child = this.spawnUtf8(cmd, args)
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
