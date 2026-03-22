/**
 * 跨平台获取系统前台活跃窗口信息
 *
 * - macOS: 通过 osascript 调用 AppleScript
 * - Windows: 通过 PowerShell 获取前台窗口
 * - Linux: 通过 xdotool + xprop
 *
 * 零依赖方案，不需要安装任何 npm 原生模块。
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
 * Windows: 通过 PowerShell 获取前台窗口信息
 */
async function getActiveWindowWindows(): Promise<ActiveWindowInfo | null> {
  // 使用 PowerShell 获取前台窗口的进程名和标题
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][Win32]::GetWindowText($hwnd, $sb, 256)
$title = $sb.ToString()
$pid = 0
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid)
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
$name = if ($proc) { $proc.ProcessName } else { "" }
Write-Output "$name|||$title|||$pid"
`

  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
    timeout: 3000,
    encoding: 'utf8'
  })

  const parts = stdout.trim().split('|||')
  if (parts.length < 3) return null

  const [app, title, pidStr] = parts
  const pid = parseInt(pidStr, 10)

  return {
    app: app || '',
    title: title || '',
    pid: isNaN(pid) ? undefined : pid
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
