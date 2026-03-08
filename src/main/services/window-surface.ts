import type { BrowserWindow, Rectangle } from 'electron'

export interface WindowSurfaceInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export const WINDOWS_FRAMELESS_SURFACE_INSETS: Readonly<WindowSurfaceInsets> = {
  top: 10,
  right: 16,
  bottom: 24,
  left: 16
}

const ZERO_INSETS: Readonly<WindowSurfaceInsets> = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0
}

const WINDOW_SURFACE_RADIUS_PX = 12
const WINDOW_SURFACE_TITLEBAR_HEIGHT_PX = 36
const WINDOW_SURFACE_SHADOW_LIGHT = [
  '0 18px 32px -20px rgba(15, 23, 42, 0.3)',
  '0 8px 18px -12px rgba(15, 23, 42, 0.16)',
  '0 2px 6px rgba(15, 23, 42, 0.08)'
].join(', ')
const WINDOW_SURFACE_SHADOW_DARK = [
  '0 20px 36px -20px rgba(2, 6, 23, 0.58)',
  '0 10px 20px -12px rgba(2, 6, 23, 0.3)',
  '0 2px 8px rgba(2, 6, 23, 0.16)'
].join(', ')

export interface ApplyWindowSurfaceOptions {
  includeTitleBar?: boolean
}

export function shouldUseWindowsFramelessSurface(): boolean {
  return process.platform === 'win32'
}

export function getWindowsFramelessSurfaceInsets(): WindowSurfaceInsets {
  return shouldUseWindowsFramelessSurface() ? WINDOWS_FRAMELESS_SURFACE_INSETS : ZERO_INSETS
}

export function getWindowsFramelessSurfaceVisibleBounds(bounds: Rectangle): Rectangle {
  const { top, right, bottom, left } = getWindowsFramelessSurfaceInsets()
  return {
    x: Math.round(bounds.x + left),
    y: Math.round(bounds.y + top),
    width: Math.max(1, Math.round(bounds.width - left - right)),
    height: Math.max(1, Math.round(bounds.height - top - bottom))
  }
}

export function getWindowsFramelessSurfaceWindowBounds(bounds: Rectangle): Rectangle {
  const { top, right, bottom, left } = getWindowsFramelessSurfaceInsets()
  return {
    x: Math.round(bounds.x - left),
    y: Math.round(bounds.y - top),
    width: Math.max(1, Math.round(bounds.width + left + right)),
    height: Math.max(1, Math.round(bounds.height + top + bottom))
  }
}

export function getWindowsFramelessSurfaceWindowSize(width: number, height: number): { width: number; height: number } {
  const bounds = getWindowsFramelessSurfaceWindowBounds({ x: 0, y: 0, width, height })
  return {
    width: bounds.width,
    height: bounds.height
  }
}

function buildWindowSurfaceCss(includeTitleBar: boolean): string {
  const { top, right, bottom, left } = WINDOWS_FRAMELESS_SURFACE_INSETS
  const contentTopPadding = top + (includeTitleBar ? WINDOW_SURFACE_TITLEBAR_HEIGHT_PX : 0)
  const contentRadius = includeTitleBar
    ? `0 0 ${WINDOW_SURFACE_RADIUS_PX}px ${WINDOW_SURFACE_RADIUS_PX}px`
    : `${WINDOW_SURFACE_RADIUS_PX}px`

  return `
html,
body {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  background: transparent !important;
  overflow: hidden !important;
}

body {
  padding: ${contentTopPadding}px ${right}px ${bottom}px ${left}px !important;
  box-sizing: border-box !important;
  background: transparent !important;
}

#mulby-window-surface-shadow {
  position: fixed !important;
  inset: ${top}px ${right}px ${bottom}px ${left}px !important;
  border-radius: ${WINDOW_SURFACE_RADIUS_PX}px !important;
  box-shadow: ${WINDOW_SURFACE_SHADOW_LIGHT} !important;
  pointer-events: none !important;
  z-index: 0 !important;
}

.dark #mulby-window-surface-shadow,
.light.dark #mulby-window-surface-shadow,
:root.dark #mulby-window-surface-shadow {
  box-shadow: ${WINDOW_SURFACE_SHADOW_DARK} !important;
}

#mulby-window-content-host {
  position: relative !important;
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  overflow: hidden !important;
  border-radius: ${contentRadius} !important;
  z-index: 1 !important;
  background: transparent !important;
}

${includeTitleBar ? `
#mulby-titlebar.it-pb-container {
  top: ${top}px !important;
  left: ${left}px !important;
  right: ${right}px !important;
  border-radius: ${WINDOW_SURFACE_RADIUS_PX}px ${WINDOW_SURFACE_RADIUS_PX}px 0 0 !important;
  overflow: hidden !important;
}
` : ''}
`
}

function buildWindowSurfaceScript(includeTitleBar: boolean): string {
  const preserveTitleBar = includeTitleBar ? ", 'mulby-titlebar'" : ''
  return `
(() => {
  const body = document.body
  if (!body) return

  const shadowId = 'mulby-window-surface-shadow'
  const hostId = 'mulby-window-content-host'
  const preserveIds = new Set([shadowId, hostId${preserveTitleBar}])

  let shadow = document.getElementById(shadowId)
  if (!shadow) {
    shadow = document.createElement('div')
    shadow.id = shadowId
    body.insertBefore(shadow, body.firstChild)
  }

  let host = document.getElementById(hostId)
  if (!host) {
    host = document.createElement('div')
    host.id = hostId
    body.appendChild(host)
  }

  for (const node of Array.from(body.childNodes)) {
    if (node === shadow || node === host) continue

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node
      const tagName = element.tagName
      if (preserveIds.has(element.id) || tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'LINK') {
        continue
      }
      host.appendChild(element)
      continue
    }

    if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim()) {
      host.appendChild(node)
    }
  }

  if (body.lastChild !== host) {
    body.appendChild(host)
  }
})()
`
}

export async function applyWindowsFramelessSurface(
  win: BrowserWindow,
  options: ApplyWindowSurfaceOptions = {}
): Promise<void> {
  if (!shouldUseWindowsFramelessSurface()) return
  if (win.isDestroyed()) return

  const includeTitleBar = options.includeTitleBar === true
  await win.webContents.insertCSS(buildWindowSurfaceCss(includeTitleBar))
  await win.webContents.executeJavaScript(buildWindowSurfaceScript(includeTitleBar))
}
