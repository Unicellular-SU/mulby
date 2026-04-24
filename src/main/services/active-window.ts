/**
 * 跨平台获取系统前台活跃窗口信息
 *
 * - macOS: 通过 osascript 调用 AppleScript
 * - Windows: 通过 Koffi FFI 直接调用 user32.dll / kernel32.dll（亚毫秒级）
 * - Linux: 通过 xdotool + xprop
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log'

const execFileAsync = promisify(execFile)

/** 系统前台窗口信息 */
export interface ActiveWindowInfo {
  /** 应用名称 (如 "Safari", "Visual Studio Code") */
  app: string
  /** 窗口标题 (macOS 可能为空，按需或延迟获取) */
  title: string
  /** 进程 ID */
  pid?: number
  /** macOS Bundle ID (如 "com.apple.Safari") */
  bundleId?: string
}

type ActiveWindowChangeCallback = (info: ActiveWindowInfo) => void
const subscriptions = new Set<ActiveWindowChangeCallback>()

export function onActiveWindowChange(callback: ActiveWindowChangeCallback): () => void {
  subscriptions.add(callback)
  
  if (subscriptions.size === 1) {
    if (process.platform === 'darwin') {
      startMacOSNativeWatcher()
    } else if (process.platform === 'win32') {
      startWindowsPoller()
    }
  }

  return () => {
    subscriptions.delete(callback)
    if (subscriptions.size === 0) {
      if (process.platform === 'darwin') {
        stopMacOSNativeWatcher()
      } else if (process.platform === 'win32') {
        stopWindowsPoller()
      }
    }
  }
}

function notifySubscribers(info: ActiveWindowInfo) {
  // 使用 debug 级别避免高频日志刷屏
  if (process.env.NODE_ENV === 'development') {
    console.debug(`[ActiveWindow] Foreground Changed -> App: ${info.app} | PID: ${info.pid || 'N/A'} | Bundle: ${info.bundleId || 'N/A'} | Title: ${info.title || '<empty>'}`)
  }
  for (const sub of subscriptions) {
    try {
      sub(info)
    } catch (e) {
      log.error('[ActiveWindow] Callback error', e)
    }
  }
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
    log.warn('[ActiveWindow] 获取前台窗口失败:', error)
    return null
  }
}

/**
 * 异步刷新活跃窗口缓存
 * 已重构为：如果存在监听器，直接返回缓存；否则主动拉取一次。
 */
export function refreshActiveWindowCache(): void {
  getActiveWindowPlatform()
    .then((result) => {
      if (result) {
        cachedResult = result
        cachedAt = Date.now()
      }
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

import { subscribeNativeWindowChange } from './native-window-watcher'
let _macOSWatcherUnsub: (() => void) | null = null

/**
 * 判断是否为自身进程（Mulby 主窗口弹出后自身会变为前台应用，需要过滤）
 */
function isSelfProcess(pid: number | undefined): boolean {
  if (!pid) return false
  return pid === process.pid
}

function startMacOSNativeWatcher() {
  if (_macOSWatcherUnsub) return
  
  // 标题变化节流状态（仅用于 title 类型事件）
  let titleThrottleTimer: ReturnType<typeof setTimeout> | null = null
  const TITLE_THROTTLE_MS = 500

  try {
    _macOSWatcherUnsub = subscribeNativeWindowChange((info) => {
      // 过滤掉自身进程，我们只关心"唤醒前用户正在使用的应用"
      if (isSelfProcess(info.pid)) return

      const now = Date.now()
      const eventType = info.type || 'focus'

      // --- 标题变化事件：仅节流刷新缓存 ---
      // IDE 滚动文件列表可能导致高频 title 事件（~15ms/次），需要节流
      if (eventType === 'title') {
        if (titleThrottleTimer) return // 已有定时器，跳过
        titleThrottleTimer = setTimeout(() => {
          titleThrottleTimer = null
          // 异步获取最新标题，刷新缓存
          getActiveWindowMacOSUsingOsascript().then((fullInfo) => {
            if (fullInfo && !isSelfProcess(fullInfo.pid)) {
              const oldTitle = cachedResult?.title
              if (fullInfo.title && fullInfo.title !== oldTitle) {
                cachedResult = fullInfo
                cachedAt = Date.now()
                notifySubscribers(fullInfo)
              }
            }
          }).catch(() => {})
        }, TITLE_THROTTLE_MS)
        return
      }

      // --- 焦点切换 / 应用激活事件：始终立即通过 ---
      // 同一 app 的不同窗口切换（Cmd+`）会产生 focus 事件，不可丢弃
      const newCache: ActiveWindowInfo = {
        app: info.app,
        bundleId: info.bundleId,
        pid: info.pid,
        title: ''
      }
      cachedResult = newCache
      cachedAt = now
      notifySubscribers(newCache)
      
      // 异步补充 title
      getActiveWindowMacOSUsingOsascript().then((fullInfo) => {
        if (fullInfo && fullInfo.app === newCache.app && !isSelfProcess(fullInfo.pid)) {
          if (fullInfo.title && fullInfo.title !== newCache.title) {
            newCache.title = fullInfo.title
            cachedResult = newCache
            notifySubscribers(newCache)
          }
        }
      }).catch(() => {})
    })
  } catch (err) {
    log.warn('[ActiveWindow] Falling back to polling due to native addon failure.')
    startMacOSPoller()
  }
}

function stopMacOSNativeWatcher() {
  if (_macOSWatcherUnsub) {
    _macOSWatcherUnsub()
    _macOSWatcherUnsub = null
  }
  stopMacOSPoller()
}

let _macOSPollerInterval: NodeJS.Timeout | null = null
function startMacOSPoller() {
  if (_macOSPollerInterval) return
  _macOSPollerInterval = setInterval(() => {
    getActiveWindowMacOSUsingOsascript().then((info) => {
      if (info) {
        if (!cachedResult || cachedResult.app !== info.app || cachedResult.title !== info.title) {
          cachedResult = info
          cachedAt = Date.now()
          notifySubscribers(info)
        }
      }
    }).catch(() => {})
  }, 1000) // 1000ms polling for osascript fallback 
}

function stopMacOSPoller() {
  if (_macOSPollerInterval) {
    clearInterval(_macOSPollerInterval)
    _macOSPollerInterval = null
  }
}

let _winPollerInterval: NodeJS.Timeout | null = null
function startWindowsPoller() {
  if (_winPollerInterval) return
  _winPollerInterval = setInterval(() => {
    const info = getActiveWindowWindows()
    if (info) {
      if (!cachedResult || cachedResult.app !== info.app || cachedResult.title !== info.title) {
        cachedResult = info
        cachedAt = Date.now()
        notifySubscribers(info)
      }
    }
  }, 200) // 200ms 回退轮询，依赖 Koffi 高效读取
}
function stopWindowsPoller() {
  if (_winPollerInterval) {
    clearInterval(_winPollerInterval)
    _winPollerInterval = null
  }
}

/**
 * macOS: 通过原生扩展或 AppleScript 获取前台应用信息
 */
async function getActiveWindowMacOS(): Promise<ActiveWindowInfo | null> {
  // 由于有了缓存，通常能极速返回
  // 如果需要显式拉取，执行一遍
  return getActiveWindowMacOSUsingOsascript()
}

/**
 * 仅依赖 AppleScript 抓取全部信息 (title 有效)
 */
async function getActiveWindowMacOSUsingOsascript(): Promise<ActiveWindowInfo | null> {
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
  // koffi 是 Windows 平台可选依赖，macOS/Linux 上不存在
  koffi: any
}

let _win32: Win32Api | null = null

function getWin32(): Win32Api {
  if (_win32) return _win32

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const koffi = require('koffi')
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
