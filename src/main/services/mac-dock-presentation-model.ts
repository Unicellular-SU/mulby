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
  | { type: 'plugin-window'; windowId: number; windowIds: number[]; pluginId: string; label: string }
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
  const pluginCount = countDockPlugins(pluginWindows)
  const badge = pluginCount > 1 ? String(pluginCount) : ''

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
  const pluginGroups = groupDockPluginWindows(presentation.pluginWindows)

  for (const group of pluginGroups) {
    items.push({
      type: 'plugin-window',
      windowId: group.representative.windowId,
      windowIds: group.windows.map((windowInfo) => windowInfo.windowId),
      pluginId: group.representative.pluginId,
      label: group.representative.displayName
    })
  }

  if (pluginGroups.length > 1) {
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

export function countDockPlugins(
  windows: MacDockPluginWindowSnapshot[]
): number {
  return new Set(windows.map((windowInfo) => windowInfo.pluginId)).size
}

export function groupDockPluginWindows(
  windows: MacDockPluginWindowSnapshot[]
): Array<{
  representative: MacDockPluginWindowSnapshot
  windows: MacDockPluginWindowSnapshot[]
}> {
  const groupsByPluginId = new Map<string, MacDockPluginWindowSnapshot[]>()

  for (const windowInfo of sortDockPluginWindows(windows)) {
    const group = groupsByPluginId.get(windowInfo.pluginId)
    if (group) {
      group.push(windowInfo)
    } else {
      groupsByPluginId.set(windowInfo.pluginId, [windowInfo])
    }
  }

  return Array.from(groupsByPluginId.values()).map((group) => ({
    representative: group[0],
    windows: group
  }))
}
