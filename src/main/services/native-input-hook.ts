/**
 * 跨平台原生输入钩子（基于 koffi FFI）
 *
 * 替代 uiohook-napi，使用 koffi 直接调用系统原生 API：
 * - Windows: SetWindowsHookEx (WH_KEYBOARD_LL / WH_MOUSE_LL)
 *
 * 优势：
 * - 无预编译二进制依赖，跟随 koffi 版本自动兼容新 Node.js/Electron
 * - Electron 主进程已有消息泵，低级钩子回调自动触发
 * - 项目已使用 koffi（ActiveWindow 服务），零新增依赖
 */

import * as koffi from 'koffi'

// ==================== 事件接口 ====================

export interface NativeKeyEvent {
  vkCode: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export interface NativeMouseEvent {
  /** 鼠标按钮编号: 1=left, 2=right, 3=middle, 4=back(X1), 5=forward(X2) */
  button: number
  x: number
  y: number
}

export interface NativeInputHookCallbacks {
  onKeyDown?: (event: NativeKeyEvent) => void
  onKeyUp?: (event: NativeKeyEvent) => void
  onMouseDown?: (event: NativeMouseEvent) => void
  onMouseUp?: (event: NativeMouseEvent) => void
}

// ==================== 公共 API ====================

let _impl: NativeInputHookImpl | null = null

export function startNativeInputHook(callbacks: NativeInputHookCallbacks): boolean {
  if (_impl) return true // 已运行

  if (process.platform === 'win32') {
    _impl = createWin32InputHook(callbacks)
  } else if (process.platform === 'darwin') {
    _impl = createDarwinInputHook(callbacks)
  } else if (process.platform === 'linux') {
    _impl = createLinuxInputHook(callbacks)
  } else {
    console.warn('[NativeInputHook] 不支持的平台:', process.platform)
    return false
  }

  return _impl.start()
}

export function stopNativeInputHook(): void {
  if (_impl) {
    _impl.stop()
    _impl = null
  }
}

interface NativeInputHookImpl {
  start(): boolean
  stop(): void
}

// ==================== Windows 实现 ====================

// Hook 类型
const WH_KEYBOARD_LL = 13
const WH_MOUSE_LL = 14

// 键盘消息
const WM_KEYDOWN = 0x0100
const WM_KEYUP = 0x0101
const WM_SYSKEYDOWN = 0x0104
const WM_SYSKEYUP = 0x0105

// 鼠标消息
const WM_LBUTTONDOWN = 0x0201
const WM_LBUTTONUP = 0x0202
const WM_RBUTTONDOWN = 0x0204
const WM_RBUTTONUP = 0x0205
const WM_MBUTTONDOWN = 0x0207
const WM_MBUTTONUP = 0x0208
const WM_XBUTTONDOWN = 0x020B
const WM_XBUTTONUP = 0x020C

// X 按钮 (HIWORD of mouseData)
const XBUTTON1 = 1  // Back
const XBUTTON2 = 2  // Forward

// Virtual Key Codes - 按键判定用
const VK_LSHIFT = 0xA0
const VK_RSHIFT = 0xA1
const VK_LCONTROL = 0xA2
const VK_RCONTROL = 0xA3
const VK_LMENU = 0xA4  // Left Alt
const VK_RMENU = 0xA5  // Right Alt
const VK_LWIN = 0x5B
const VK_RWIN = 0x5C

// koffi 类型缓存
interface Win32HookApi {
  SetWindowsHookExW: (idHook: number, lpfn: unknown, hMod: unknown, dwThreadId: number) => unknown
  UnhookWindowsHookEx: (hhk: unknown) => number
  CallNextHookEx: (hhk: unknown, nCode: number, wParam: number, lParam: unknown) => number
  GetModuleHandleW: (lpModuleName: null) => unknown
  GetAsyncKeyState: (vKey: number) => number
  koffi: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

let _win32Api: Win32HookApi | null = null

function getWin32HookApi(): Win32HookApi {
  if (_win32Api) return _win32Api

  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  // 定义 KBDLLHOOKSTRUCT
  koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32',
    scanCode: 'uint32',
    flags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr_t'
  })

  // 定义 POINT
  koffi.struct('POINT', {
    x: 'long',
    y: 'long'
  })

  // 定义 MSLLHOOKSTRUCT
  koffi.struct('MSLLHOOKSTRUCT', {
    pt: 'POINT',
    mouseData: 'uint32',
    flags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr_t'
  })

  // 定义钩子回调原型 (HOOKPROC)
  // LRESULT CALLBACK LowLevelProc(int nCode, WPARAM wParam, LPARAM lParam)
  // 键盘钩子：使用通用原型接收 raw pointer，手动 decode 结构体
  // （koffi 对 typed struct 指针的回调参数 marshalling 可能有兼容问题）
  koffi.proto('int64_t __stdcall LowLevelKeyboardProc(int nCode, uintptr_t wParam, void *lParam)')
  koffi.proto('int64_t __stdcall LowLevelMouseProc(int nCode, uintptr_t wParam, void *lParam)')

  _win32Api = {
    SetWindowsHookExW: user32.func('void* __stdcall SetWindowsHookExW(int idHook, void *lpfn, void *hMod, uint32_t dwThreadId)'),
    UnhookWindowsHookEx: user32.func('int __stdcall UnhookWindowsHookEx(void *hhk)'),
    CallNextHookEx: user32.func('int64_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)'),
    GetModuleHandleW: kernel32.func('void* __stdcall GetModuleHandleW(void *lpModuleName)'),
    GetAsyncKeyState: user32.func('short __stdcall GetAsyncKeyState(int vKey)'),
    koffi
  }

  return _win32Api
}

/** 检查修饰键状态（通过 GetAsyncKeyState） */
function getModifierState(api: Win32HookApi): { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean } {
  // GetAsyncKeyState 返回值的最高位（bit 15）为 1 表示按键按下
  const isDown = (vk: number) => (api.GetAsyncKeyState(vk) & 0x8000) !== 0

  return {
    altKey: isDown(VK_LMENU) || isDown(VK_RMENU),
    ctrlKey: isDown(VK_LCONTROL) || isDown(VK_RCONTROL),
    metaKey: isDown(VK_LWIN) || isDown(VK_RWIN),
    shiftKey: isDown(VK_LSHIFT) || isDown(VK_RSHIFT)
  }
}

/** 将鼠标消息转换为按钮编号 */
function mouseMessageToButton(wParam: number, mouseData: number): { button: number; isDown: boolean } | null {
  switch (wParam) {
    case WM_LBUTTONDOWN: return { button: 1, isDown: true }
    case WM_LBUTTONUP: return { button: 1, isDown: false }
    case WM_RBUTTONDOWN: return { button: 2, isDown: true }
    case WM_RBUTTONUP: return { button: 2, isDown: false }
    case WM_MBUTTONDOWN: return { button: 3, isDown: true }
    case WM_MBUTTONUP: return { button: 3, isDown: false }
    case WM_XBUTTONDOWN: {
      const xButton = (mouseData >>> 16) & 0xFFFF
      return { button: xButton === XBUTTON1 ? 4 : xButton === XBUTTON2 ? 5 : 0, isDown: true }
    }
    case WM_XBUTTONUP: {
      const xButton = (mouseData >>> 16) & 0xFFFF
      return { button: xButton === XBUTTON1 ? 4 : xButton === XBUTTON2 ? 5 : 0, isDown: false }
    }
    default: return null
  }
}

function createWin32InputHook(callbacks: NativeInputHookCallbacks): NativeInputHookImpl {
  let kbHook: unknown = null
  let mouseHook: unknown = null
  let kbCallback: unknown = null
  let mouseCallback: unknown = null

  return {
    start(): boolean {
      try {
        const api = getWin32HookApi()
        const { koffi } = api

        // 获取模块句柄
        const hModule = api.GetModuleHandleW(null)

        // === 键盘钩子 ===
        // 使用 void* lParam + koffi.decode 手动解码结构体
        // （避免 koffi typed struct callback 参数的兼容问题）
        kbCallback = koffi.register(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (nCode: number, wParam: any, lParam: any) => {
            if (nCode >= 0) {
              try {
                // 手动从 raw pointer 解码 KBDLLHOOKSTRUCT
                // vkCode 是结构体的第一个 uint32 字段（偏移 0）
                const kbStruct = koffi.decode(lParam, 'KBDLLHOOKSTRUCT')
                const vkCode = kbStruct.vkCode as number
                const wParamNum = Number(wParam)
                const modifiers = getModifierState(api)

                if (wParamNum === WM_KEYDOWN || wParamNum === WM_SYSKEYDOWN) {
                  callbacks.onKeyDown?.({
                    vkCode,
                    ...modifiers
                  })
                } else if (wParamNum === WM_KEYUP || wParamNum === WM_SYSKEYUP) {
                  callbacks.onKeyUp?.({
                    vkCode,
                    ...modifiers
                  })
                }
              } catch (err) {
                console.error('[NativeInputHook] Keyboard callback error:', err)
              }
            }
            return api.CallNextHookEx(kbHook, nCode, wParam, lParam)
          },
          koffi.pointer('LowLevelKeyboardProc')
        )

        kbHook = api.SetWindowsHookExW(WH_KEYBOARD_LL, kbCallback, hModule, 0)
        if (!kbHook) {
          console.error('[NativeInputHook] SetWindowsHookEx(WH_KEYBOARD_LL) 失败')
          this.stop()
          return false
        }

        // === 鼠标钩子 ===
        // 同键盘钩子，使用 void* + koffi.decode 统一模式
        mouseCallback = koffi.register(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (nCode: number, wParam: any, lParam: any) => {
            if (nCode >= 0) {
              try {
                const wParamNum = Number(wParam)
                const msStruct = koffi.decode(lParam, 'MSLLHOOKSTRUCT')
                const x = (msStruct.pt?.x ?? 0) as number
                const y = (msStruct.pt?.y ?? 0) as number
                const mouseData = (msStruct.mouseData ?? 0) as number

                const result = mouseMessageToButton(wParamNum, mouseData)
                if (result && result.button > 0) {
                  const event: NativeMouseEvent = {
                    button: result.button,
                    x,
                    y
                  }
                  if (result.isDown) {
                    callbacks.onMouseDown?.(event)
                  } else {
                    callbacks.onMouseUp?.(event)
                  }
                }
              } catch (err) {
                console.error('[NativeInputHook] Mouse callback error:', err)
              }
            }
            return api.CallNextHookEx(mouseHook, nCode, wParam, lParam)
          },
          koffi.pointer('LowLevelMouseProc')
        )

        mouseHook = api.SetWindowsHookExW(WH_MOUSE_LL, mouseCallback, hModule, 0)
        if (!mouseHook) {
          console.error('[NativeInputHook] SetWindowsHookEx(WH_MOUSE_LL) 失败')
          this.stop()
          return false
        }

        console.log('[NativeInputHook] Win32 低级输入钩子已安装 (keyboard + mouse)')
        return true
      } catch (err) {
        console.error('[NativeInputHook] 启动失败:', err)
        this.stop()
        return false
      }
    },

    stop(): void {
      const api = _win32Api
      if (!api) return

      if (kbHook) {
        api.UnhookWindowsHookEx(kbHook)
        kbHook = null
      }
      if (mouseHook) {
        api.UnhookWindowsHookEx(mouseHook)
        mouseHook = null
      }
      if (kbCallback) {
        api.koffi.unregister(kbCallback)
        kbCallback = null
      }
      if (mouseCallback) {
        api.koffi.unregister(mouseCallback)
        mouseCallback = null
      }

      console.log('[NativeInputHook] Win32 低级输入钩子已卸载')
    }
  }
}

// ==================== macOS 实现 (CGEventTap via koffi) ====================

// macOS 事件类型
const kCGEventKeyDown = 10
const kCGEventKeyUp = 11
const kCGEventFlagsChanged = 12
const kCGEventLeftMouseDown = 1
const kCGEventLeftMouseUp = 2
const kCGEventRightMouseDown = 3
const kCGEventRightMouseUp = 4
const kCGEventOtherMouseDown = 25
const kCGEventOtherMouseUp = 26

// CGEventTap 自动禁用事件（系统可能因超时/用户操作禁用 tap）
const kCGEventTapDisabledByTimeout = 0xFFFFFFFE
const kCGEventTapDisabledByUserInput = 0xFFFFFFFF

// CGEventField
const kCGKeyboardEventKeycode = 9
const kCGMouseEventButtonNumber = 1

// CGEventFlags
const kCGEventFlagMaskShift = 0x00020000
const kCGEventFlagMaskControl = 0x00040000
const kCGEventFlagMaskAlternate = 0x00080000
const kCGEventFlagMaskCommand = 0x00100000

// CGEventTap 参数
const kCGHIDEventTap = 0
const kCGHeadInsertEventTap = 0
const kCGEventTapOptionListenOnly = 1

/**
 * macOS keycode → Windows VK Code 映射
 * 所有平台统一为 VK Code，使 DoubleTapDetector 等消费者代码无需关心平台差异
 */
const MACOS_TO_VK: Record<number, number> = {
  // 修饰键
  55: 0x5B, 54: 0x5C,   // Command L/R → VK_LWIN/VK_RWIN
  59: 0xA2, 62: 0xA3,   // Control L/R → VK_LCONTROL/VK_RCONTROL
  58: 0xA4, 61: 0xA5,   // Option L/R  → VK_LMENU/VK_RMENU
  56: 0xA0, 60: 0xA1,   // Shift L/R   → VK_LSHIFT/VK_RSHIFT
  // 功能键
  122: 0x70, 120: 0x71, 99: 0x72, 118: 0x73,  // F1-F4
  96: 0x74, 97: 0x75, 98: 0x76, 100: 0x77,    // F5-F8
  101: 0x78, 109: 0x79, 103: 0x7A, 111: 0x7B, // F9-F12
  // 特殊键
  49: 0x20, 36: 0x0D, 53: 0x1B, 48: 0x09,     // Space/Return/Escape/Tab
  51: 0x08, 117: 0x2E, 114: 0x2D,              // Backspace/Delete/Insert
  115: 0x24, 119: 0x23, 116: 0x21, 121: 0x22,  // Home/End/PageUp/PageDown
  126: 0x26, 125: 0x28, 123: 0x25, 124: 0x27,  // Up/Down/Left/Right
  // 字母 A-Z
  0: 0x41, 11: 0x42, 8: 0x43, 2: 0x44, 14: 0x45,
  3: 0x46, 5: 0x47, 4: 0x48, 34: 0x49, 38: 0x4A,
  40: 0x4B, 37: 0x4C, 46: 0x4D, 45: 0x4E, 31: 0x4F,
  35: 0x50, 12: 0x51, 15: 0x52, 1: 0x53, 17: 0x54,
  32: 0x55, 9: 0x56, 13: 0x57, 7: 0x58, 16: 0x59, 6: 0x5A,
  // 数字 0-9
  29: 0x30, 18: 0x31, 19: 0x32, 20: 0x33, 21: 0x34,
  23: 0x35, 22: 0x36, 26: 0x37, 28: 0x38, 25: 0x39,
}

interface DarwinHookApi {
  CGEventTapCreate: (...args: unknown[]) => unknown
  CFMachPortCreateRunLoopSource: (...args: unknown[]) => unknown
  CFRunLoopGetMain: () => unknown
  CFRunLoopAddSource: (...args: unknown[]) => void
  CFRunLoopRemoveSource: (...args: unknown[]) => void
  CGEventGetIntegerValueField: (event: unknown, field: number) => number
  CGEventGetFlags: (event: unknown) => number
  CGEventGetLocation: (event: unknown) => { x: number; y: number }
  CFMachPortInvalidate: (port: unknown) => void
  CFRelease: (obj: unknown) => void
  CFStringCreateWithCString: (alloc: null, str: string, encoding: number) => unknown
  CGEventTapEnable: (tap: unknown, enable: boolean) => void
  // koffi symbol 引用，需要通过 koffi.decode() 读取实际的 CFStringRef 指针
  kCFRunLoopCommonModesSymbol: unknown
  koffi: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

let _darwinApi: DarwinHookApi | null = null

function getDarwinHookApi(): DarwinHookApi {
  if (_darwinApi) return _darwinApi

  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')

  koffi.struct('CGPoint', { x: 'double', y: 'double' })

  // CGEventTapCallBack: 返回 CGEventRef，listen-only 模式下可返回原 event
  koffi.proto('void* CGEventTapCallback(void *proxy, uint32_t type, void *event, void *userInfo)')

  _darwinApi = {
    CGEventTapCreate: cg.func('void* CGEventTapCreate(uint32_t tap, uint32_t place, uint32_t options, uint64_t eventsOfInterest, void *callback, void *userInfo)'),
    CFMachPortCreateRunLoopSource: cf.func('void* CFMachPortCreateRunLoopSource(void *allocator, void *port, int order)'),
    CFRunLoopGetMain: cf.func('void* CFRunLoopGetMain()'),
    CFRunLoopAddSource: cf.func('void CFRunLoopAddSource(void *rl, void *source, void *mode)'),
    CFRunLoopRemoveSource: cf.func('void CFRunLoopRemoveSource(void *rl, void *source, void *mode)'),
    CGEventGetIntegerValueField: cg.func('int64_t CGEventGetIntegerValueField(void *event, uint32_t field)'),
    CGEventGetFlags: cg.func('uint64_t CGEventGetFlags(void *event)'),
    CGEventGetLocation: cg.func('CGPoint CGEventGetLocation(void *event)'),
    CFMachPortInvalidate: cf.func('void CFMachPortInvalidate(void *port)'),
    CFRelease: cf.func('void CFRelease(void *cf)'),
    CFStringCreateWithCString: cf.func('void* CFStringCreateWithCString(void *alloc, str s, uint32_t encoding)'),
    CGEventTapEnable: cg.func('void CGEventTapEnable(void *tap, bool enable)'),
    // kCFRunLoopCommonModes 是 CoreFoundation 导出的全局 CFStringRef 常量
    // lib.symbol() 返回符号引用对象（不可直接使用），须在使用时通过 koffi.decode() 读取实际值
    kCFRunLoopCommonModesSymbol: cf.symbol('kCFRunLoopCommonModes', 'void*'),
    koffi
  }

  return _darwinApi
}

/** macOS 修饰键状态（从 CGEventFlags 提取） */
function darwinModifiersFromFlags(flags: number): { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean } {
  return {
    altKey: (flags & kCGEventFlagMaskAlternate) !== 0,
    ctrlKey: (flags & kCGEventFlagMaskControl) !== 0,
    metaKey: (flags & kCGEventFlagMaskCommand) !== 0,
    shiftKey: (flags & kCGEventFlagMaskShift) !== 0,
  }
}

/** macOS 鼠标按钮编号转换 */
function darwinMouseButton(eventType: number, buttonNumber: number): { button: number; isDown: boolean } | null {
  switch (eventType) {
    case kCGEventLeftMouseDown: return { button: 1, isDown: true }
    case kCGEventLeftMouseUp: return { button: 1, isDown: false }
    case kCGEventRightMouseDown: return { button: 2, isDown: true }
    case kCGEventRightMouseUp: return { button: 2, isDown: false }
    case kCGEventOtherMouseDown:
      // buttonNumber: 2=middle, 3=back(X1), 4=forward(X2)
      return { button: buttonNumber === 2 ? 3 : buttonNumber === 3 ? 4 : buttonNumber === 4 ? 5 : 0, isDown: true }
    case kCGEventOtherMouseUp:
      return { button: buttonNumber === 2 ? 3 : buttonNumber === 3 ? 4 : buttonNumber === 4 ? 5 : 0, isDown: false }
    default: return null
  }
}

/** macOS 从 changed flags 推导修饰键 VK (防修饰键硬件 Keycode 0/255 的 Bug) */
function detectModifierVkCode(changed: number): number | null {
  // 先精确匹配左/右键特征位 (macOS 下 16 位是设备独立标识)
  if (changed & 0x08) return 0x5B   // VK_LWIN (Command L)
  if (changed & 0x10) return 0x5C   // VK_RWIN (Command R)
  if (changed & 0x00100000) return 0x5B // Command generic

  if (changed & 0x20) return 0xA4   // VK_LMENU (Option L)
  if (changed & 0x40) return 0xA5   // VK_RMENU (Option R)
  if (changed & 0x00080000) return 0xA4 // Option generic

  if (changed & 0x01) return 0xA2   // VK_LCONTROL (Control L)
  if (changed & 0x2000) return 0xA3 // VK_RCONTROL (Control R)
  if (changed & 0x00040000) return 0xA2 // Control generic

  if (changed & 0x02) return 0xA0   // VK_LSHIFT (Shift L)
  if (changed & 0x04) return 0xA1   // VK_RSHIFT (Shift R)
  if (changed & 0x00020000) return 0xA0 // Shift generic

  return null
}

function createDarwinInputHook(callbacks: NativeInputHookCallbacks): NativeInputHookImpl {
  let tapCallback: unknown = null
  let tap: unknown = null
  let source: unknown = null
  let commonModes: unknown = null
  let previousFlags = 0

  return {
    start(): boolean {
      try {
        const api = getDarwinHookApi()
        const { koffi } = api

        // 构建事件掩码（键盘 + 鼠标）
        const eventMask = BigInt(
          (1 << kCGEventKeyDown) |
          (1 << kCGEventKeyUp) |
          (1 << kCGEventFlagsChanged) |
          (1 << kCGEventLeftMouseDown) |
          (1 << kCGEventLeftMouseUp) |
          (1 << kCGEventRightMouseDown) |
          (1 << kCGEventRightMouseUp) |
          (1 << kCGEventOtherMouseDown) |
          (1 << kCGEventOtherMouseUp)
        )

        // 注册 CGEventTap 回调
        tapCallback = koffi.register(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (_proxy: any, type: number, event: any, _userInfo: any) => {
            try {
              // macOS 可能因回调处理超时或系统负载自动禁用 Event Tap，
              // 收到禁用事件后必须立即重新启用，否则 tap 永久失效
              if (type === kCGEventTapDisabledByTimeout || type === kCGEventTapDisabledByUserInput) {
                console.warn(`[NativeInputHook] macOS CGEventTap 被系统禁用 (type=0x${type.toString(16)})，正在重新启用...`)
                if (tap) {
                  api.CGEventTapEnable(tap, true)
                }
                return event
              }

              const flags = Number(api.CGEventGetFlags(event))
              const modifiers = darwinModifiersFromFlags(flags)

              if (type === kCGEventKeyDown || type === kCGEventKeyUp) {
                const macKeyCode = Number(api.CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode))
                const vkCode = MACOS_TO_VK[macKeyCode] ?? macKeyCode

                if (type === kCGEventKeyDown) {
                  callbacks.onKeyDown?.({ vkCode, ...modifiers })
                } else {
                  callbacks.onKeyUp?.({ vkCode, ...modifiers })
                }
              } else if (type === kCGEventFlagsChanged) {
                // 修饰键按下/释放：通过比较前后 flags 判断
                const changed = previousFlags ^ flags
                previousFlags = flags

                if (changed === 0) return event // 过滤冗余事件

                const macKeyCode = Number(api.CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode))

                // 从 changed bitmask 中推导修饰键（避免外接键盘/特殊映射时拿到 0 或无意义键码而打断双击逻辑）
                const synthVkCode = detectModifierVkCode(changed)
                const vkCode = synthVkCode ?? (MACOS_TO_VK[macKeyCode] ?? macKeyCode)

                // 判断是按下还是释放：如果对于产生改变的位，如果目标 flag 中有一个是 1 的说明是按下
                const isDown = ((flags & changed) !== 0)

                if (isDown) {
                  callbacks.onKeyDown?.({ vkCode, ...modifiers })
                } else {
                  callbacks.onKeyUp?.({ vkCode, ...modifiers })
                }
              } else {
                // 鼠标事件
                const buttonNumber = Number(api.CGEventGetIntegerValueField(event, kCGMouseEventButtonNumber))
                const result = darwinMouseButton(type, buttonNumber)
                if (result && result.button > 0) {
                  const loc = api.CGEventGetLocation(event)
                  const mouseEvent: NativeMouseEvent = {
                    button: result.button,
                    x: Math.round(loc.x),
                    y: Math.round(loc.y)
                  }
                  if (result.isDown) {
                    callbacks.onMouseDown?.(mouseEvent)
                  } else {
                    callbacks.onMouseUp?.(mouseEvent)
                  }
                }
              }
            } catch (err) {
              console.error('[NativeInputHook] macOS callback error:', err)
            }
            return event // listen-only: 返回原 event
          },
          koffi.pointer('CGEventTapCallback')
        )

        // 创建 Event Tap
        tap = api.CGEventTapCreate(
          kCGHIDEventTap,
          kCGHeadInsertEventTap,
          kCGEventTapOptionListenOnly,
          eventMask,
          tapCallback,
          null
        )

        if (!tap) {
          console.error('[NativeInputHook] CGEventTapCreate 失败（需要辅助功能权限）')
          this.stop()
          return false
        }

        // 获取苹果真实导出的 kCFRunLoopCommonModes 全局常量指针
        // lib.symbol() 返回的是引用对象，必须通过 koffi.decode() 解引用才能得到实际的 CFStringRef
        commonModes = koffi.decode(api.kCFRunLoopCommonModesSymbol, 'void*')

        // 添加到主 RunLoop
        source = api.CFMachPortCreateRunLoopSource(null, tap, 0)
        const mainLoop = api.CFRunLoopGetMain()
        api.CFRunLoopAddSource(mainLoop, source, commonModes)
        api.CGEventTapEnable(tap, true)

        previousFlags = 0
        console.log('[NativeInputHook] macOS CGEventTap 已安装 (keyboard + mouse)')
        return true
      } catch (err) {
        console.error('[NativeInputHook] macOS 启动失败:', err)
        this.stop()
        return false
      }
    },

    stop(): void {
      const api = _darwinApi
      if (!api) return

      if (source && commonModes) {
        try {
          const mainLoop = api.CFRunLoopGetMain()
          api.CFRunLoopRemoveSource(mainLoop, source, commonModes)
        } catch { /* ignore */ }
      }
      if (tap) {
        try { api.CFMachPortInvalidate(tap) } catch { /* ignore */ }
        try { api.CFRelease(tap) } catch { /* ignore */ }
        tap = null
      }
      if (source) {
        try { api.CFRelease(source) } catch { /* ignore */ }
        source = null
      }
      // 注意：commonModes 来自 kCFRunLoopCommonModes 全局常量，
      // 不可 CFRelease，否则会导致内存腐败和后续重启失败
      commonModes = null
      if (tapCallback) {
        api.koffi.unregister(tapCallback)
        tapCallback = null
      }

      console.log('[NativeInputHook] macOS CGEventTap 已卸载')
    }
  }
}

// ==================== Linux 实现 (/dev/input evdev) ====================

import * as fs from 'fs'

/**
 * Linux evdev key code → Windows VK Code 映射
 * 来源: linux/input-event-codes.h
 */
const LINUX_KEY_TO_VK: Record<number, number> = {
  // 修饰键
  29: 0xA2, 97: 0xA3,     // KEY_LEFTCTRL/KEY_RIGHTCTRL → VK_LCONTROL/VK_RCONTROL
  42: 0xA0, 54: 0xA1,     // KEY_LEFTSHIFT/KEY_RIGHTSHIFT → VK_LSHIFT/VK_RSHIFT
  56: 0xA4, 100: 0xA5,    // KEY_LEFTALT/KEY_RIGHTALT → VK_LMENU/VK_RMENU
  125: 0x5B, 126: 0x5C,   // KEY_LEFTMETA/KEY_RIGHTMETA → VK_LWIN/VK_RWIN
  // 功能键
  59: 0x70, 60: 0x71, 61: 0x72, 62: 0x73,  // F1-F4
  63: 0x74, 64: 0x75, 65: 0x76, 66: 0x77,  // F5-F8
  67: 0x78, 68: 0x79, 87: 0x7A, 88: 0x7B,  // F9-F12
  // 特殊键
  57: 0x20, 28: 0x0D, 1: 0x1B, 15: 0x09,   // Space/Enter/Escape/Tab
  14: 0x08, 111: 0x2E, 110: 0x2D,           // Backspace/Delete/Insert
  102: 0x24, 107: 0x23, 104: 0x21, 109: 0x22, // Home/End/PageUp/PageDown
  103: 0x26, 108: 0x28, 105: 0x25, 106: 0x27, // Up/Down/Left/Right
  // 字母
  30: 0x41, 48: 0x42, 46: 0x43, 32: 0x44, 18: 0x45,
  33: 0x46, 34: 0x47, 35: 0x48, 23: 0x49, 36: 0x4A,
  37: 0x4B, 38: 0x4C, 50: 0x4D, 49: 0x4E, 24: 0x4F,
  25: 0x50, 16: 0x51, 19: 0x52, 31: 0x53, 20: 0x54,
  22: 0x55, 47: 0x56, 17: 0x57, 45: 0x58, 21: 0x59, 44: 0x5A,
  // 数字
  11: 0x30, 2: 0x31, 3: 0x32, 4: 0x33, 5: 0x34,
  6: 0x35, 7: 0x36, 8: 0x37, 9: 0x38, 10: 0x39,
}

// Linux evdev 常量
const EV_KEY = 1
const BTN_LEFT = 0x110   // 272
const BTN_RIGHT = 0x111  // 273
const BTN_MIDDLE = 0x112 // 274
const BTN_SIDE = 0x113   // 275 (Back)
const BTN_EXTRA = 0x114  // 276 (Forward)
const INPUT_EVENT_SIZE = 24 // sizeof(struct input_event) on 64-bit Linux

/** 解析 /proc/bus/input/devices 查找键盘和鼠标设备 */
function findLinuxInputDevices(): { keyboards: string[]; mice: string[] } {
  const keyboards: string[] = []
  const mice: string[] = []

  try {
    const content = fs.readFileSync('/proc/bus/input/devices', 'utf8')
    const blocks = content.split('\n\n')

    for (const block of blocks) {
      const handlersMatch = block.match(/H: Handlers=(.+)/)
      if (!handlersMatch) continue

      const handlers = handlersMatch[1].trim()
      const eventMatch = handlers.match(/event(\d+)/)
      if (!eventMatch) continue

      const eventPath = `/dev/input/event${eventMatch[1]}`

      if (handlers.includes('kbd')) keyboards.push(eventPath)
      if (handlers.includes('mouse')) mice.push(eventPath)
    }
  } catch (err) {
    console.warn('[NativeInputHook] 无法读取 /proc/bus/input/devices:', (err as Error).message)
  }

  return { keyboards, mice }
}

/** Linux evdev 鼠标按钮映射 */
function linuxMouseButton(code: number): number {
  switch (code) {
    case BTN_LEFT: return 1
    case BTN_RIGHT: return 2
    case BTN_MIDDLE: return 3
    case BTN_SIDE: return 4
    case BTN_EXTRA: return 5
    default: return 0
  }
}

/** 跟踪 Linux 修饰键状态 */
class LinuxModifierTracker {
  private state = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }

  update(vkCode: number, isDown: boolean): void {
    switch (vkCode) {
      case 0xA0: case 0xA1: this.state.shiftKey = isDown; break
      case 0xA2: case 0xA3: this.state.ctrlKey = isDown; break
      case 0xA4: case 0xA5: this.state.altKey = isDown; break
      case 0x5B: case 0x5C: this.state.metaKey = isDown; break
    }
  }

  get(): { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean } {
    return { ...this.state }
  }
}

function createLinuxInputHook(callbacks: NativeInputHookCallbacks): NativeInputHookImpl {
  const streams: fs.ReadStream[] = []
  const modTracker = new LinuxModifierTracker()

  function handleEvent(type: number, code: number, value: number) {
    if (type !== EV_KEY) return

    // 鼠标按钮 (BTN_LEFT..BTN_EXTRA)
    if (code >= BTN_LEFT && code <= BTN_EXTRA) {
      const button = linuxMouseButton(code)
      if (button > 0) {
        // Linux evdev 不直接提供鼠标坐标，传递 (0,0)
        // 消费者可以通过 Electron screen.getCursorScreenPoint() 获取
        const event: NativeMouseEvent = { button, x: 0, y: 0 }
        if (value === 1) {
          callbacks.onMouseDown?.(event)
        } else if (value === 0) {
          callbacks.onMouseUp?.(event)
        }
      }
      return
    }

    // 键盘按键
    const vkCode = LINUX_KEY_TO_VK[code]
    if (vkCode === undefined) return // 未映射的键，忽略

    if (value === 1) {
      // 按下
      modTracker.update(vkCode, true)
      callbacks.onKeyDown?.({ vkCode, ...modTracker.get() })
    } else if (value === 0) {
      // 释放
      callbacks.onKeyUp?.({ vkCode, ...modTracker.get() })
      modTracker.update(vkCode, false)
    }
    // value === 2 是 repeat，忽略
  }

  return {
    start(): boolean {
      try {
        const { keyboards, mice } = findLinuxInputDevices()
        const allDevices = [...new Set([...keyboards, ...mice])]

        if (allDevices.length === 0) {
          console.warn('[NativeInputHook] Linux 未找到输入设备')
          return false
        }

        let openedCount = 0
        for (const devicePath of allDevices) {
          try {
            const stream = fs.createReadStream(devicePath, {
              highWaterMark: INPUT_EVENT_SIZE * 8,
            })

            let buffer = Buffer.alloc(0)

            stream.on('data', (chunk: string | Buffer) => {
              const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
              buffer = Buffer.concat([buffer, data])
              while (buffer.length >= INPUT_EVENT_SIZE) {
                const type = buffer.readUInt16LE(16)
                const code = buffer.readUInt16LE(18)
                const value = buffer.readInt32LE(20)
                handleEvent(type, code, value)
                buffer = buffer.subarray(INPUT_EVENT_SIZE)
              }
            })

            stream.on('error', (err) => {
              // EACCES 是权限问题，提示用户
              if ((err as NodeJS.ErrnoException).code === 'EACCES') {
                console.warn(`[NativeInputHook] 权限不足: ${devicePath} (需要 input 组权限)`)
              }
            })

            streams.push(stream)
            openedCount++
          } catch {
            // 跳过打不开的设备
          }
        }

        if (openedCount === 0) {
          console.error('[NativeInputHook] Linux 无法打开任何输入设备（需要 input 组权限）')
          return false
        }

        console.log(`[NativeInputHook] Linux evdev 已启动，监听 ${openedCount} 个设备`)
        return true
      } catch (err) {
        console.error('[NativeInputHook] Linux 启动失败:', err)
        this.stop()
        return false
      }
    },

    stop(): void {
      for (const stream of streams) {
        try { stream.destroy() } catch { /* ignore */ }
      }
      streams.length = 0
      console.log('[NativeInputHook] Linux evdev 已停止')
    }
  }
}

// ==================== VK Code → 按键名映射（给 DoubleTapDetector 用） ====================

/**
 * 修饰键 VK Code → 统一修饰键名称
 * 左右修饰键统一映射到同一名称，与原 uiohook 行为一致
 */
export const VK_MODIFIER_MAP: Record<number, string> = {
  [VK_LWIN]: 'Command',
  [VK_RWIN]: 'Command',
  [VK_LCONTROL]: 'Ctrl',
  [VK_RCONTROL]: 'Ctrl',
  [VK_LMENU]: 'Alt',
  [VK_RMENU]: 'Alt',
  [VK_LSHIFT]: 'Shift',
  [VK_RSHIFT]: 'Shift',
}

/**
 * 判断一个 VK Code 是否为修饰键（给 DoubleTapDetector 用）
 */
export function isModifierVK(vkCode: number): boolean {
  return vkCode in VK_MODIFIER_MAP
}

// ==================== Electron Accelerator → VK Code 映射 ====================

/**
 * Electron accelerator 键名 → Windows Virtual Key Code 映射
 * 用于替换原 ELECTRON_KEY_TO_UIOHOOK 映射
 */
export const ELECTRON_KEY_TO_VK: Record<string, number> = {
  // 功能键
  space: 0x20,      // VK_SPACE
  enter: 0x0D,      // VK_RETURN
  return: 0x0D,
  tab: 0x09,        // VK_TAB
  escape: 0x1B,     // VK_ESCAPE
  esc: 0x1B,
  backspace: 0x08,  // VK_BACK
  delete: 0x2E,     // VK_DELETE
  insert: 0x2D,     // VK_INSERT
  home: 0x24,       // VK_HOME
  end: 0x23,        // VK_END
  pageup: 0x21,     // VK_PRIOR
  pagedown: 0x22,   // VK_NEXT
  up: 0x26,         // VK_UP
  down: 0x28,       // VK_DOWN
  left: 0x25,       // VK_LEFT
  right: 0x27,      // VK_RIGHT
  // F1-F12
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73,
  f5: 0x74, f6: 0x75, f7: 0x76, f8: 0x77,
  f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
  // 字母键 (A-Z: 0x41-0x5A)
  a: 0x41, b: 0x42, c: 0x43, d: 0x44,
  e: 0x45, f: 0x46, g: 0x47, h: 0x48,
  i: 0x49, j: 0x4A, k: 0x4B, l: 0x4C,
  m: 0x4D, n: 0x4E, o: 0x4F, p: 0x50,
  q: 0x51, r: 0x52, s: 0x53, t: 0x54,
  u: 0x55, v: 0x56, w: 0x57, x: 0x58,
  y: 0x59, z: 0x5A,
  // 数字键 (0-9: 0x30-0x39)
  '0': 0x30, '1': 0x31, '2': 0x32,
  '3': 0x33, '4': 0x34, '5': 0x35,
  '6': 0x36, '7': 0x37, '8': 0x38,
  '9': 0x39,
  // 符号键
  '-': 0xBD,     // VK_OEM_MINUS
  '=': 0xBB,     // VK_OEM_PLUS (= key)
  '[': 0xDB,     // VK_OEM_4
  ']': 0xDD,     // VK_OEM_6
  '\\': 0xDC,    // VK_OEM_5
  ';': 0xBA,     // VK_OEM_1
  '\'': 0xDE,    // VK_OEM_7
  '`': 0xC0,     // VK_OEM_3
  ',': 0xBC,     // VK_OEM_COMMA
  '.': 0xBE,     // VK_OEM_PERIOD
  '/': 0xBF,     // VK_OEM_2
  minus: 0xBD,
  plus: 0xBB,
  equal: 0xBB,
}
