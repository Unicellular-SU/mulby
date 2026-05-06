import { app, BrowserWindow, clipboard, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log'
import { hasDetachedWindows, isAppExplicitlyHidden, markAppHidden, markAppVisible } from '../services/blur-manager'

const execFileAsync = promisify(execFile)
const FOCUS_DELAY_MS = 160

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

  if (KEY_MAP[lowerKey]) {
    return KEY_MAP[lowerKey][platform as 'win32' | 'linux'] || key
  }

  // 对于单字符键，直接返回
  return key.toLowerCase()
}

function getPlatformModifier(modifier: string): string {
  const platform = process.platform as 'darwin' | 'win32' | 'linux'
  const lowerMod = modifier.toLowerCase()

  if (platform === 'darwin') {
    return MAC_MODIFIER_MAP[lowerMod] || modifier
  }

  if (MODIFIER_MAP[lowerMod]) {
    return MODIFIER_MAP[lowerMod][platform as 'win32' | 'linux']
  }

  return modifier
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function hideAllAppWindows(): void {
  hiddenWindows.clear()

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

function writeImageToClipboard(image: string | Buffer | ArrayBuffer): boolean {
  try {
    let nativeImg: Electron.NativeImage
    if (Buffer.isBuffer(image)) {
      nativeImg = nativeImage.createFromBuffer(image)
    } else if (image instanceof ArrayBuffer) {
      nativeImg = nativeImage.createFromBuffer(Buffer.from(image))
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
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
  if (paths.length === 0) return false

  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${paths.map(p => `    <string>${p}</string>`).join('\n')}
</array>
</plist>`
    clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist))
    return true
  }

  if (process.platform === 'win32') {
    const clipboardWithWrite = clipboard as typeof clipboard & {
      write?: (data: { files: string[] }) => void
    }
    if (typeof clipboardWithWrite.write === 'function') {
      clipboardWithWrite.write({ files: paths })
      return true
    }
    return false
  }

  const uriList = paths.map(p => `file://${p}`).join('\n')
  clipboard.writeBuffer('text/uri-list', Buffer.from(uriList))
  return true
}

function escapeSendKeys(text: string): string {
  const map: Record<string, string> = {
    '{': '{{}',
    '}': '{}}',
    '+': '{+}',
    '^': '{^}',
    '%': '{%}',
    '~': '{~}',
    '(': '{(}',
    ')': '{)}'
  }
  return text.replace(/[{}+^%~()]/g, ch => map[ch])
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
    const script = '$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys("^v")'
    await execFileAsync('powershell', ['-NoProfile', '-Command', script])
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
    const escaped = escapeSendKeys(text)
    const script = 'param([string]$text) Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($text)'
    await execFileAsync('powershell', ['-NoProfile', '-Command', script, escaped])
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
    let script: string

    if (modifiers.length > 0) {
      const modifierStr = modifiers.map(m => getPlatformModifier(m)).join(', ')
      if (keyCode !== undefined) {
        // 使用 key code 数字
        script = `tell application "System Events" to key code ${keyCode} using {${modifierStr}}`
      } else {
        // 普通字符使用 keystroke
        script = `tell application "System Events" to keystroke "${lowerKey}" using {${modifierStr}}`
      }
    } else {
      if (keyCode !== undefined) {
        // 使用 key code 数字
        script = `tell application "System Events" to key code ${keyCode}`
      } else {
        // 普通字符使用 keystroke
        script = `tell application "System Events" to keystroke "${lowerKey}"`
      }
    }
    await execFileAsync('osascript', ['-e', script])
    return
  }

  if (process.platform === 'win32') {
    // Windows: 使用 PowerShell SendKeys
    const platformKey = getPlatformKey(key)
    let keyStr: string
    if (KEY_MAP[lowerKey]) {
      keyStr = platformKey
    } else {
      keyStr = lowerKey
    }

    // 添加修饰键前缀
    const modifierPrefix = modifiers.map(m => getPlatformModifier(m)).join('')
    const fullKey = `${modifierPrefix}${keyStr}`

    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${fullKey}")`
    await execFileAsync('powershell', ['-NoProfile', '-Command', script])
    return
  }

  // Linux: 使用 xdotool
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
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
`
    await execFileAsync('powershell', ['-NoProfile', '-Command', script])
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
    const downFlag = button === 'right' ? '0x0008' : '0x0002'
    const upFlag = button === 'right' ? '0x0010' : '0x0004'

    let clickScript = `
Add-Type -AssemblyName System.Windows.Forms
$signature = @'
[DllImport("user32.dll")]
public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
'@
$mouse = Add-Type -MemberDefinition $signature -Name "Win32MouseEvent" -Namespace Win32Functions -PassThru
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
`
    for (let i = 0; i < clickCount; i++) {
      clickScript += `
$mouse::mouse_event(${downFlag}, 0, 0, 0, 0)
$mouse::mouse_event(${upFlag}, 0, 0, 0, 0)
`
    }
    await execFileAsync('powershell', ['-NoProfile', '-Command', clickScript])
    return
  }

  // Linux: 使用 xdotool
  const buttonNum = button === 'right' ? '3' : '1'
  const clickArg = clickCount > 1 ? ['--repeat', clickCount.toString()] : []
  await execFileAsync('xdotool', ['mousemove', '--sync', x.toString(), y.toString(), 'click', ...clickArg, buttonNum])
}

async function withHiddenWindow(action: () => Promise<void>): Promise<void> {
  hideAllAppWindows()
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
      clipboard.writeText(text)
      await withHiddenWindow(() => sendPasteShortcut())
      return true
    } catch (error) {
      log.error('[Input] Failed to paste text:', error)
      return false
    }
  },
  async hideMainWindowPasteImage(image: string | Buffer | ArrayBuffer): Promise<boolean> {
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
      await withHiddenWindow(() => sendTypeString(text))
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
      await withHiddenWindow(() => simulateKeyboardTapInternal(key, modifiers))
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
      await withHiddenWindow(() => simulateMouseMoveInternal(x, y))
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
      await withHiddenWindow(() => simulateMouseClickInternal(x, y, 'left', 1))
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
      await withHiddenWindow(() => simulateMouseClickInternal(x, y, 'left', 2))
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
      await withHiddenWindow(() => simulateMouseClickInternal(x, y, 'right', 1))
      return true
    } catch (error) {
      log.error('[Input] Failed to simulate mouse right click:', error)
      return false
    }
  }
}
