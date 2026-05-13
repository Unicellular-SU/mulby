import { app, BrowserWindow, clipboard, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { pathToFileURL } from 'url'
import log from 'electron-log'
import { hasDetachedWindows, isAppExplicitlyHidden, markAppHidden, markAppVisible } from '../services/blur-manager'
import {
  nativeWin32KeyboardTap,
  nativeWin32MouseClick,
  nativeWin32MouseMove,
  nativeWin32Paste,
  restoreWin32ForegroundWindow,
  nativeWin32TypeText,
  writeWin32FilesToClipboard
} from '../services/native-win32-input'
import { getCachedWindowsForegroundWindow } from '../services/active-window'

const execFileAsync = promisify(execFile)
const FOCUS_DELAY_MS = 160
const SINGLE_KEY_PATTERN = /^[a-z0-9]$/

// 记录隐藏前可见的窗口
const hiddenWindows: Set<number> = new Set()

// 独立窗口注册表 —— 这些窗口不会被 hideAllAppWindows 隐藏
const protectedWindowIds: Set<number> = new Set()

export function registerProtectedWindow(windowId: number): void {
  protectedWindowIds.add(windowId)
}

export function unregisterProtectedWindow(windowId: number): void {
  protectedWindowIds.delete(windowId)
}

// macOS 键码映射 (key code)
const MAC_KEY_CODES: Record<string, number> = {
  // 功能键
  enter: 36,
  return: 36,
  tab: 48,
  space: 49,
  backspace: 51,
  delete: 117,
  escape: 53,
  esc: 53,

  // 方向键
  up: 126,
  down: 125,
  left: 123,
  right: 124,

  // 导航键
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,

  // 功能键 F1-F12
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,

  // 其他
  capslock: 57,
  insert: 114
}

// Windows/Linux 键名映射
const KEY_MAP: Record<string, { win32: string; linux: string }> = {
  // 功能键
  enter: { win32: '{ENTER}', linux: 'Return' },
  return: { win32: '{ENTER}', linux: 'Return' },
  tab: { win32: '{TAB}', linux: 'Tab' },
  space: { win32: ' ', linux: 'space' },
  backspace: { win32: '{BACKSPACE}', linux: 'BackSpace' },
  delete: { win32: '{DELETE}', linux: 'Delete' },
  escape: { win32: '{ESC}', linux: 'Escape' },
  esc: { win32: '{ESC}', linux: 'Escape' },

  // 方向键
  up: { win32: '{UP}', linux: 'Up' },
  down: { win32: '{DOWN}', linux: 'Down' },
  left: { win32: '{LEFT}', linux: 'Left' },
  right: { win32: '{RIGHT}', linux: 'Right' },

  // 导航键
  home: { win32: '{HOME}', linux: 'Home' },
  end: { win32: '{END}', linux: 'End' },
  pageup: { win32: '{PGUP}', linux: 'Page_Up' },
  pagedown: { win32: '{PGDN}', linux: 'Page_Down' },

  // 功能键 F1-F12
  f1: { win32: '{F1}', linux: 'F1' },
  f2: { win32: '{F2}', linux: 'F2' },
  f3: { win32: '{F3}', linux: 'F3' },
  f4: { win32: '{F4}', linux: 'F4' },
  f5: { win32: '{F5}', linux: 'F5' },
  f6: { win32: '{F6}', linux: 'F6' },
  f7: { win32: '{F7}', linux: 'F7' },
  f8: { win32: '{F8}', linux: 'F8' },
  f9: { win32: '{F9}', linux: 'F9' },
  f10: { win32: '{F10}', linux: 'F10' },
  f11: { win32: '{F11}', linux: 'F11' },
  f12: { win32: '{F12}', linux: 'F12' },

  // 其他
  capslock: { win32: '{CAPSLOCK}', linux: 'Caps_Lock' },
  printscreen: { win32: '{PRTSC}', linux: 'Print' },
  insert: { win32: '{INSERT}', linux: 'Insert' }
}

// macOS 修饰键映射
const MAC_MODIFIER_MAP: Record<string, string> = {
  ctrl: 'control down',
  control: 'control down',
  alt: 'option down',
  option: 'option down',
  shift: 'shift down',
  command: 'command down',
  cmd: 'command down',
  meta: 'command down',
  super: 'command down',
  win: 'command down'
}

// Windows/Linux 修饰键映射
const MODIFIER_MAP: Record<string, { win32: string; linux: string }> = {
  ctrl: { win32: '^', linux: 'ctrl' },
  control: { win32: '^', linux: 'ctrl' },
  alt: { win32: '%', linux: 'alt' },
  option: { win32: '%', linux: 'alt' },
  shift: { win32: '+', linux: 'shift' },
  command: { win32: '^', linux: 'super' },
  cmd: { win32: '^', linux: 'super' },
  meta: { win32: '^', linux: 'super' },
  super: { win32: '^', linux: 'super' },
  win: { win32: '^', linux: 'super' }
}

function getPlatformKey(key: string): string {
  const platform = process.platform as 'darwin' | 'win32' | 'linux'
  const lowerKey = key.toLowerCase()

  if (platform === 'darwin') {
    // macOS 使用键码，这里返回键名用于后续判断
    return lowerKey
  }

  const mappedKey = KEY_MAP[lowerKey]?.[platform as 'win32' | 'linux']
  if (mappedKey) {
    return mappedKey
  }

  if (isSingleKey(lowerKey)) {
    return lowerKey
  }

  throw new TypeError(`Unsupported input key: ${key}`)
}

function getPlatformModifier(modifier: string): string {
  const platform = process.platform as 'darwin' | 'win32' | 'linux'
  const lowerMod = modifier.toLowerCase()

  if (platform === 'darwin') {
    const mappedModifier = MAC_MODIFIER_MAP[lowerMod]
    if (mappedModifier) {
      return mappedModifier
    }
    throw new TypeError(`Unsupported input modifier: ${modifier}`)
  }

  const mappedModifier = MODIFIER_MAP[lowerMod]?.[platform as 'win32' | 'linux']
  if (mappedModifier) {
    return mappedModifier
  }

  throw new TypeError(`Unsupported input modifier: ${modifier}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function hideAllAppWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.isVisible() && !protectedWindowIds.has(win.id)) {
      hiddenWindows.add(win.id)
      win.hide()
    }
  }

  if (process.platform === 'darwin' && !hasDetachedWindows()) {
    app.hide()
    markAppHidden()
  }
}

// 恢复之前隐藏的窗口
function restoreHiddenWindows(): void {
  if (process.platform === 'darwin' && isAppExplicitlyHidden()) {
    app.show()
    markAppVisible()
  }

  for (const winId of hiddenWindows) {
    const win = BrowserWindow.fromId(winId)
    if (win && !win.isDestroyed()) {
      win.show()
    }
  }
  hiddenWindows.clear()
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function normalizeInputCoordinate(value: unknown, label: string): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : NaN

  if (!Number.isFinite(numeric)) {
    throw new TypeError(`${label} must be a finite number`)
  }

  return Math.round(numeric)
}

function normalizeInputText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`)
  }
  return value
}

function hasOwn<T extends object>(record: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isSingleKey(key: string): boolean {
  return SINGLE_KEY_PATTERN.test(key)
}

export function normalizeInputKeyboardKey(key: unknown): string {
  if (typeof key !== 'string') {
    throw new TypeError('key must be a string')
  }

  const normalized = key.trim().toLowerCase()
  if (isSingleKey(normalized) || hasOwn(MAC_KEY_CODES, normalized) || hasOwn(KEY_MAP, normalized)) {
    return normalized
  }

  throw new TypeError(`Unsupported input key: ${key}`)
}

export function normalizeInputKeyboardModifiers(modifiers: unknown[]): string[] {
  return modifiers.map((modifier) => {
    if (typeof modifier !== 'string') {
      throw new TypeError('modifier must be a string')
    }

    const normalized = modifier.trim().toLowerCase()
    if (!hasOwn(MAC_MODIFIER_MAP, normalized) && !hasOwn(MODIFIER_MAP, normalized)) {
      throw new TypeError(`Unsupported input modifier: ${modifier}`)
    }

    return normalized
  })
}

function normalizeFilePaths(filePaths: unknown): string[] {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
  const normalized = paths.map((filePath) => {
    if (typeof filePath !== 'string') {
      throw new TypeError('file path must be a string')
    }
    return filePath
  }).filter(filePath => filePath.length > 0)

  if (normalized.length === 0) {
    throw new TypeError('file path list must not be empty')
  }

  return normalized
}

function writeImageToClipboard(image: string | Buffer | ArrayBuffer | Uint8Array): boolean {
  try {
    let nativeImg: Electron.NativeImage
    if (Buffer.isBuffer(image)) {
      nativeImg = nativeImage.createFromBuffer(image)
    } else if (image instanceof ArrayBuffer) {
      nativeImg = nativeImage.createFromBuffer(Buffer.from(image))
    } else if (ArrayBuffer.isView(image)) {
      nativeImg = nativeImage.createFromBuffer(Buffer.from(image.buffer, image.byteOffset, image.byteLength))
    } else if (typeof image === 'string') {
      if (image.startsWith('data:image')) {
        nativeImg = nativeImage.createFromDataURL(image)
      } else {
        nativeImg = nativeImage.createFromPath(image)
      }
    } else {
      return false
    }

    if (!nativeImg || nativeImg.isEmpty()) return false
    clipboard.writeImage(nativeImg)
    return true
  } catch (error) {
    log.error('[Input] Failed to write image to clipboard:', error)
    return false
  }
}

function writeFilesToClipboard(filePaths: string | string[]): boolean {
  const paths = normalizeFilePaths(filePaths)

  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${paths.map(p => `    <string>${escapeXmlText(p)}</string>`).join('\n')}
</array>
</plist>`
    clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist))
    return true
  }

  if (process.platform === 'win32') {
    return writeWin32FilesToClipboard(paths)
  }

  const uriList = paths.map(p => pathToFileURL(p).toString()).join('\n')
  clipboard.writeBuffer('text/uri-list', Buffer.from(uriList))
  return true
}

async function sendPasteShortcut(): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to keystroke "v" using command down'
    ])
    return
  }

  if (process.platform === 'win32') {
    const ok = nativeWin32Paste()
    if (!ok) {
      throw new Error('Windows SendInput paste shortcut failed')
    }
    return
  }

  await execFileAsync('xdotool', ['key', '--clearmodifiers', 'ctrl+v'])
}

async function sendTypeString(text: string): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', [
      '-e',
      'on run argv',
      '-e',
      'tell application "System Events" to keystroke (item 1 of argv)',
      '-e',
      'end run',
      text
    ])
    return
  }

  if (process.platform === 'win32') {
    const ok = nativeWin32TypeText(text)
    if (!ok) {
      throw new Error('Windows SendInput unicode typing failed')
    }
    return
  }

  await execFileAsync('xdotool', ['type', '--clearmodifiers', '--delay', '1', '--', text])
}

// 模拟键盘按键
async function simulateKeyboardTapInternal(key: string, modifiers: string[]): Promise<void> {
  const lowerKey = key.toLowerCase()

  if (process.platform === 'darwin') {
    // macOS: 使用 osascript
    const keyCode = MAC_KEY_CODES[lowerKey]
    const modifierStr = modifiers.map(m => getPlatformModifier(m)).join(', ')
    const usingClause = modifiers.length > 0 ? ` using {${modifierStr}}` : ''

    if (keyCode !== undefined) {
      // 使用 key code 数字
      await execFileAsync('osascript', ['-e', `tell application "System Events" to key code ${keyCode}${usingClause}`])
      return
    }

    if (!isSingleKey(lowerKey)) {
      throw new TypeError(`Unsupported macOS input key: ${key}`)
    }

    // 普通字符通过 argv 传入，避免把调用方字符串插入 AppleScript。
    await execFileAsync('osascript', [
      '-e',
      'on run argv',
      '-e',
      `tell application "System Events" to keystroke (item 1 of argv)${usingClause}`,
      '-e',
      'end run',
      lowerKey
    ])
    return
  }

  if (process.platform === 'win32') {
    const ok = nativeWin32KeyboardTap(lowerKey, modifiers)
    if (!ok) {
      throw new Error(`Windows SendInput keyboard tap failed: ${key}`)
    }
    return
  }

  // Linux: 使用 xdotool
  if (!KEY_MAP[lowerKey] && !isSingleKey(lowerKey)) {
    throw new TypeError(`Unsupported Linux input key: ${key}`)
  }

  const platformKey = getPlatformKey(key)
  const xdotoolModifiers = modifiers.map(m => getPlatformModifier(m))
  const fullKey = [...xdotoolModifiers, platformKey].join('+')
  await execFileAsync('xdotool', ['key', '--clearmodifiers', fullKey])
}

// 模拟鼠标移动
async function simulateMouseMoveInternal(x: number, y: number): Promise<void> {
  if (process.platform === 'darwin') {
    // macOS: 使用 JXA (JavaScript for Automation) 调用 CoreGraphics
    const script = `
      ObjC.import('CoreGraphics');
      var point = $.CGPointMake(${x}, ${y});
      var event = $.CGEventCreateMouseEvent($(), $.kCGEventMouseMoved, point, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, event);
    `
    await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script])
    return
  }

  if (process.platform === 'win32') {
    const ok = nativeWin32MouseMove(x, y)
    if (!ok) {
      throw new Error(`Windows SetCursorPos failed: ${x}, ${y}`)
    }
    return
  }

  // Linux: 使用 xdotool
  await execFileAsync('xdotool', ['mousemove', '--sync', x.toString(), y.toString()])
}

// 模拟鼠标点击
async function simulateMouseClickInternal(x: number, y: number, button: 'left' | 'right' = 'left', clickCount: number = 1): Promise<void> {
  if (process.platform === 'darwin') {
    // macOS: 使用 JXA (JavaScript for Automation) 调用 CoreGraphics
    const eventTypeDown = button === 'right' ? '$.kCGEventRightMouseDown' : '$.kCGEventLeftMouseDown'
    const eventTypeUp = button === 'right' ? '$.kCGEventRightMouseUp' : '$.kCGEventLeftMouseUp'
    const mouseButton = button === 'right' ? '$.kCGMouseButtonRight' : '$.kCGMouseButtonLeft'

    let clickScript = ''
    for (let i = 0; i < clickCount; i++) {
      clickScript += `
      var eventDown = $.CGEventCreateMouseEvent($(), ${eventTypeDown}, point, ${mouseButton});
      $.CGEventSetIntegerValueField(eventDown, $.kCGMouseEventClickState, ${i + 1});
      $.CGEventPost($.kCGHIDEventTap, eventDown);
      var eventUp = $.CGEventCreateMouseEvent($(), ${eventTypeUp}, point, ${mouseButton});
      $.CGEventSetIntegerValueField(eventUp, $.kCGMouseEventClickState, ${i + 1});
      $.CGEventPost($.kCGHIDEventTap, eventUp);
`
    }

    const script = `
      ObjC.import('CoreGraphics');
      var point = $.CGPointMake(${x}, ${y});
      // Move to position first
      var moveEvent = $.CGEventCreateMouseEvent($(), $.kCGEventMouseMoved, point, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, moveEvent);
      delay(0.01);
      ${clickScript}
    `
    await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script])
    return
  }

  if (process.platform === 'win32') {
    const ok = nativeWin32MouseClick(x, y, button, clickCount)
    if (!ok) {
      throw new Error(`Windows SendInput mouse click failed: ${button}`)
    }
    return
  }

  // Linux: 使用 xdotool
  const buttonNum = button === 'right' ? '3' : '1'
  const clickArg = clickCount > 1 ? ['--repeat', clickCount.toString()] : []
  await execFileAsync('xdotool', ['mousemove', '--sync', x.toString(), y.toString(), 'click', ...clickArg, buttonNum])
}

async function withHiddenWindow(action: () => Promise<void>): Promise<void> {
  hideAllAppWindows()
  if (process.platform === 'win32') {
    const targetWindow = getCachedWindowsForegroundWindow()
    if (targetWindow && !restoreWin32ForegroundWindow(targetWindow)) {
      log.warn('[Input] Failed to restore previous Windows foreground window before input')
    }
  }
  await sleep(FOCUS_DELAY_MS)
  try {
    await action()
  } catch (error) {
    // 关键修复：action 抛错时必须恢复，否则 macOS 下 app.hide() 不被配对的
    // app.show() 平衡，应用将长期处于隐藏态，主窗口再次唤起后 NSPanel 无法
    // 成为 key window，搜索框输入框无法获取焦点（用户感知为"搜索框卡死"）。
    try {
      restoreHiddenWindows()
    } catch (restoreError) {
      log.error('[Input] Failed to restore windows after action error:', restoreError)
    }
    throw error
  }
  // 成功路径仍然沿用旧语义：不自动恢复窗口，让插件显式调用 restoreWindows()
  // 控制节奏（例如先执行多次粘贴再统一恢复）。
}

export const pluginInput = {
  async hideMainWindowPasteText(text: string): Promise<boolean> {
    try {
      const normalizedText = normalizeInputText(text, 'text')
      clipboard.writeText(normalizedText)
      await withHiddenWindow(() => sendPasteShortcut())
      return true
    } catch (error) {
      log.error('[Input] Failed to paste text:', error)
      return false
    }
  },
  async hideMainWindowPasteImage(image: string | Buffer | ArrayBuffer | Uint8Array): Promise<boolean> {
    try {
      const ok = writeImageToClipboard(image)
      if (!ok) return false
      await withHiddenWindow(() => sendPasteShortcut())
      return true
    } catch (error) {
      log.error('[Input] Failed to paste image:', error)
      return false
    }
  },
  async hideMainWindowPasteFile(filePaths: string | string[]): Promise<boolean> {
    try {
      const ok = writeFilesToClipboard(filePaths)
      if (!ok) return false
      await withHiddenWindow(() => sendPasteShortcut())
      return true
    } catch (error) {
      log.error('[Input] Failed to paste file:', error)
      return false
    }
  },
  async hideMainWindowTypeString(text: string): Promise<boolean> {
    try {
      const normalizedText = normalizeInputText(text, 'text')
      await withHiddenWindow(() => sendTypeString(normalizedText))
      return true
    } catch (error) {
      log.error('[Input] Failed to type string:', error)
      return false
    }
  },

  /**
   * 恢复之前隐藏的窗口
   * 在完成所有输入操作后调用此方法来恢复窗口
   */
  async restoreWindows(): Promise<boolean> {
    try {
      restoreHiddenWindows()
      return true
    } catch (error) {
      log.error('[Input] Failed to restore windows:', error)
      return false
    }
  },

  /**
   * 隐藏主窗口并模拟键盘按键（发送到外部应用）
   * @param key 被模拟的主键，如 'a', 'enter', 'f1' 等
   * @param modifiers 修饰键数组，如 ['ctrl'], ['ctrl', 'shift'] 等
   */
  async simulateKeyboardTap(key: string, ...modifiers: string[]): Promise<boolean> {
    try {
      const normalizedKey = normalizeInputKeyboardKey(key)
      const normalizedModifiers = normalizeInputKeyboardModifiers(modifiers)
      await withHiddenWindow(() => simulateKeyboardTapInternal(normalizedKey, normalizedModifiers))
      return true
    } catch (error) {
      log.error('[Input] Failed to simulate keyboard tap:', error)
      return false
    }
  },

  /**
   * 隐藏主窗口并模拟鼠标移动到指定位置
   * @param x 相对于屏幕左上角的 X 坐标（像素）
   * @param y 相对于屏幕左上角的 Y 坐标（像素）
   */
  async simulateMouseMove(x: number, y: number): Promise<boolean> {
    try {
      const normalizedX = normalizeInputCoordinate(x, 'x')
      const normalizedY = normalizeInputCoordinate(y, 'y')
      await withHiddenWindow(() => simulateMouseMoveInternal(normalizedX, normalizedY))
      return true
    } catch (error) {
      log.error('[Input] Failed to simulate mouse move:', error)
      return false
    }
  },

  /**
   * 隐藏主窗口并模拟鼠标左键单击
   * @param x 相对于屏幕左上角的 X 坐标（像素）
   * @param y 相对于屏幕左上角的 Y 坐标（像素）
   */
  async simulateMouseClick(x: number, y: number): Promise<boolean> {
    try {
      const normalizedX = normalizeInputCoordinate(x, 'x')
      const normalizedY = normalizeInputCoordinate(y, 'y')
      await withHiddenWindow(() => simulateMouseClickInternal(normalizedX, normalizedY, 'left', 1))
      return true
    } catch (error) {
      log.error('[Input] Failed to simulate mouse click:', error)
      return false
    }
  },

  /**
   * 隐藏主窗口并模拟鼠标左键双击
   * @param x 相对于屏幕左上角的 X 坐标（像素）
   * @param y 相对于屏幕左上角的 Y 坐标（像素）
   */
  async simulateMouseDoubleClick(x: number, y: number): Promise<boolean> {
    try {
      const normalizedX = normalizeInputCoordinate(x, 'x')
      const normalizedY = normalizeInputCoordinate(y, 'y')
      await withHiddenWindow(() => simulateMouseClickInternal(normalizedX, normalizedY, 'left', 2))
      return true
    } catch (error) {
      log.error('[Input] Failed to simulate mouse double click:', error)
      return false
    }
  },

  /**
   * 隐藏主窗口并模拟鼠标右键点击
   * @param x 相对于屏幕左上角的 X 坐标（像素）
   * @param y 相对于屏幕左上角的 Y 坐标（像素）
   */
  async simulateMouseRightClick(x: number, y: number): Promise<boolean> {
    try {
      const normalizedX = normalizeInputCoordinate(x, 'x')
      const normalizedY = normalizeInputCoordinate(y, 'y')
      await withHiddenWindow(() => simulateMouseClickInternal(normalizedX, normalizedY, 'right', 1))
      return true
    } catch (error) {
      log.error('[Input] Failed to simulate mouse right click:', error)
      return false
    }
  }
}
