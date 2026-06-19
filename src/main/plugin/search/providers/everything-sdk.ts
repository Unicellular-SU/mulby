import * as koffi from 'koffi'
import { existsSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'

/**
 * Everything SDK 进程内 IPC 封装。
 *
 * 取代 es.exe 子进程：通过 koffi 直接调用 Everything64.dll / Everything32.dll，
 * 经命名管道 IPC 与常驻的 Everything 服务通信。相比 es.exe CLI：
 *   - 零进程派生（无 cmd.exe + chcp + es.exe 三段冷启动）；
 *   - 文件名 / 路径 / 大小 / 目录属性全部直接来自 Everything 内存索引，无需逐条 statSync 回磁盘。
 *
 * DLL 需放置于 resources/bin/（随 es-*.exe 一同由 electron-builder extraResources 打包到 <resources>/bin）。
 * 缺失 DLL、非 x64/ia32 架构、或 Everything 服务未运行（IPC 失败）时返回 null，
 * 调用方据此回退到 es.exe / Windows Search。
 *
 * 线程模型：所有调用同步执行于主进程。Everything 查询为本地内存索引的 IPC 往返（个位数毫秒），
 * 远低于旧实现的进程派生 + 数十次 statSync 开销；JS 单线程保证 SetSearch→Query→GetResult 序列原子，无需加锁。
 */

// Everything_SetRequestFlags 位标志。
// 仅请求 文件名 / 路径 / 大小——三者均在 Everything 索引内，IPC 应答快。
// 刻意不请求 ATTRIBUTES：文件属性不在默认索引中，对大结果集查询会显著变慢
// （实测宽泛查询 +60ms）；文件/目录判定改用 Everything_IsFolderResult
// （基于索引的 folder 标志，已实测与属性位 100% 一致且零额外开销）。
const EVERYTHING_REQUEST_FILE_NAME = 0x00000001
const EVERYTHING_REQUEST_PATH = 0x00000002
const EVERYTHING_REQUEST_SIZE = 0x00000010
const REQUEST_FLAGS =
  EVERYTHING_REQUEST_FILE_NAME |
  EVERYTHING_REQUEST_PATH |
  EVERYTHING_REQUEST_SIZE

// Everything_GetLastError 返回码
const EVERYTHING_OK = 0
const EVERYTHING_ERROR_IPC = 2 // 无法连接 Everything IPC 窗口（服务未运行）

export interface EverythingRawResult {
  path: string
  name: string
  isDirectory: boolean
  size: number
}

interface EverythingApi {
  SetSearchW: (lpSearchString: string) => number
  SetRequestFlags: (dwRequestFlags: number) => void
  SetMatchCase: (bEnable: number) => void
  SetMatchWholeWord: (bEnable: number) => void
  SetRegex: (bEnable: number) => void
  SetMax: (dwMax: number) => void
  QueryW: (bWait: number) => number
  GetLastError: () => number
  GetNumResults: () => number
  GetResultFileNameW: (nIndex: number) => string | null
  GetResultPathW: (nIndex: number) => string | null
  IsFolderResult: (nIndex: number) => number
  GetResultSize: (nIndex: number, lpSize: Buffer) => number
}

function joinWindowsPath(folder: string, name: string): string {
  if (!folder) return name
  return folder.endsWith('\\') ? folder + name : `${folder}\\${name}`
}

export class EverythingSdk {
  private api: EverythingApi | null = null
  private loadFailed = false
  // LARGE_INTEGER (int64) 输出缓冲，复用——所有调用同步串行，无并发写入风险。
  private readonly sizeBuffer = Buffer.alloc(8)

  /** Everything SDK DLL 是否已成功加载（不代表 Everything 服务正在运行）。 */
  isLoaded(): boolean {
    return this.ensureApi() !== null
  }

  /**
   * 执行一次 Everything 查询。
   * @returns
   *   - 数组（可能为空）：Everything 正常应答，结果可信，调用方直接使用；
   *   - null：DLL 不可用 / 架构不支持 / Everything 服务未运行（IPC 失败）→ 调用方应回退到 es.exe / Windows Search。
   */
  query(search: string, maxResults: number): EverythingRawResult[] | null {
    const api = this.ensureApi()
    if (!api) return null

    try {
      api.SetSearchW(search)
      api.SetRequestFlags(REQUEST_FLAGS)
      // 与 es.exe 默认行为对齐：不区分大小写、非全词、非正则、不强制匹配完整路径。
      api.SetMatchCase(0)
      api.SetMatchWholeWord(0)
      api.SetRegex(0)
      api.SetMax(maxResults > 0 ? maxResults : 1)

      const ok = api.QueryW(1)
      if (!ok) return null

      const lastError = api.GetLastError()
      // IPC 失败（Everything 未运行）回退；其它非 OK 状态同样保守回退。
      if (lastError !== EVERYTHING_OK) {
        if (lastError === EVERYTHING_ERROR_IPC) {
          log.info('[EverythingSDK] Everything service not running (IPC error), falling back to es.exe')
        }
        return null
      }

      const count = api.GetNumResults()
      const results: EverythingRawResult[] = []
      for (let i = 0; i < count; i++) {
        const name = api.GetResultFileNameW(i)
        if (!name) continue
        const folder = api.GetResultPathW(i) || ''

        const isDirectory = api.IsFolderResult(i) !== 0

        let size = 0
        if (!isDirectory && api.GetResultSize(i, this.sizeBuffer)) {
          const raw = this.sizeBuffer.readBigUInt64LE(0)
          size = raw > 0n ? Number(raw) : 0
        }

        results.push({
          path: joinWindowsPath(folder, name),
          name,
          isDirectory,
          size
        })
      }
      return results
    } catch (error) {
      log.warn('[EverythingSDK] query failed, will fall back:', error)
      return null
    }
  }

  private ensureApi(): EverythingApi | null {
    if (this.api) return this.api
    if (this.loadFailed) return null

    const dllPath = this.resolveDllPath()
    if (!dllPath) {
      this.loadFailed = true
      return null
    }

    try {
      const lib = koffi.load(dllPath)
      this.api = {
        SetSearchW: lib.func('uint32_t __stdcall Everything_SetSearchW(str16 lpSearchString)'),
        SetRequestFlags: lib.func('void __stdcall Everything_SetRequestFlags(uint32_t dwRequestFlags)'),
        SetMatchCase: lib.func('void __stdcall Everything_SetMatchCase(int bEnable)'),
        SetMatchWholeWord: lib.func('void __stdcall Everything_SetMatchWholeWord(int bEnable)'),
        SetRegex: lib.func('void __stdcall Everything_SetRegex(int bEnable)'),
        SetMax: lib.func('void __stdcall Everything_SetMax(uint32_t dwMax)'),
        QueryW: lib.func('int __stdcall Everything_QueryW(int bWait)'),
        GetLastError: lib.func('uint32_t __stdcall Everything_GetLastError()'),
        GetNumResults: lib.func('uint32_t __stdcall Everything_GetNumResults()'),
        GetResultFileNameW: lib.func('str16 __stdcall Everything_GetResultFileNameW(uint32_t nIndex)'),
        GetResultPathW: lib.func('str16 __stdcall Everything_GetResultPathW(uint32_t nIndex)'),
        IsFolderResult: lib.func('int __stdcall Everything_IsFolderResult(uint32_t nIndex)'),
        GetResultSize: lib.func('int __stdcall Everything_GetResultSize(uint32_t nIndex, _Out_ uint8_t *lpSize)')
      }
      log.info(`[EverythingSDK] loaded ${dllPath} — file search using in-process Everything IPC`)
      return this.api
    } catch (error) {
      log.warn('[EverythingSDK] failed to load Everything DLL, falling back to es.exe:', error)
      this.loadFailed = true
      this.api = null
      return null
    }
  }

  private resolveDllPath(): string | null {
    // Everything SDK 提供四种架构 DLL，与 Node process.arch 一一对应。
    const archToDll: Record<string, string> = {
      x64: 'Everything64.dll',
      ia32: 'Everything32.dll',
      arm64: 'EverythingARM64.dll',
      arm: 'EverythingARM.dll'
    }
    const dllName = archToDll[process.arch]
    if (!dllName) return null

    const baseDir = process.env.NODE_ENV === 'development'
      ? join(process.cwd(), 'resources', 'bin')
      : join(process.resourcesPath, 'bin')
    const dllPath = join(baseDir, dllName)
    return existsSync(dllPath) ? dllPath : null
  }
}
