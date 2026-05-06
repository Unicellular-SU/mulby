import type { ResolvedIcon } from '../../shared/types/plugin'

export interface MacDockPluginWindowSnapshot {
  windowId: number
  pluginId: string
  displayName: string
  startedAt: number
  lastFocusedAt: number
  resolvedIcon?: ResolvedIcon
}

export interface MacDockPresentationInput {
  pluginWindows: MacDockPluginWindowSnapshot[]
  hasSystemDetachedWindow: boolean
}

export type MacDockPresentationMode = 'hidden' | 'system' | 'plugin'

export interface MacDockPresentation {
  mode: MacDockPresentationMode
  pluginWindows: MacDockPluginWindowSnapshot[]
  representativePluginWindow: MacDockPluginWindowSnapshot | null
  badge: string
}

export type MacDockMenuModelItem =
  | { type: 'plugin-window'; windowId: number; pluginId: string; label: string }
  | { type: 'close-all-plugin-windows'; label: string }
  | { type: 'open-main-window'; label: string }
  | { type: 'quit-app'; label: string }
  | { type: 'separator' }

export function sortDockPluginWindows(
  windows: MacDockPluginWindowSnapshot[]
): MacDockPluginWindowSnapshot[] {
  return [...windows].sort((left, right) => {
    const leftTime = left.lastFocusedAt || left.startedAt
    const rightTime = right.lastFocusedAt || right.startedAt
    if (rightTime !== leftTime) return rightTime - leftTime
    return right.startedAt - left.startedAt
  })
}

export function resolveMacDockPresentation(
  input: MacDockPresentationInput
): MacDockPresentation {
  const pluginWindows = sortDockPluginWindows(input.pluginWindows)
  const representativePluginWindow = pluginWindows[0] ?? null
  const badge = pluginWindows.length > 1 ? String(pluginWindows.length) : ''

  if (input.hasSystemDetachedWindow) {
    return {
      mode: 'system',
      pluginWindows,
      representativePluginWindow: null,
      badge
    }
  }

  if (representativePluginWindow) {
    return {
      mode: 'plugin',
      pluginWindows,
      representativePluginWindow,
      badge
    }
  }

  return {
    mode: 'hidden',
    pluginWindows: [],
    representativePluginWindow: null,
    badge: ''
  }
}

export function buildMacDockMenuModel(
  presentation: MacDockPresentation
): MacDockMenuModelItem[] {
  if (presentation.mode === 'hidden') return []

  const items: MacDockMenuModelItem[] = []

  for (const windowInfo of presentation.pluginWindows) {
    items.push({
      type: 'plugin-window',
      windowId: windowInfo.windowId,
      pluginId: windowInfo.pluginId,
      label: windowInfo.displayName
    })
  }

  if (presentation.pluginWindows.length > 1) {
    items.push({ type: 'separator' })
    items.push({
      type: 'close-all-plugin-windows',
      label: '关闭所有插件窗口'
    })
  }

  if (items.length > 0) {
    items.push({ type: 'separator' })
  }

  items.push({ type: 'open-main-window', label: '打开 Mulby' })
  items.push({ type: 'quit-app', label: '退出 Mulby' })

  return items
}
