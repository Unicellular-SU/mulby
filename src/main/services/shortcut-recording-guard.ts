import type { BrowserWindow, Input } from 'electron'

const WM_SYSCOMMAND = 0x0112
const WM_SYSKEYDOWN = 0x0104
const WM_SYSKEYUP = 0x0105
const HOOKED_MSGS = [WM_SYSCOMMAND, WM_SYSKEYDOWN, WM_SYSKEYUP] as const

const VK_SHIFT = 0x10
const VK_CONTROL = 0x11
const VK_MENU = 0x12
const VK_LWIN = 0x5B
const VK_RWIN = 0x5C

const recordingWebContentsIds = new Set<number>()
const windowsByWebContentsId = new Map<number, BrowserWindow>()

let sysKeyShiftHeld = false

const NON_MAIN_KEYS = new Set([
  'alt',
  'altgraph',
  'control',
  'ctrl',
  'meta',
  'shift'
])

const CODE_MAP: Record<string, string> = {
  Space: 'Space',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Tab: 'Tab',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

function normalizeMainKey(input: Input): string | null {
  const code = String(input.code || '')
  const rawKey = String(input.key || '').trim()
  const key = rawKey.toLowerCase()

  if (!rawKey || key === 'dead' || key === 'escape') return null
  if (NON_MAIN_KEYS.has(key)) return null
  if (code && CODE_MAP[code]) return CODE_MAP[code]
  if (code && code.startsWith('Key') && code.length === 4) return code.slice(3).toUpperCase()
  if (code && code.startsWith('Digit') && code.length === 6) return code.slice(5)
  if (code && /^F\d{1,2}$/.test(code)) return code

  if (/^[a-z]$/i.test(rawKey)) return rawKey.toUpperCase()
  if (/^\d$/.test(rawKey)) return rawKey
  if (/^f\d{1,2}$/i.test(rawKey)) return rawKey.toUpperCase()
  if (['space', 'spacebar'].includes(key)) return 'Space'
  if (['up', 'down', 'left', 'right'].includes(key)) {
    const mapped = key.charAt(0).toUpperCase() + key.slice(1)
    return mapped
  }
  if (['tab', 'insert', 'delete', 'home', 'end', 'pageup', 'pagedown'].includes(key)) {
    if (key === 'pageup') return 'PageUp'
    if (key === 'pagedown') return 'PageDown'
    return key.charAt(0).toUpperCase() + key.slice(1)
  }
  if ([',', '.', '/', '\\', ';', '\'', '[', ']', '-', '=', '`'].includes(rawKey)) return rawKey
  return null
}

function toAccelerator(input: Input): string | null {
  const mainKey = normalizeMainKey(input)
  const hasPrimaryModifier = input.control || input.meta || input.alt
  if (!mainKey || !hasPrimaryModifier) return null

  const parts: string[] = []
  if (input.control || input.meta) parts.push('CommandOrControl')
  if (input.alt) parts.push('Alt')
  if (input.shift) parts.push('Shift')
  parts.push(mainKey)
  return parts.join('+')
}

// ---------------------------------------------------------------------------
// Win32 message hooks — block the system-menu path at three levels:
//   WM_SYSKEYDOWN  → prevents DefWindowProc from ever generating WM_SYSCOMMAND
//   WM_SYSKEYUP    → prevents Alt-release from activating the menu bar
//   WM_SYSCOMMAND   → belt-and-suspenders catch for any remaining SC_KEYMENU
//
// Hooks are applied to ALL tracked windows so that parent ↔ child forwarding
// (e.g. attached panel → main window) is also covered.
// ---------------------------------------------------------------------------

export function setShortcutRecordingActive(webContentsId: number, active: boolean): void {
  if (!Number.isInteger(webContentsId) || webContentsId <= 0) return
  if (active) {
    recordingWebContentsIds.add(webContentsId)
    hookAllWindows(webContentsId)
  } else {
    recordingWebContentsIds.delete(webContentsId)
    if (recordingWebContentsIds.size === 0) unhookAllWindows()
  }
}

function hookAllWindows(recordingWcId: number): void {
  if (process.platform !== 'win32') return
  sysKeyShiftHeld = false
  const recordingWin = windowsByWebContentsId.get(recordingWcId) ?? null

  for (const [, win] of windowsByWebContentsId) {
    if (win.isDestroyed()) continue
    hookSingleWindow(win, recordingWin)
  }
}

function hookSingleWindow(win: BrowserWindow, recordingWin: BrowserWindow | null): void {
  try {
    if (!win.isWindowMessageHooked(WM_SYSCOMMAND)) {
      win.hookWindowMessage(WM_SYSCOMMAND, () => { /* block */ })
    }
  } catch { /* ignore */ }

  try {
    if (!win.isWindowMessageHooked(WM_SYSKEYDOWN)) {
      win.hookWindowMessage(WM_SYSKEYDOWN, (wParam: Buffer, lParam: Buffer) => {
        if (recordingWebContentsIds.size === 0) return

        const vk = readVK(wParam)

        if (vk === VK_SHIFT) { sysKeyShiftHeld = true; return }
        if (vk === VK_CONTROL || vk === VK_MENU || vk === VK_LWIN || vk === VK_RWIN) return

        const isRepeat = lParam.length >= 4 ? ((lParam.readUInt32LE(0) >>> 30) & 1) === 1 : false
        if (isRepeat) return

        const target = recordingWin && !recordingWin.isDestroyed() ? recordingWin : null
        if (!target) return

        const mainKey = virtualKeyToAcceleratorKey(vk)
        if (!mainKey) return

        const parts: string[] = ['Alt']
        if (sysKeyShiftHeld) parts.push('Shift')
        parts.push(mainKey)
        target.webContents.send('settings:shortcut:captured', parts.join('+'))
      })
    }
  } catch { /* ignore */ }

  try {
    if (!win.isWindowMessageHooked(WM_SYSKEYUP)) {
      win.hookWindowMessage(WM_SYSKEYUP, (wParam: Buffer) => {
        if (readVK(wParam) === VK_SHIFT) sysKeyShiftHeld = false
      })
    }
  } catch { /* ignore */ }
}

function unhookAllWindows(): void {
  if (process.platform !== 'win32') return
  sysKeyShiftHeld = false
  for (const [, win] of windowsByWebContentsId) {
    if (win.isDestroyed()) continue
    for (const msg of HOOKED_MSGS) {
      try {
        if (win.isWindowMessageHooked(msg)) win.unhookWindowMessage(msg)
      } catch { /* ignore */ }
    }
  }
}

function readVK(wParam: Buffer): number {
  return wParam.length >= 4 ? wParam.readUInt32LE(0) & 0xFF : 0
}

function virtualKeyToAcceleratorKey(vk: number): string | null {
  if (vk >= 0x41 && vk <= 0x5A) return String.fromCharCode(vk)
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk)
  if (vk === 0x20) return 'Space'
  if (vk >= 0x70 && vk <= 0x7B) return `F${vk - 0x6F}`
  if (vk === 0x25) return 'Left'
  if (vk === 0x26) return 'Up'
  if (vk === 0x27) return 'Right'
  if (vk === 0x28) return 'Down'
  if (vk === 0x09) return 'Tab'
  if (vk === 0x2D) return 'Insert'
  if (vk === 0x2E) return 'Delete'
  if (vk === 0x24) return 'Home'
  if (vk === 0x23) return 'End'
  if (vk === 0x21) return 'PageUp'
  if (vk === 0x22) return 'PageDown'
  if (vk === 0xBA) return ';'
  if (vk === 0xBB) return '='
  if (vk === 0xBC) return ','
  if (vk === 0xBD) return '-'
  if (vk === 0xBE) return '.'
  if (vk === 0xBF) return '/'
  if (vk === 0xC0) return '`'
  if (vk === 0xDB) return '['
  if (vk === 0xDC) return '\\'
  if (vk === 0xDD) return ']'
  if (vk === 0xDE) return '\''
  return null
}

/**
 * Attach recording guard to a BrowserWindow.
 *
 * Alt+key shortcuts are captured via WM_SYSKEYDOWN hooks (Win32 message level)
 * so the system menu / menu-bar activation never fires.
 *
 * Non-Alt shortcuts (Ctrl+key, Ctrl+Shift+key, etc.) still flow through
 * Chromium's input pipeline and are captured via before-input-event.
 */
export function attachShortcutRecordingGuard(win: BrowserWindow): void {
  if (process.platform !== 'win32') return

  const webContentsId = win.webContents.id
  windowsByWebContentsId.set(webContentsId, win)

  const cleanup = () => {
    recordingWebContentsIds.delete(webContentsId)
    if (!win.isDestroyed()) {
      for (const msg of HOOKED_MSGS) {
        try {
          if (win.isWindowMessageHooked(msg)) win.unhookWindowMessage(msg)
        } catch { /* ignore */ }
      }
    }
    windowsByWebContentsId.delete(webContentsId)
    if (recordingWebContentsIds.size === 0) sysKeyShiftHeld = false
  }
  win.webContents.once('destroyed', cleanup)
  win.once('closed', cleanup)

  win.webContents.on('before-input-event', (event, input) => {
    if (!recordingWebContentsIds.has(webContentsId)) return

    if (input.type === 'keyDown' && input.key === 'Shift') sysKeyShiftHeld = true
    if (input.type === 'keyUp' && input.key === 'Shift') sysKeyShiftHeld = false

    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const accelerator = toAccelerator(input)
    if (!accelerator) return
    event.preventDefault()
    win.webContents.send('settings:shortcut:captured', accelerator)
  })
}
