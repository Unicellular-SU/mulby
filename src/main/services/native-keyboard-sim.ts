/**
 * 跨平台原生零延迟键盘模拟（基于 koffi FFI）
 *
 * 替代 osascript / powershell / xdotool 等子进程调用方式，
 * 将 Ctrl/Cmd+C 等组合键模拟延迟从 ~200ms 降至 < 5ms。
 *
 * 三平台实现：
 * - macOS:  CoreGraphics CGEventCreateKeyboardEvent + CGEventPost
 * - Win32:  user32.dll SendInput
 * - Linux:  libxdo (xdotool 底层库)，失败时回退 execFile('xdotool', ...)
 */

import * as koffi from 'koffi'
import { execFile } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log'

const execFileAsync = promisify(execFile)

// ==================== 公共 API ====================

/**
 * 零延迟模拟按键组合（同步调用，无进程启动开销）
 *
 * @param modifiers 修饰键列表
 * @param key 主键名（小写），如 'c', 'v', 'a'
 * @returns 是否成功
 */
export function nativeSimulateKeyCombination(
  modifiers: ('ctrl' | 'cmd' | 'shift' | 'alt')[],
  key: string
): boolean {
  try {
    if (process.platform === 'darwin') {
      return darwinSimulateKeyCombination(modifiers, key)
    }
    if (process.platform === 'win32') {
      return win32SimulateKeyCombination(modifiers, key)
    }
    if (process.platform === 'linux') {
      return linuxSimulateKeyCombination(modifiers, key)
    }
    log.warn('[NativeKeySim] 不支持的平台:', process.platform)
    return false
  } catch (err) {
    log.error('[NativeKeySim] 模拟按键失败:', err)
    return false
  }
}

/** 便捷方法：模拟 Cmd+C (macOS) / Ctrl+C (Win/Linux) */
export function nativeSimulateCopy(): boolean {
  const mod = process.platform === 'darwin' ? 'cmd' : 'ctrl'
  return nativeSimulateKeyCombination([mod], 'c')
}

/** 便捷方法：模拟 Cmd+V (macOS) / Ctrl+V (Win/Linux) */
export function nativeSimulatePaste(): boolean {
  const mod = process.platform === 'darwin' ? 'cmd' : 'ctrl'
  return nativeSimulateKeyCombination([mod], 'v')
}

/**
 * 异步回退方案（当 koffi FFI 不可用时使用）
 * 延迟 ~150-300ms，但兼容性最佳
 */
export async function fallbackSimulateCopy(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('osascript', [
        '-e',
        'tell application "System Events" to keystroke "c" using command down'
      ])
      return true
    }
    if (process.platform === 'win32') {
      const script = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^c")'
      await execFileAsync('powershell', ['-NoProfile', '-Command', script])
      return true
    }
    // Linux
    await execFileAsync('xdotool', ['key', '--clearmodifiers', 'ctrl+c'])
    return true
  } catch (err) {
    log.error('[NativeKeySim] 回退模拟复制失败:', err)
    return false
  }
}

// ==================== macOS 实现 ====================

/**
 * macOS 键码映射 (CGKeyCode)
 * 与 native-input-hook.ts 中 MACOS_TO_VK 的反向映射
 */
const DARWIN_KEY_CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7,
  c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15,
  y: 16, t: 17, o: 31, u: 32, i: 34, p: 35, l: 37,
  j: 38, k: 40, n: 45, m: 46,
  '0': 29, '1': 18, '2': 19, '3': 20, '4': 21,
  '5': 23, '6': 22, '7': 26, '8': 28, '9': 25,
  space: 49, enter: 36, tab: 48, escape: 53,
  backspace: 51, delete: 117,
}

// CGEventFlags 修饰键掩码
const kCGEventFlagMaskShiftDarwin = 0x00020000
const kCGEventFlagMaskControlDarwin = 0x00040000
const kCGEventFlagMaskAlternateDarwin = 0x00080000
const kCGEventFlagMaskCommandDarwin = 0x00100000

// CGEventTapLocation
const kCGHIDEventTapDarwin = 0

interface DarwinSimApi {
  CGEventCreateKeyboardEvent: (source: null, virtualKey: number, keyDown: boolean) => unknown
  CGEventSetFlags: (event: unknown, flags: number) => void
  CGEventPost: (tap: number, event: unknown) => void
  CFRelease: (obj: unknown) => void
}

let _darwinSimApi: DarwinSimApi | null = null

function getDarwinSimApi(): DarwinSimApi {
  if (_darwinSimApi) return _darwinSimApi

  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')

  _darwinSimApi = {
    CGEventCreateKeyboardEvent: cg.func('void* CGEventCreateKeyboardEvent(void *source, uint16_t virtualKey, bool keyDown)'),
    CGEventSetFlags: cg.func('void CGEventSetFlags(void *event, uint64_t flags)'),
    CGEventPost: cg.func('void CGEventPost(uint32_t tap, void *event)'),
    CFRelease: cf.func('void CFRelease(void *cf)')
  }

  return _darwinSimApi
}

function darwinSimulateKeyCombination(modifiers: string[], key: string): boolean {
  const keyCode = DARWIN_KEY_CODES[key.toLowerCase()]
  if (keyCode === undefined) {
    log.warn(`[NativeKeySim] macOS 未知键名: "${key}"`)
    return false
  }

  const api = getDarwinSimApi()

  // 构建修饰键 flags
  let flags = 0
  for (const mod of modifiers) {
    switch (mod) {
      case 'cmd': flags |= kCGEventFlagMaskCommandDarwin; break
      case 'ctrl': flags |= kCGEventFlagMaskControlDarwin; break
      case 'alt': flags |= kCGEventFlagMaskAlternateDarwin; break
      case 'shift': flags |= kCGEventFlagMaskShiftDarwin; break
    }
  }

  // 按下
  const downEvent = api.CGEventCreateKeyboardEvent(null, keyCode, true)
  if (!downEvent) return false
  if (flags) api.CGEventSetFlags(downEvent, flags)
  api.CGEventPost(kCGHIDEventTapDarwin, downEvent)
  api.CFRelease(downEvent)

  // 释放
  const upEvent = api.CGEventCreateKeyboardEvent(null, keyCode, false)
  if (!upEvent) return false
  if (flags) api.CGEventSetFlags(upEvent, flags)
  api.CGEventPost(kCGHIDEventTapDarwin, upEvent)
  api.CFRelease(upEvent)

  return true
}

// ==================== Windows 实现 ====================

// SendInput 相关常量
const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002

// Windows Virtual Key Codes
const WIN32_VK_MAP: Record<string, number> = {
  a: 0x41, b: 0x42, c: 0x43, d: 0x44, e: 0x45,
  f: 0x46, g: 0x47, h: 0x48, i: 0x49, j: 0x4A,
  k: 0x4B, l: 0x4C, m: 0x4D, n: 0x4E, o: 0x4F,
  p: 0x50, q: 0x51, r: 0x52, s: 0x53, t: 0x54,
  u: 0x55, v: 0x56, w: 0x57, x: 0x58, y: 0x59, z: 0x5A,
  '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
  '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  space: 0x20, enter: 0x0D, tab: 0x09, escape: 0x1B,
  backspace: 0x08, delete: 0x2E,
}

const WIN32_MOD_VK: Record<string, number> = {
  ctrl: 0xA2,  // VK_LCONTROL
  cmd: 0xA2,   // Windows 上 cmd 映射为 Ctrl
  alt: 0xA4,   // VK_LMENU
  shift: 0xA0, // VK_LSHIFT
}

interface Win32SimApi {
  SendInput: (nInputs: number, pInputs: unknown, cbSize: number) => number
}

let _win32SimApi: Win32SimApi | null = null
let _win32InputType: unknown = null

function getWin32SimApi(): Win32SimApi & { inputType: unknown } {
  if (_win32SimApi && _win32InputType) return { ..._win32SimApi, inputType: _win32InputType }

  const user32 = koffi.load('user32.dll')

  // 定义 KEYBDINPUT 结构体
  koffi.struct('KEYBDINPUT', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr_t'
  })

  // 定义 INPUT 结构体（使用 union 模拟，仅用 keyboard）
  _win32InputType = koffi.struct('INPUT_KB', {
    type: 'uint32',
    ki: 'KEYBDINPUT',
    // union 的 padding（保证 sizeof(INPUT) = 40 on x64）
    _pad: koffi.array('uint8', 8)
  })

  _win32SimApi = {
    SendInput: user32.func('uint32_t __stdcall SendInput(uint32_t nInputs, INPUT_KB *pInputs, int cbSize)')
  }

  return { ..._win32SimApi, inputType: _win32InputType }
}

function win32SimulateKeyCombination(modifiers: string[], key: string): boolean {
  const vk = WIN32_VK_MAP[key.toLowerCase()]
  if (vk === undefined) {
    log.warn(`[NativeKeySim] Win32 未知键名: "${key}"`)
    return false
  }

  const api = getWin32SimApi()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputSize = (koffi as any).sizeof?.('INPUT_KB') ?? 40

  // 收集修饰键 VK
  const modVks: number[] = []
  for (const mod of modifiers) {
    const mvk = WIN32_MOD_VK[mod]
    if (mvk !== undefined) modVks.push(mvk)
  }

  // 构建 INPUT 数组：修饰键按下 → 主键按下 → 主键释放 → 修饰键释放
  const totalInputs = (modVks.length + 1) * 2
  const inputs: unknown[] = []

  // 修饰键按下
  for (const mvk of modVks) {
    inputs.push({
      type: INPUT_KEYBOARD,
      ki: { wVk: mvk, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 },
      _pad: new Array(8).fill(0)
    })
  }
  // 主键按下
  inputs.push({
    type: INPUT_KEYBOARD,
    ki: { wVk: vk, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 },
    _pad: new Array(8).fill(0)
  })
  // 主键释放
  inputs.push({
    type: INPUT_KEYBOARD,
    ki: { wVk: vk, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 },
    _pad: new Array(8).fill(0)
  })
  // 修饰键释放（反序）
  for (let i = modVks.length - 1; i >= 0; i--) {
    inputs.push({
      type: INPUT_KEYBOARD,
      ki: { wVk: modVks[i], wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 },
      _pad: new Array(8).fill(0)
    })
  }

  const sent = api.SendInput(totalInputs, inputs, inputSize)
  return sent === totalInputs
}

// ==================== Linux 实现 ====================

interface LinuxXdoApi {
  xdo_new: (display: null) => unknown
  xdo_send_keysequence_window: (xdo: unknown, window: number, keysequence: string, delay: number) => number
  xdo_free: (xdo: unknown) => void
}

let _linuxXdoApi: LinuxXdoApi | null = null
let _linuxXdoHandle: unknown = null
let _linuxXdoFailed = false

/** 尝试加载 libxdo（xdotool 底层 C 库） */
function getLinuxXdoApi(): (LinuxXdoApi & { handle: unknown }) | null {
  if (_linuxXdoFailed) return null
  if (_linuxXdoApi && _linuxXdoHandle) return { ..._linuxXdoApi, handle: _linuxXdoHandle }

  try {
    // 尝试多种库名
    let lib: ReturnType<typeof koffi.load> | null = null
    for (const name of ['libxdo.so.3', 'libxdo.so', 'libxdo.so.2']) {
      try {
        lib = koffi.load(name)
        break
      } catch {
        // 继续尝试下一个
      }
    }

    if (!lib) {
      _linuxXdoFailed = true
      log.warn('[NativeKeySim] Linux libxdo 加载失败，将回退到 xdotool 子进程')
      return null
    }

    _linuxXdoApi = {
      xdo_new: lib.func('void* xdo_new(void *display)'),
      xdo_send_keysequence_window: lib.func('int xdo_send_keysequence_window(void *xdo, uint64_t window, str keysequence, uint32_t delay)'),
      xdo_free: lib.func('void xdo_free(void *xdo)')
    }

    _linuxXdoHandle = _linuxXdoApi.xdo_new(null)
    if (!_linuxXdoHandle) {
      _linuxXdoFailed = true
      log.warn('[NativeKeySim] Linux xdo_new() 失败')
      return null
    }

    return { ..._linuxXdoApi, handle: _linuxXdoHandle }
  } catch (err) {
    _linuxXdoFailed = true
    log.warn('[NativeKeySim] Linux libxdo 初始化失败:', err)
    return null
  }
}

// Linux xdotool 键名映射
const LINUX_MOD_NAMES: Record<string, string> = {
  ctrl: 'ctrl',
  cmd: 'super',    // Linux 上 cmd 映射为 super
  alt: 'alt',
  shift: 'shift',
}

function linuxSimulateKeyCombination(modifiers: string[], key: string): boolean {
  // 构造 xdotool 格式的键序列，如 "ctrl+c"
  const parts = modifiers
    .map(m => LINUX_MOD_NAMES[m])
    .filter(Boolean)
  parts.push(key.toLowerCase())
  const keysequence = parts.join('+')

  // 尝试使用 libxdo（零延迟）
  const xdo = getLinuxXdoApi()
  if (xdo) {
    // CURRENT_WINDOW = 0 表示当前焦点窗口
    const ret = xdo.xdo_send_keysequence_window(xdo.handle, 0, keysequence, 0)
    return ret === 0
  }

  // 回退到 xdotool 子进程（异步，但同步包装）
  // 在调用方需要处理异步，这里标记失败让调用方使用 fallbackSimulateCopy
  console.debug('[NativeKeySim] Linux 使用 xdotool 回退路径')
  return false
}

// ==================== 资源清理 ====================

/**
 * 释放所有 FFI 资源（应用退出时调用）
 */
export function cleanupNativeKeySim(): void {
  if (_linuxXdoApi && _linuxXdoHandle) {
    try {
      _linuxXdoApi.xdo_free(_linuxXdoHandle)
    } catch { /* 忽略 */ }
    _linuxXdoHandle = null
  }
}
