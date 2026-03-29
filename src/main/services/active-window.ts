/**
 * 跨平台获取系统前台活跃窗口信息
 *
 * - macOS: 通过 osascript 调用 AppleScript
 * - Windows: 通过 Koffi FFI 直接调用 user32.dll / kernel32.dll（亚毫秒级）
 * - Linux: 通过 xdotool + xprop
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** 系统前台窗口信息 */
export interface ActiveWindowInfo {
  /** 应用名称 (如 "Safari", "Visual Studio Code") */
  app: string
  /** 窗口标题 */
  title: string
  /** 进程 ID */
  pid?: number
  /** macOS Bundle ID (如 "com.apple.Safari") */
  bundleId?: string
}

// --- 缓存 ---
let cachedResult: ActiveWindowInfo | null = null
let cachedAt = 0
const CACHE_TTL_MS = 500

/**
 * 获取当前系统前台活跃窗口信息
 *
 * 结果缓存 500ms，避免搜索过程中频繁调用系统命令。
 */
export async function getActiveWindow(): Promise<ActiveWindowInfo | null> {
  const now = Date.now()
  if (cachedResult && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedResult
  }

  try {
    const result = await getActiveWindowPlatform()
    cachedResult = result
    cachedAt = now
    return result
  } catch (error) {
    console.warn('[ActiveWindow] 获取前台窗口失败:', error)
    return null
  }
}

/**
 * 异步刷新活跃窗口缓存
 *
 * 在主窗口显示时调用一次，将结果缓存供搜索路径同步读取。
 * 这样搜索时不再需要等待外部进程（osascript/PowerShell）。
 */
export function refreshActiveWindowCache(): void {
  getActiveWindowPlatform()
    .then((result) => {
      cachedResult = result
      cachedAt = Date.now()
    })
    .catch(() => {
      // 刷新失败不影响搜索，保留旧缓存
    })
}

/**
 * 同步返回已缓存的活跃窗口信息
 *
 * 搜索热路径专用：直接返回缓存值，零等待。
 * 如果缓存为空（应用刚启动时），返回 null。
 */
export function getCachedActiveWindow(): ActiveWindowInfo | null {
  return cachedResult
}

/** 清除缓存（测试用） */
export function clearActiveWindowCache(): void {
  cachedResult = null
  cachedAt = 0
}

// --- 平台实现 ---

async function getActiveWindowPlatform(): Promise<ActiveWindowInfo | null> {
  switch (process.platform) {
    case 'darwin':
      return getActiveWindowMacOS()
    case 'win32':
      return getActiveWindowWindows()
    case 'linux':
      return getActiveWindowLinux()
    default:
      return null
  }
}

/**
 * macOS: 通过 AppleScript 获取前台应用信息
 *
 * 获取应用名称和 Bundle ID 不需要辅助功能权限。
 * 获取窗口标题需要"辅助功能"权限（System Events），
 * 如果权限不够则 title 为空字符串。
 */
async function getActiveWindowMacOS(): Promise<ActiveWindowInfo | null> {
  // 一次 osascript 调用获取所有信息，用分隔符分割
  const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set bundleId to bundle identifier of frontApp
  try
    set winTitle to name of front window of frontApp
  on error
    set winTitle to ""
  end try
  set pid to unix id of frontApp
  return appName & "|||" & bundleId & "|||" & winTitle & "|||" & pid
end tell`

  const { stdout } = await execFileAsync('osascript', ['-e', script], {
    timeout: 2000,
    encoding: 'utf8'
  })

  const parts = stdout.trim().split('|||')
  if (parts.length < 4) return null

  const [app, bundleId, title, pidStr] = parts
  const pid = parseInt(pidStr, 10)

  return {
    app: app || '',
    title: title || '',
    pid: isNaN(pid) ? undefined : pid,
    bundleId: bundleId || undefined
  }
}

/**
 * Windows: 通过 Koffi FFI 直接调用 user32.dll / kernel32.dll
 *
 * 零进程启动开销，亚毫秒级同步调用。
 * 替代旧方案（PowerShell + Add-Type C# 编译），彻底消除 3-8 秒冷启动延迟。
 */

// --- Win32 FFI 绑定（懒加载，仅 Windows 平台首次调用时初始化） ---

interface Win32Api {
  GetForegroundWindow: () => unknown
  GetWindowTextW: (hWnd: unknown, buf: Buffer, maxCount: number) => number
  GetWindowThreadProcessId: (hWnd: unknown, pidOut: unknown[]) => number
  OpenProcess: (access: number, inherit: number, pid: number) => unknown
  QueryFullProcessImageNameW: (hProcess: unknown, flags: number, buf: Buffer, sizeInout: unknown[]) => number
  CloseHandle: (handle: unknown) => number
  koffi: typeof import('koffi')
}

let _win32: Win32Api | null = null

function getWin32(): Win32Api {
  if (_win32) return _win32

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  _win32 = {
    // user32.dll
    GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ uint8_t *lpString, int nMaxCount)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'),

    // kernel32.dll — 用于获取进程可执行文件路径（替代 tasklist/Get-Process）
    OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)'),
    QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, _Out_ uint8_t *lpExeName, _Inout_ uint32_t *lpdwSize)'),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(void *hObject)'),

    koffi
  }

  return _win32
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

function getActiveWindowWindows(): ActiveWindowInfo | null {
  const api = getWin32()

  // 1. 获取前台窗口句柄
  const hWnd = api.GetForegroundWindow()
  if (!hWnd) return null

  // 2. 获取窗口标题（Unicode / UTF-16LE）
  const titleBuf = Buffer.alloc(512) // 256 chars × 2 bytes
  const titleLen = api.GetWindowTextW(hWnd, titleBuf, 256)
  const title = titleLen > 0
    ? api.koffi.decode(titleBuf, 'char16_t', titleLen) as string
    : ''

  // 3. 获取进程 ID
  const pidOut: unknown[] = [null]
  const tid = api.GetWindowThreadProcessId(hWnd, pidOut)
  const pid = pidOut[0] as number
  if (!tid || !pid) {
    return { app: '', title, pid: undefined }
  }

  // 4. 获取进程名（纯 FFI，无子进程）
  let app = ''
  const hProc = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
  if (hProc) {
    try {
      const pathBuf = Buffer.alloc(520 * 2) // MAX_PATH × 2
      const sizeInout: unknown[] = [520]
      const ok = api.QueryFullProcessImageNameW(hProc, 0, pathBuf, sizeInout)
      if (ok) {
        const pathLen = sizeInout[0] as number
        const fullPath = api.koffi.decode(pathBuf, 'char16_t', pathLen) as string
        // 从完整路径提取文件名（去除 .exe 后缀）
        const lastSep = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'))
        const fileName = lastSep >= 0 ? fullPath.slice(lastSep + 1) : fullPath
        app = fileName.replace(/\.exe$/i, '')
      }
    } finally {
      api.CloseHandle(hProc)
    }
  }

  return {
    app,
    title,
    pid: pid > 0 ? pid : undefined
  }
}

/**
 * Linux: 通过 xdotool 和 xprop 获取前台窗口信息
 */
async function getActiveWindowLinux(): Promise<ActiveWindowInfo | null> {
  try {
    // 获取活跃窗口 ID
    const { stdout: windowId } = await execFileAsync('xdotool', ['getactivewindow'], {
      timeout: 2000,
      encoding: 'utf8'
    })
    const wid = windowId.trim()
    if (!wid) return null

    // 获取窗口标题
    const { stdout: titleOut } = await execFileAsync('xdotool', ['getactivewindow', 'getwindowname'], {
      timeout: 2000,
      encoding: 'utf8'
    })

    // 获取窗口 PID
    const { stdout: pidOut } = await execFileAsync('xdotool', ['getactivewindow', 'getwindowpid'], {
      timeout: 2000,
      encoding: 'utf8'
    })

    // 获取 WM_CLASS（应用名称）
    const { stdout: classOut } = await execFileAsync('xprop', ['-id', wid, 'WM_CLASS'], {
      timeout: 2000,
      encoding: 'utf8'
    })

    // WM_CLASS 格式: WM_CLASS(STRING) = "instance", "ClassName"
    let app = ''
    const classMatch = classOut.match(/WM_CLASS\(STRING\)\s*=\s*"[^"]*",\s*"([^"]*)"/)
    if (classMatch) {
      app = classMatch[1]
    }

    const pid = parseInt(pidOut.trim(), 10)

    return {
      app,
      title: titleOut.trim(),
      pid: isNaN(pid) ? undefined : pid
    }
  } catch {
    return null
  }
}
