export type ShortcutPlatform = NodeJS.Platform | 'mac' | 'windows'

export interface ShortcutBuildResult {
  accelerator: string
  error: string | null
}

export const SHORTCUT_MODIFIER_ERROR = '请按 Ctrl/Alt + 按键，或直接按 F1–F24'

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
  PageDown: 'PageDown',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace'
}

function getCurrentPlatform(): ShortcutPlatform {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform
  }
  if (typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')) {
    return 'darwin'
  }
  return 'win32'
}

export function isFunctionShortcutKey(key: string): boolean {
  const match = /^F(\d{1,2})$/.exec(key)
  if (!match) return false
  const number = Number(match[1])
  return Number.isInteger(number) && number >= 1 && number <= 24
}

export function normalizeShortcutKey(event: KeyboardEvent): string | null {
  const code = event.code || ''
  const rawKey = String(event.key || '')
  const trimmedKey = rawKey.trim()
  const key = trimmedKey.toLowerCase()

  if (!rawKey || key === 'escape' || key === 'dead') return null
  if (NON_MAIN_KEYS.has(key)) return null
  if (code in CODE_MAP) return CODE_MAP[code]
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toUpperCase()
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code

  if (/^[a-z]$/i.test(trimmedKey)) return trimmedKey.toUpperCase()
  if (/^\d$/.test(trimmedKey)) return trimmedKey
  if (/^f\d{1,2}$/i.test(trimmedKey)) return trimmedKey.toUpperCase()
  if (['space', 'spacebar'].includes(key)) return 'Space'
  if (['up', 'down', 'left', 'right'].includes(key)) {
    return key.charAt(0).toUpperCase() + key.slice(1)
  }
  if (key === 'pageup') return 'PageUp'
  if (key === 'pagedown') return 'PageDown'
  if (['tab', 'insert', 'delete', 'home', 'end', 'enter', 'return', 'backspace'].includes(key)) {
    if (key === 'return') return 'Enter'
    return key.charAt(0).toUpperCase() + key.slice(1)
  }
  if ([',', '.', '/', '\\', ';', '\'', '[', ']', '-', '=', '`'].includes(trimmedKey)) return trimmedKey
  return null
}

export function buildAcceleratorFromKeyboardEvent(
  event: KeyboardEvent,
  platform: ShortcutPlatform = getCurrentPlatform()
): ShortcutBuildResult {
  const isMac = isMacPlatform(platform)
  const parts: string[] = []
  if (isMac) {
    if (event.metaKey) parts.push('CommandOrControl')
    if (event.ctrlKey) parts.push('Control')
  } else {
    if (event.ctrlKey) parts.push('CommandOrControl')
    if (event.metaKey) parts.push('Meta')
  }
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const mainKey = normalizeShortcutKey(event)
  if (mainKey) parts.push(mainKey)

  const accelerator = parts.join('+')
  if (!mainKey) {
    return { accelerator, error: event.key === 'Escape' ? null : SHORTCUT_MODIFIER_ERROR }
  }

  const hasPrimaryModifier = event.metaKey || event.ctrlKey || event.altKey
  if (!hasPrimaryModifier && !isFunctionShortcutKey(mainKey)) {
    return { accelerator, error: SHORTCUT_MODIFIER_ERROR }
  }

  return { accelerator, error: null }
}

function isMacPlatform(platform: ShortcutPlatform): boolean {
  return platform === 'darwin' || platform === 'mac'
}

export function formatAcceleratorForPlatform(
  accelerator: string,
  platform: ShortcutPlatform = getCurrentPlatform()
): string {
  if (!accelerator) return accelerator
  const isMac = isMacPlatform(platform)
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
        case 'CmdOrCtrl':
          return isMac ? '⌘' : 'Ctrl'
        case 'Command':
        case 'Cmd':
          return isMac ? '⌘' : 'Ctrl'
        case 'Meta':
        case 'Super':
          return isMac ? '⌘' : 'Win'
        case 'Control':
          return 'Ctrl'
        case 'Option':
          return isMac ? '⌥' : 'Alt'
        case 'Alt':
          return isMac ? '⌥' : 'Alt'
        case 'Shift':
          return isMac ? '⇧' : 'Shift'
        default:
          return part
      }
    })
    .join('+')
}
