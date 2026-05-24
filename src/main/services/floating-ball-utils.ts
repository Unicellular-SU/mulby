import { extname } from 'node:path'
import type { AutoPasteClipboardPayload, FileInfo } from '../../shared/types/electron'
import type {
  FloatingBallActionBinding,
  FloatingBallActionSettings,
  FloatingBallBuiltinAction,
  FloatingBallCommandTarget,
  FloatingBallPosition,
  FloatingBallSettings
} from '../../shared/types/settings'

export interface FloatingBallDisplayInfo {
  id: number
  workArea: { x: number; y: number; width: number; height: number }
}

export interface FloatingBallFileDropItem {
  path: string
  name: string
  size: number
  type: string
  isDirectory: boolean
}

const DEFAULT_FLOATING_BALL_SETTINGS: FloatingBallSettings = {
  enabled: false,
  label: 'M',
  size: 52,
  opacity: 0.92,
  snapToEdge: true,
  actions: {
    click: { type: 'builtin', action: 'toggleMulby' },
    doubleClick: { type: 'inheritClick' },
    longPress: { type: 'builtin', action: 'captureRegion' }
  },
  dropAction: 'openMatches'
}

const MIN_SIZE = 40
const MAX_SIZE = 80
const MIN_OPACITY = 0.35
const MAX_OPACITY = 1
const EDGE_GAP = 8
export const FLOATING_BALL_SHADOW_PADDING = 16

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizePosition(input: unknown): FloatingBallPosition | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  const displayId = Number(value.displayId)
  return {
    x: Math.round(x),
    y: Math.round(y),
    displayId: Number.isFinite(displayId) ? displayId : undefined
  }
}

function normalizeCommandTarget(input: unknown): FloatingBallCommandTarget | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  const pluginId = String(value.pluginId || '').trim()
  const featureCode = String(value.featureCode || '').trim()
  if (!pluginId || !featureCode) return undefined
  const target: FloatingBallCommandTarget = { pluginId, featureCode }
  const cmdId = String(value.cmdId || '').trim()
  const cmdSignature = String(value.cmdSignature || '').trim()
  const commandLabel = String(value.commandLabel || '').trim()
  if (cmdId) target.cmdId = cmdId
  if (cmdSignature) target.cmdSignature = cmdSignature
  if (commandLabel) target.commandLabel = commandLabel
  return target
}

function normalizeBuiltinAction(input: unknown): FloatingBallBuiltinAction | undefined {
  return input === 'toggleMulby' || input === 'captureRegion' ? input : undefined
}

function normalizeActionBinding(input: unknown, fallback: FloatingBallActionBinding): FloatingBallActionBinding {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fallback
  const value = input as Record<string, unknown>
  if (value.type === 'inheritClick') return { type: 'inheritClick' }
  if (value.type === 'builtin') {
    const action = normalizeBuiltinAction(value.action)
    return action ? { type: 'builtin', action } : fallback
  }
  if (value.type === 'command') {
    const target = normalizeCommandTarget(value.target)
    return target ? { type: 'command', target } : fallback
  }
  return fallback
}

function normalizeActionSettings(current: Partial<FloatingBallSettings>): FloatingBallActionSettings {
  const defaults = DEFAULT_FLOATING_BALL_SETTINGS.actions
  const source: Partial<FloatingBallActionSettings> = current.actions || {}
  const legacyDoubleClick = normalizeCommandTarget(current.doubleClickCommand)

  return {
    click: normalizeActionBinding(source.click, defaults.click),
    doubleClick: normalizeActionBinding(
      source.doubleClick,
      legacyDoubleClick ? { type: 'command', target: legacyDoubleClick } : defaults.doubleClick
    ),
    longPress: normalizeActionBinding(source.longPress, defaults.longPress)
  }
}

export function normalizeFloatingBallSettings(input: Partial<FloatingBallSettings> | undefined): FloatingBallSettings {
  const current = {
    ...DEFAULT_FLOATING_BALL_SETTINGS,
    ...(input || {})
  }
  const labelSource = String(current.label || DEFAULT_FLOATING_BALL_SETTINGS.label).trim()
  const label = Array.from(labelSource || DEFAULT_FLOATING_BALL_SETTINGS.label).slice(0, 2).join('')
  const size = clamp(Number(current.size || DEFAULT_FLOATING_BALL_SETTINGS.size), MIN_SIZE, MAX_SIZE)
  const opacity = clamp(Number(current.opacity || DEFAULT_FLOATING_BALL_SETTINGS.opacity), MIN_OPACITY, MAX_OPACITY)

  const normalized: FloatingBallSettings = {
    enabled: current.enabled === true,
    label: label || DEFAULT_FLOATING_BALL_SETTINGS.label,
    size: Math.round(size),
    opacity: Number(opacity.toFixed(2)),
    snapToEdge: current.snapToEdge !== false,
    actions: normalizeActionSettings(input || {}),
    dropAction: 'openMatches'
  }
  const position = normalizePosition(current.position)
  if (position) normalized.position = position
  return normalized
}

function intersectsWorkArea(position: FloatingBallPosition, display: FloatingBallDisplayInfo, size: number): boolean {
  const area = display.workArea
  return position.x < area.x + area.width
    && position.x + size > area.x
    && position.y < area.y + area.height
    && position.y + size > area.y
}

function findPositionDisplay(
  position: FloatingBallPosition,
  displays: FloatingBallDisplayInfo[],
  size: number
): FloatingBallDisplayInfo | undefined {
  const byId = displays.find((display) => display.id === position.displayId)
  if (byId && intersectsWorkArea(position, byId, size)) return byId
  return displays.find((display) => intersectsWorkArea(position, display, size))
}

export function snapFloatingBallPosition(input: {
  position: { x: number; y: number }
  display: FloatingBallDisplayInfo
  size: number
  gap?: number
}): FloatingBallPosition {
  const gap = input.gap ?? EDGE_GAP
  const { workArea } = input.display
  const size = Math.max(1, Math.round(input.size))
  const centerX = input.position.x + size / 2
  const displayCenterX = workArea.x + workArea.width / 2
  const x = centerX <= displayCenterX
    ? workArea.x + gap
    : workArea.x + workArea.width - size - gap
  const y = clamp(
    Math.round(input.position.y),
    workArea.y + gap,
    workArea.y + workArea.height - size - gap
  )
  return { x: Math.round(x), y, displayId: input.display.id }
}

export function getFloatingBallWindowSize(size: number, shadowPadding = FLOATING_BALL_SHADOW_PADDING): number {
  return Math.max(1, Math.round(size) + Math.max(0, Math.round(shadowPadding)) * 2)
}

export function getFloatingBallWindowPosition(
  position: { x: number; y: number },
  shadowPadding = FLOATING_BALL_SHADOW_PADDING
): FloatingBallPosition {
  const padding = Math.max(0, Math.round(shadowPadding))
  const next: FloatingBallPosition = {
    x: Math.round(position.x) - padding,
    y: Math.round(position.y) - padding
  }
  if ('displayId' in position && Number.isFinite((position as FloatingBallPosition).displayId)) {
    next.displayId = (position as FloatingBallPosition).displayId
  }
  return next
}

export function getFloatingBallVisualPosition(
  bounds: { x: number; y: number },
  shadowPadding = FLOATING_BALL_SHADOW_PADDING
): FloatingBallPosition {
  const padding = Math.max(0, Math.round(shadowPadding))
  const next: FloatingBallPosition = {
    x: Math.round(bounds.x) + padding,
    y: Math.round(bounds.y) + padding
  }
  if ('displayId' in bounds && Number.isFinite((bounds as FloatingBallPosition).displayId)) {
    next.displayId = (bounds as FloatingBallPosition).displayId
  }
  return next
}

export function resolveFloatingBallPosition(input: {
  savedPosition?: FloatingBallPosition
  displays: FloatingBallDisplayInfo[]
  size: number
  cursorDisplayId?: number
}): FloatingBallPosition {
  const displays = input.displays
  const size = Math.max(1, Math.round(input.size))
  const saved = input.savedPosition
  if (saved) {
    const display = findPositionDisplay(saved, displays, size)
    if (display) {
      return {
        x: clamp(Math.round(saved.x), display.workArea.x + EDGE_GAP, display.workArea.x + display.workArea.width - size - EDGE_GAP),
        y: clamp(Math.round(saved.y), display.workArea.y + EDGE_GAP, display.workArea.y + display.workArea.height - size - EDGE_GAP),
        displayId: display.id
      }
    }
  }

  const display = displays.find((item) => item.id === input.cursorDisplayId) || displays[0]
  if (!display) return { x: EDGE_GAP, y: EDGE_GAP }
  const area = display.workArea
  return {
    x: area.x + area.width - size - EDGE_GAP,
    y: area.y + Math.round((area.height - size) / 2),
    displayId: display.id
  }
}

export function isFloatingBallPluginPackageDrop(files: Pick<FileInfo, 'name' | 'path'>[]): boolean {
  return files.some((file) => {
    const name = String(file.name || '').toLowerCase()
    const path = String(file.path || '').toLowerCase()
    return name.endsWith('.inplugin') || path.endsWith('.inplugin')
  })
}

export function buildFloatingBallFilePayload(files: FloatingBallFileDropItem[]): AutoPasteClipboardPayload {
  return {
    format: 'files',
    files: files.map((file) => ({
      path: file.path,
      name: file.name,
      size: file.size,
      type: file.type || (file.isDirectory ? 'directory' : ''),
      isDirectory: file.isDirectory
    }))
  }
}

export function extensionForFloatingBallPath(filePath: string): string {
  return extname(filePath).toLowerCase()
}
