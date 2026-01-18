import { spawn } from 'child_process'
import { platform } from 'os'
import { statSync, existsSync } from 'fs'
import { basename, join } from 'path'

export interface FileSearchResult {
    name: string
    path: string
    isDirectory: boolean
    size?: number
}

export class PluginDesktop {
    private currentSearchProcess: import('child_process').ChildProcess | null = null

    /**
     * 搜索系统文件
     * @param query 搜索关键词
     * @param limit 结果数量限制
     */
    async searchFiles(query: string, limit: number = 100): Promise<FileSearchResult[]> {
        // 取消上一次搜索
        if (this.currentSearchProcess) {
            try {
                this.currentSearchProcess.kill()
            } catch (e) {
                // ignore
            }
            this.currentSearchProcess = null
        }

        const os = platform()
        let results: string[] = []

        try {
            if (os === 'darwin') {
                // macOS: mdfind
                results = await this.runCommand('mdfind', ['-name', query], limit)
            } else if (os === 'win32') {
                // Windows 搜索策略：
                // 1. 优先尝试 Everything (es.exe)，包括全局和内置绿色版
                // 2. 如果 Everything 不可用，降级到 Windows Search
                try {
                    const esPath = this.resolveEsPath()
                    results = await this.runCommand(esPath, [query, '-n', limit.toString()], limit)
                } catch (e) {
                    console.log('[Desktop] Everything failed, trying fallback strategy...', e)

                    // 如果是服务未运行导致的失败，尝试启动内置 Everything 实例（暂未实现全自动服务管理，这通常需要提升的权限）
                    // 这里我们简单做：如果 es 失败，就降级到 Windows Search
                    // 只有当用户确实没有安装 Everything 且内置版也无法工作时才会走到这一步
                    console.log('[Desktop] Falling back to Windows Search...')
                    results = await this.fallbackWindowsSearch(query, limit)
                }
            } else if (os === 'linux') {
                // Linux: locate
                results = await this.runCommand('locate', ['-i', '-l', limit.toString(), query], limit)
            }
        } catch (error) {
            // 忽略被杀死的进程错误
            if (error instanceof Error && (error.message.includes('SIGTERM') || error.message.includes('SIGKILL'))) {
                return []
            }
            console.error('[Desktop] Search failed:', error)
            return []
        } finally {
            this.currentSearchProcess = null
        }

        // 格式化结果并补充基础信息
        return results
            .filter(p => p && p.trim().length > 0)
            .map(filePath => {
                try {
                    const cleanPath = filePath.trim()
                    const stats = statSync(cleanPath)
                    return {
                        name: basename(cleanPath),
                        path: cleanPath,
                        isDirectory: stats.isDirectory(),
                        size: stats.size
                    }
                } catch (e) {
                    return null
                }
            })
            .filter(item => item !== null) as FileSearchResult[]
    }

    /**
   * 获取 es.exe (Everything CLI) 的路径
   * 优先级:
   * 1. 开发/生产环境下的架构特定版本: es-{arch}.exe (如 es-x64.exe)
   * 2. 开发/生产环境下的通用版本: es.exe
   * 3. 全局 PATH 中的 es
   */
    private resolveEsPath(): string {
        const arch = process.arch // 'x64', 'ia32', 'arm64'
        const platformAppPath = process.env.NODE_ENV === 'development'
            ? join(process.cwd(), 'resources', 'bin')
            : join(process.resourcesPath, 'bin')

        // 1. 尝试架构特定版本 (es-x64.exe, es-ia32.exe, es-arm64.exe)
        const archSpecificName = `es-${arch}.exe`
        const archPath = join(platformAppPath, archSpecificName)
        if (existsSync(archPath)) {
            return archPath
        }

        // 2. 尝试通用版本 (es.exe) - 通常建议使用 32位版本以兼容所有架构，或仅提供 64位
        const commonPath = join(platformAppPath, 'es.exe')
        if (existsSync(commonPath)) {
            return commonPath
        }

        // 3. 默认回退到全局命令
        return 'es'
    }

    /**
     * Fallback for Windows: Use PowerShell to query Windows Index via OLEDB
     */
    private async fallbackWindowsSearch(query: string, limit: number): Promise<string[]> {
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
        return this.runCommand('powershell', ['-Command', psScript], limit)
    }

    private runCommand(cmd: string, args: string[], limit: number): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const child = spawn(cmd, args)
            this.currentSearchProcess = child

            let output = ''
            let error = ''

            child.stdout.on('data', (data) => {
                const chunk = data.toString()
                output += chunk
                const match = output.match(/\n/g)
                if (match && match.length >= limit) {
                    child.kill()
                }
            })

            child.stderr.on('data', (data) => {
                error += data.toString()
            })

            child.on('error', (err) => {
                reject(err)
            })

            child.on('close', (code) => {
                if (code !== 0 && code !== null) {
                    // 如果被 kill (SIGTERM/SIGKILL)，通常 code 也是 null 或非0，视情况处理
                    // 这里我们假设如果不为0且非 locate 的 1，就是错误
                    // 注意：被 kill 也会触发 close
                    if (child.killed) {
                        // 被主动 kill，不视为错误
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

                const lines = output.split(/\r?\n/).filter(line => line.trim() !== '')
                resolve(lines.slice(0, limit))
            })
        })
    }
}

export const pluginDesktop = new PluginDesktop()
