type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta'

export type SystemReservedShortcutReason =
  | 'win-meta'
  | 'win-alt-space'
  | 'win-alt-tab'
  | 'win-alt-escape'
  | 'win-alt-f4'
  | 'win-ctrl-escape'

interface ParsedAccelerator {
  modifiers: Set<ModifierKey>
  key: string | null
}

const MODIFIER_KEYS = new Set<ModifierKey>(['ctrl', 'alt', 'shift', 'meta'])

function normalizeToken(token: string): string {
  const normalized = token.trim().toLowerCase()
  switch (normalized) {
    case 'commandorcontrol':
    case 'cmdorctrl':
    case 'control':
    case 'ctrl':
      return 'ctrl'
    case 'option':
    case 'alt':
      return 'alt'
    case 'shift':
      return 'shift'
    case 'meta':
    case 'super':
    case 'win':
    case 'windows':
    case 'command':
    case 'cmd':
      return 'meta'
    case 'esc':
      return 'escape'
    default:
      return normalized
  }
}

function parseAccelerator(accelerator: string): ParsedAccelerator {
  const modifiers = new Set<ModifierKey>()
  let key: string | null = null
  for (const token of accelerator.split('+').map(normalizeToken)) {
    if (!token) continue
    if (MODIFIER_KEYS.has(token as ModifierKey)) {
      modifiers.add(token as ModifierKey)
      continue
    }
    key = token
  }
  return { modifiers, key }
}

function hasExactModifiers(modifiers: Set<ModifierKey>, expected: ModifierKey[]): boolean {
  if (modifiers.size !== expected.length) return false
  for (const modifier of expected) {
    if (!modifiers.has(modifier)) return false
  }
  return true
}

export function detectSystemReservedShortcut(
  accelerator: string,
  platform: NodeJS.Platform = process.platform
): SystemReservedShortcutReason | null {
  if (platform !== 'win32') return null

  const { modifiers, key } = parseAccelerator(accelerator)
  if (!key) return null

  if (modifiers.has('meta')) {
    return 'win-meta'
  }
  if (key === 'space' && hasExactModifiers(modifiers, ['alt'])) {
    return 'win-alt-space'
  }
  if (key === 'tab' && hasExactModifiers(modifiers, ['alt'])) {
    return 'win-alt-tab'
  }
  if (key === 'escape' && hasExactModifiers(modifiers, ['alt'])) {
    return 'win-alt-escape'
  }
  if (key === 'f4' && hasExactModifiers(modifiers, ['alt'])) {
    return 'win-alt-f4'
  }
  if (key === 'escape' && hasExactModifiers(modifiers, ['ctrl'])) {
    return 'win-ctrl-escape'
  }
  return null
}
