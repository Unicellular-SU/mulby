import type { Rectangle } from 'electron'

export const MAIN_WINDOW_WINDOWS_SHADOW_INSET = 12

function getMainWindowWindowsShadowInset(): number {
  return process.platform === 'win32' ? MAIN_WINDOW_WINDOWS_SHADOW_INSET : 0
}

export function getMainWindowVisibleBounds(bounds: Rectangle): Rectangle {
  const inset = getMainWindowWindowsShadowInset()
  return {
    x: Math.round(bounds.x + inset),
    y: Math.round(bounds.y + inset),
    width: Math.max(1, Math.round(bounds.width - inset * 2)),
    height: Math.max(1, Math.round(bounds.height - inset * 2))
  }
}

export function getMainWindowWindowBounds(bounds: Rectangle): Rectangle {
  const inset = getMainWindowWindowsShadowInset()
  return {
    x: Math.round(bounds.x - inset),
    y: Math.round(bounds.y - inset),
    width: Math.max(1, Math.round(bounds.width + inset * 2)),
    height: Math.max(1, Math.round(bounds.height + inset * 2))
  }
}

export function getMainWindowWindowSize(width: number, height: number): { width: number; height: number } {
  const bounds = getMainWindowWindowBounds({ x: 0, y: 0, width, height })
  return {
    width: bounds.width,
    height: bounds.height
  }
}
