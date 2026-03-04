import type { BrowserWindow, Input } from 'electron'

const recordingWebContentsIds = new Set<number>()

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

export function setShortcutRecordingActive(webContentsId: number, active: boolean): void {
  if (!Number.isInteger(webContentsId) || webContentsId <= 0) return
  if (active) {
    recordingWebContentsIds.add(webContentsId)
  } else {
    recordingWebContentsIds.delete(webContentsId)
  }
}

/**
 * During shortcut recording, Windows may swallow some combinations before
 * renderer key events. Intercept at native input stage and forward the
 * normalized accelerator to renderer.
 */
export function attachShortcutRecordingGuard(win: BrowserWindow): void {
  if (process.platform !== 'win32') return

  const webContentsId = win.webContents.id
  const cleanup = () => {
    recordingWebContentsIds.delete(webContentsId)
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
