import type { BrowserWindow, Input } from 'electron'

const WM_INITMENU = 0x0116

const recordingWebContentsIds = new Set<number>()
const windowsByWebContentsId = new Map<number, BrowserWindow>()

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
// WM_INITMENU hook — suppress the system menu during recording
//
// Windows sends WM_INITMENU (0x0116) to the top-level window right before any
// menu (including the Alt+Space system menu) is shown. By briefly toggling
// setEnabled the menu initialisation is aborted and the menu never appears.
//
// This is a well-known Electron workaround:
//   https://github.com/electron/electron/issues/24893#issuecomment-1109262719
// ---------------------------------------------------------------------------

export function setShortcutRecordingActive(webContentsId: number, active: boolean): void {
  if (!Number.isInteger(webContentsId) || webContentsId <= 0) return
  if (active) {
    recordingWebContentsIds.add(webContentsId)
    hookInitMenuOnAllWindows()
  } else {
    recordingWebContentsIds.delete(webContentsId)
    if (recordingWebContentsIds.size === 0) unhookInitMenuOnAllWindows()
  }
}

function hookInitMenuOnAllWindows(): void {
  if (process.platform !== 'win32') return
  for (const [, win] of windowsByWebContentsId) {
    if (win.isDestroyed()) continue
    try {
      if (!win.isWindowMessageHooked(WM_INITMENU)) {
        win.hookWindowMessage(WM_INITMENU, () => {
          if (!win.isDestroyed()) {
            win.setEnabled(false)
            win.setEnabled(true)
          }
        })
      }
    } catch { /* ignore */ }
  }
}

function unhookInitMenuOnAllWindows(): void {
  if (process.platform !== 'win32') return
  for (const [, win] of windowsByWebContentsId) {
    if (win.isDestroyed()) continue
    try {
      if (win.isWindowMessageHooked(WM_INITMENU)) {
        win.unhookWindowMessage(WM_INITMENU)
      }
    } catch { /* ignore */ }
  }
}

/**
 * Attach recording guard to a BrowserWindow.
 *
 * Shortcut capture uses before-input-event which fires for all key
 * combinations including Alt+Space. During recording WM_INITMENU is
 * hooked to suppress the system menu that Alt+Space would otherwise show.
 */
export function attachShortcutRecordingGuard(win: BrowserWindow): void {
  if (process.platform !== 'win32') return

  const webContentsId = win.webContents.id
  windowsByWebContentsId.set(webContentsId, win)

  const cleanup = () => {
    recordingWebContentsIds.delete(webContentsId)
    if (!win.isDestroyed()) {
      try {
        if (win.isWindowMessageHooked(WM_INITMENU)) win.unhookWindowMessage(WM_INITMENU)
      } catch { /* ignore */ }
    }
    windowsByWebContentsId.delete(webContentsId)
  }
  win.webContents.once('destroyed', cleanup)
  win.once('closed', cleanup)

  win.webContents.on('before-input-event', (event, input) => {
    if (!recordingWebContentsIds.has(webContentsId)) return
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const accelerator = toAccelerator(input)
    if (!accelerator) return
    event.preventDefault()
    win.webContents.send('settings:shortcut:captured', accelerator)
  })
}
