import type { Rectangle } from 'electron'

interface WindowFrameInsets {
  top: number
  right: number
  bottom: number
  left: number
}

const ZERO_INSETS: WindowFrameInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0
}

export const MAIN_WINDOW_WINDOWS_FRAME_INSETS: Readonly<WindowFrameInsets> = {
  top: 10,
  right: 16,
  bottom: 24,
  left: 16
}
export const MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT = 62

function getMainWindowFrameInsets(): WindowFrameInsets {
  return process.platform === 'win32' ? MAIN_WINDOW_WINDOWS_FRAME_INSETS : ZERO_INSETS
}

export function getMainWindowVisibleBounds(bounds: Rectangle): Rectangle {
  const { top, right, bottom, left } = getMainWindowFrameInsets()
  return {
    x: Math.round(bounds.x + left),
    y: Math.round(bounds.y + top),
    width: Math.max(1, Math.round(bounds.width - left - right)),
    height: Math.max(1, Math.round(bounds.height - top - bottom))
  }
}

export function getMainWindowWindowBounds(bounds: Rectangle): Rectangle {
  const { top, right, bottom, left } = getMainWindowFrameInsets()
  return {
    x: Math.round(bounds.x - left),
    y: Math.round(bounds.y - top),
    width: Math.max(1, Math.round(bounds.width + left + right)),
    height: Math.max(1, Math.round(bounds.height + top + bottom))
  }
}

export function getMainWindowWindowSize(width: number, height: number): { width: number; height: number } {
  const bounds = getMainWindowWindowBounds({ x: 0, y: 0, width, height })
  return {
    width: bounds.width,
    height: bounds.height
  }
}
