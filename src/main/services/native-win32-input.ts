import * as koffi from 'koffi'
import log from 'electron-log'

export const INPUT_MOUSE = 0
export const INPUT_KEYBOARD = 1
export const KEYEVENTF_EXTENDEDKEY = 0x0001
export const KEYEVENTF_KEYUP = 0x0002
export const KEYEVENTF_UNICODE = 0x0004
export const MOUSEEVENTF_MOVE = 0x0001
export const MOUSEEVENTF_LEFTDOWN = 0x0002
export const MOUSEEVENTF_LEFTUP = 0x0004
export const MOUSEEVENTF_RIGHTDOWN = 0x0008
export const MOUSEEVENTF_RIGHTUP = 0x0010
export const MOUSEEVENTF_ABSOLUTE = 0x8000
export const CF_HDROP = 15

const GMEM_MOVEABLE = 0x0002
const SW_RESTORE = 9
const VK_CONTROL = 0x11
const VK_SHIFT = 0x10
const VK_MENU = 0x12
const VK_LWIN = 0x5B

const WIN32_KEY_CODES: Record<string, number> = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0D,
  return: 0x0D,
  shift: VK_SHIFT,
  ctrl: VK_CONTROL,
  control: VK_CONTROL,
  alt: VK_MENU,
  escape: 0x1B,
  esc: 0x1B,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  insert: 0x2D,
  delete: 0x2E,
  '0': 0x30,
  '1': 0x31,
  '2': 0x32,
  '3': 0x33,
  '4': 0x34,
  '5': 0x35,
  '6': 0x36,
  '7': 0x37,
  '8': 0x38,
  '9': 0x39,
  a: 0x41,
  b: 0x42,
  c: 0x43,
  d: 0x44,
  e: 0x45,
  f: 0x46,
  g: 0x47,
  h: 0x48,
  i: 0x49,
  j: 0x4A,
  k: 0x4B,
  l: 0x4C,
  m: 0x4D,
  n: 0x4E,
  o: 0x4F,
  p: 0x50,
  q: 0x51,
  r: 0x52,
  s: 0x53,
  t: 0x54,
  u: 0x55,
  v: 0x56,
  w: 0x57,
  x: 0x58,
  y: 0x59,
  z: 0x5A,
  command: VK_CONTROL,
  cmd: VK_CONTROL,
  meta: VK_CONTROL,
  capslock: 0x14,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7A,
  f12: 0x7B
}

const WIN32_EXTENDED_KEYS = new Set([
  0x21,
  0x22,
  0x23,
  0x24,
  0x25,
  0x26,
  0x27,
  0x28,
  0x2D,
  0x2E,
  VK_LWIN
])

const WIN32_MODIFIER_CODES: Record<string, number> = {
  ctrl: VK_CONTROL,
  control: VK_CONTROL,
  alt: VK_MENU,
  option: VK_MENU,
  shift: VK_SHIFT,
  command: VK_CONTROL,
  cmd: VK_CONTROL,
  meta: VK_CONTROL,
  super: VK_LWIN,
  win: VK_LWIN
}

interface Win32MouseInput {
  dx: number
  dy: number
  mouseData: number
  dwFlags: number
  time: number
  dwExtraInfo: number
}

interface Win32KeyboardInput {
  wVk: number
  wScan: number
  dwFlags: number
  time: number
  dwExtraInfo: number
}

interface Win32HardwareInput {
  uMsg: number
  wParamL: number
  wParamH: number
}

export interface Win32Input {
  type: number
  u: {
    mi?: Win32MouseInput
    ki?: Win32KeyboardInput
    hi?: Win32HardwareInput
  }
}

export interface Win32ClipboardApi {
  OpenClipboard: (hWndNewOwner: null) => number
  EmptyClipboard: () => number
  SetClipboardData: (uFormat: number, hMem: unknown) => unknown
  CloseClipboard: () => number
  GlobalAlloc: (uFlags: number, dwBytes: number) => unknown
  GlobalLock: (hMem: unknown) => unknown
  GlobalUnlock: (hMem: unknown) => number
  GlobalFree: (hMem: unknown) => unknown
  CopyMemory: (dest: unknown, source: Buffer, bytes: number) => void
  GetLastError: () => number
}

export interface Win32FocusApi {
  IsWindow: (hWnd: unknown) => number
  IsIconic: (hWnd: unknown) => number
  ShowWindow: (hWnd: unknown, nCmdShow: number) => number
  BringWindowToTop: (hWnd: unknown) => number
  SetForegroundWindow: (hWnd: unknown) => number
  GetForegroundWindow: () => unknown
  GetWindowThreadProcessId: (hWnd: unknown) => number
  GetCurrentThreadId: () => number
  AttachThreadInput: (idAttach: number, idAttachTo: number, fAttach: number) => number
  GetLastError: () => number
}

interface Win32InputApi extends Win32ClipboardApi, Win32FocusApi {
  SendInput: (cInputs: number, pInputs: Win32Input[], cbSize: number) => number
  SetCursorPos: (x: number, y: number) => number
  INPUT: koffi.IKoffiCType
}

let cachedApi: Win32InputApi | null = null

function resolveKeyCode(key: string): number {
  const keyCode = WIN32_KEY_CODES[key.toLowerCase()]
  if (keyCode === undefined) {
    throw new TypeError(`Unsupported Windows input key: ${key}`)
  }
  return keyCode
}

function resolveModifierCode(modifier: string): number {
  const keyCode = WIN32_MODIFIER_CODES[modifier.toLowerCase()]
  if (keyCode === undefined) {
    throw new TypeError(`Unsupported Windows input modifier: ${modifier}`)
  }
  return keyCode
}

function isExtendedKey(vk: number): boolean {
  return WIN32_EXTENDED_KEYS.has(vk)
}

function keyboardInput(vk: number, keyUp = false): Win32Input {
  const flags = (keyUp ? KEYEVENTF_KEYUP : 0) | (isExtendedKey(vk) ? KEYEVENTF_EXTENDEDKEY : 0)
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: vk,
        wScan: 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0
      }
    }
  }
}

function unicodeInput(codeUnit: number, keyUp = false): Win32Input {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: 0,
        wScan: codeUnit,
        dwFlags: KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0),
        time: 0,
        dwExtraInfo: 0
      }
    }
  }
}

function mouseInput(x: number, y: number, flags: number): Win32Input {
  return {
    type: INPUT_MOUSE,
    u: {
      mi: {
        dx: x,
        dy: y,
        mouseData: 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0
      }
    }
  }
}

export function buildWin32KeyboardTapInputs(key: string, modifiers: string[] = []): Win32Input[] {
  const keyCode = resolveKeyCode(key)
  const modifierCodes = modifiers.map(resolveModifierCode)
  return [
    ...modifierCodes.map((vk) => keyboardInput(vk)),
    keyboardInput(keyCode),
    keyboardInput(keyCode, true),
    ...modifierCodes.slice().reverse().map((vk) => keyboardInput(vk, true))
  ]
}

export function buildWin32UnicodeTextInputs(text: string): Win32Input[] {
  const events: Win32Input[] = []
  for (let index = 0; index < text.length; index++) {
    const codeUnit = text.charCodeAt(index)
    events.push(unicodeInput(codeUnit), unicodeInput(codeUnit, true))
  }
  return events
}

export function buildWin32MouseMoveInputs(x: number, y: number): Win32Input[] {
  return [mouseInput(x, y, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE)]
}

export function buildWin32MouseClickInputs(button: 'left' | 'right' = 'left', clickCount = 1): Win32Input[] {
  const down = button === 'right' ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN
  const up = button === 'right' ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP
  const events: Win32Input[] = []
  for (let i = 0; i < clickCount; i++) {
    events.push(mouseInput(0, 0, down), mouseInput(0, 0, up))
  }
  return events
}

export function createWin32HdropBuffer(filePaths: string[]): Buffer {
  const fileList = `${filePaths.join('\0')}\0\0`
  const fileListBuffer = Buffer.from(fileList, 'utf16le')
  const headerSize = 20
  const buffer = Buffer.alloc(headerSize + fileListBuffer.byteLength)

  buffer.writeUInt32LE(headerSize, 0)
  buffer.writeInt32LE(0, 4)
  buffer.writeInt32LE(0, 8)
  buffer.writeInt32LE(0, 12)
  buffer.writeInt32LE(1, 16)
  fileListBuffer.copy(buffer, headerSize)

  return buffer
}

function getWin32InputApi(): Win32InputApi {
  if (cachedApi) return cachedApi

  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const getWindowThreadProcessId = user32.func(
    'uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'
  ) as (hWnd: unknown, pidOut: null) => number

  const MOUSEINPUT = koffi.struct('MULBY_MOUSEINPUT', {
    dx: 'long',
    dy: 'long',
    mouseData: 'uint32_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t'
  })
  const KEYBDINPUT = koffi.struct('MULBY_KEYBDINPUT', {
    wVk: 'uint16_t',
    wScan: 'uint16_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t'
  })
  const HARDWAREINPUT = koffi.struct('MULBY_HARDWAREINPUT', {
    uMsg: 'uint32_t',
    wParamL: 'uint16_t',
    wParamH: 'uint16_t'
  })
  const INPUT = koffi.struct('MULBY_INPUT', {
    type: 'uint32_t',
    u: koffi.union({
      mi: MOUSEINPUT,
      ki: KEYBDINPUT,
      hi: HARDWAREINPUT
    })
  })

  cachedApi = {
    SendInput: user32.func('unsigned int __stdcall SendInput(unsigned int cInputs, MULBY_INPUT *pInputs, int cbSize)'),
    SetCursorPos: user32.func('int __stdcall SetCursorPos(int X, int Y)'),
    OpenClipboard: user32.func('int __stdcall OpenClipboard(void *hWndNewOwner)'),
    EmptyClipboard: user32.func('int __stdcall EmptyClipboard()'),
    SetClipboardData: user32.func('void* __stdcall SetClipboardData(unsigned int uFormat, void *hMem)'),
    CloseClipboard: user32.func('int __stdcall CloseClipboard()'),
    GlobalAlloc: kernel32.func('void* __stdcall GlobalAlloc(unsigned int uFlags, size_t dwBytes)'),
    GlobalLock: kernel32.func('void* __stdcall GlobalLock(void *hMem)'),
    GlobalUnlock: kernel32.func('int __stdcall GlobalUnlock(void *hMem)'),
    GlobalFree: kernel32.func('void* __stdcall GlobalFree(void *hMem)'),
    CopyMemory: kernel32.func('void __stdcall RtlMoveMemory(void *Destination, _In_ uint8_t *Source, size_t Length)'),
    IsWindow: user32.func('int __stdcall IsWindow(void *hWnd)'),
    IsIconic: user32.func('int __stdcall IsIconic(void *hWnd)'),
    ShowWindow: user32.func('int __stdcall ShowWindow(void *hWnd, int nCmdShow)'),
    BringWindowToTop: user32.func('int __stdcall BringWindowToTop(void *hWnd)'),
    SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(void *hWnd)'),
    GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
    GetWindowThreadProcessId: (hWnd: unknown) => getWindowThreadProcessId(hWnd, null),
    GetCurrentThreadId: kernel32.func('uint32_t __stdcall GetCurrentThreadId()'),
    AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, int fAttach)'),
    GetLastError: kernel32.func('unsigned int __stdcall GetLastError()'),
    INPUT
  }

  return cachedApi
}

export function sendWin32Input(events: Win32Input[]): boolean {
  if (events.length === 0) return true
  const api = getWin32InputApi()
  const sent = api.SendInput(events.length, events, koffi.sizeof(api.INPUT))
  if (sent !== events.length) {
    log.warn(`[Win32Input] SendInput inserted ${sent}/${events.length} events; lastError=${api.GetLastError()}`)
    return false
  }
  return true
}

export function nativeWin32KeyboardTap(key: string, modifiers: string[] = []): boolean {
  return sendWin32Input(buildWin32KeyboardTapInputs(key, modifiers))
}

export function nativeWin32TypeText(text: string): boolean {
  return sendWin32Input(buildWin32UnicodeTextInputs(text))
}

export function nativeWin32Paste(): boolean {
  return nativeWin32KeyboardTap('v', ['ctrl'])
}

export function nativeWin32MouseMove(x: number, y: number): boolean {
  const api = getWin32InputApi()
  const ok = api.SetCursorPos(x, y)
  if (!ok) {
    log.warn(`[Win32Input] SetCursorPos failed; lastError=${api.GetLastError()}`)
    return false
  }
  return true
}

export function nativeWin32MouseClick(x: number, y: number, button: 'left' | 'right' = 'left', clickCount = 1): boolean {
  if (!nativeWin32MouseMove(x, y)) return false
  return sendWin32Input(buildWin32MouseClickInputs(button, clickCount))
}

export function restoreWin32ForegroundWindowWithApi(api: Win32FocusApi, hWnd: unknown): boolean {
  if (!hWnd || !api.IsWindow(hWnd)) return false

  if (api.IsIconic(hWnd)) {
    api.ShowWindow(hWnd, SW_RESTORE)
  }

  const currentThread = api.GetCurrentThreadId()
  const targetThread = api.GetWindowThreadProcessId(hWnd)
  const foregroundWindow = api.GetForegroundWindow()
  const foregroundThread = foregroundWindow ? api.GetWindowThreadProcessId(foregroundWindow) : 0
  const attachedThreads: number[] = []

  const attachThread = (threadId: number) => {
    if (!threadId || threadId === currentThread || attachedThreads.includes(threadId)) return
    if (api.AttachThreadInput(currentThread, threadId, 1)) {
      attachedThreads.push(threadId)
    }
  }

  attachThread(targetThread)
  attachThread(foregroundThread)

  try {
    api.BringWindowToTop(hWnd)
    const ok = api.SetForegroundWindow(hWnd)
    if (!ok) {
      log.warn(`[Win32Input] SetForegroundWindow failed; lastError=${api.GetLastError()}`)
      return false
    }
    return true
  } finally {
    for (let i = attachedThreads.length - 1; i >= 0; i--) {
      try { api.AttachThreadInput(currentThread, attachedThreads[i], 0) } catch { /* ignore */ }
    }
  }
}

export function restoreWin32ForegroundWindow(hWnd: unknown): boolean {
  return restoreWin32ForegroundWindowWithApi(getWin32InputApi(), hWnd)
}

export function writeWin32FilesToClipboardWithApi(api: Win32ClipboardApi, filePaths: string[]): boolean {
  const buffer = createWin32HdropBuffer(filePaths)
  let hMem: unknown = null
  let locked = false
  let transferred = false

  if (!api.OpenClipboard(null)) {
    log.warn(`[Win32Input] OpenClipboard failed; lastError=${api.GetLastError()}`)
    return false
  }

  try {
    if (!api.EmptyClipboard()) {
      log.warn(`[Win32Input] EmptyClipboard failed; lastError=${api.GetLastError()}`)
      return false
    }

    hMem = api.GlobalAlloc(GMEM_MOVEABLE, buffer.byteLength)
    if (!hMem) {
      log.warn(`[Win32Input] GlobalAlloc failed; lastError=${api.GetLastError()}`)
      return false
    }

    const ptr = api.GlobalLock(hMem)
    if (!ptr) {
      log.warn(`[Win32Input] GlobalLock failed; lastError=${api.GetLastError()}`)
      return false
    }
    locked = true

    api.CopyMemory(ptr, buffer, buffer.byteLength)
    api.GlobalUnlock(hMem)
    locked = false

    const result = api.SetClipboardData(CF_HDROP, hMem)
    if (!result) {
      log.warn(`[Win32Input] SetClipboardData(CF_HDROP) failed; lastError=${api.GetLastError()}`)
      return false
    }

    transferred = true
    return true
  } catch (error) {
    log.error('[Win32Input] Failed to write CF_HDROP clipboard data:', error)
    return false
  } finally {
    if (locked && hMem) {
      try { api.GlobalUnlock(hMem) } catch { /* ignore */ }
    }
    if (hMem && !transferred) {
      try { api.GlobalFree(hMem) } catch { /* ignore */ }
    }
    api.CloseClipboard()
  }
}

export function writeWin32FilesToClipboard(filePaths: string[]): boolean {
  return writeWin32FilesToClipboardWithApi(getWin32InputApi(), filePaths)
}
