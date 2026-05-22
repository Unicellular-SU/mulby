import type { BrowserWindow, Rectangle, WebContents } from 'electron'

export interface WindowSurfaceInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export const WINDOWS_FRAMELESS_SURFACE_INSETS: Readonly<WindowSurfaceInsets> = {
  top: 18,
  right: 18,
  bottom: 18,
  left: 18
}

const ZERO_INSETS: Readonly<WindowSurfaceInsets> = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0
}

const WINDOW_SURFACE_RADIUS_PX = 12
const WINDOW_SURFACE_TITLEBAR_HEIGHT_PX = 36
const WINDOW_RESIZE_HANDLE_THICKNESS_PX = 12
const WINDOW_RESIZE_HANDLE_CORNER_PX = 16
const WINDOW_SURFACE_BACKGROUND_LIGHT = '#ffffff'
const WINDOW_SURFACE_BACKGROUND_DARK = '#1e293b'
const WINDOW_SURFACE_SHADOW_LIGHT = [
  '0 6px 12px rgba(15, 23, 42, 0.14)',
  '0 1px 3px rgba(15, 23, 42, 0.10)'
].join(', ')
const WINDOW_SURFACE_SHADOW_DARK = [
  '0 6px 14px rgba(0, 0, 0, 0.34)',
  '0 1px 3px rgba(0, 0, 0, 0.26)'
].join(', ')

export interface ApplyWindowSurfaceOptions {
  includeTitleBar?: boolean
  resizeMode?: WindowResizeMode
  contentBackground?: 'theme' | 'transparent'
}

export type WindowResizeMode = 'none' | 'bottom' | 'side-bottom' | 'all'

export interface ApplyWindowResizeHandlesOptions {
  resizeMode?: WindowResizeMode
}

interface ResizeHandleLayout {
  edge: string
  cursor: string
  styles: string
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

function buildWindowSurfaceCss(includeTitleBar: boolean, contentBackground: 'theme' | 'transparent'): string {
  const { top, right, bottom, left } = WINDOWS_FRAMELESS_SURFACE_INSETS
  const contentTopPadding = top + (includeTitleBar ? WINDOW_SURFACE_TITLEBAR_HEIGHT_PX : 0)
  const contentRadius = includeTitleBar
    ? `0 0 ${WINDOW_SURFACE_RADIUS_PX}px ${WINDOW_SURFACE_RADIUS_PX}px`
    : `${WINDOW_SURFACE_RADIUS_PX}px`
  const contentBackgroundLight = contentBackground === 'transparent'
    ? 'transparent'
    : WINDOW_SURFACE_BACKGROUND_LIGHT
  const contentBackgroundDark = contentBackground === 'transparent'
    ? 'transparent'
    : WINDOW_SURFACE_BACKGROUND_DARK
  // body already uses border-box + padding to reserve top/bottom insets, so host should
  // fill the body content box directly instead of subtracting those insets again.
  const hostHeight = '100%'

  return `
html,
body {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  background: transparent !important;
  overflow: hidden !important;
  border-radius: ${WINDOW_SURFACE_RADIUS_PX}px !important;
}

body {
  padding: ${contentTopPadding}px ${right}px ${bottom}px ${left}px !important;
  box-sizing: border-box !important;
  background: transparent !important;
  position: relative !important;
}

#mulby-window-surface-shadow {
  position: fixed !important;
  inset: ${top}px ${right}px ${bottom}px ${left}px !important;
  border-radius: ${WINDOW_SURFACE_RADIUS_PX}px !important;
  box-shadow: ${WINDOW_SURFACE_SHADOW_LIGHT} !important;
  pointer-events: none !important;
  z-index: 2 !important;
  background: transparent !important;
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
  height: ${hostHeight} !important;
  overflow: hidden !important;
  border-radius: ${contentRadius} !important;
  z-index: 1 !important;
  background: ${contentBackgroundLight} !important;
}

.dark #mulby-window-content-host,
.light.dark #mulby-window-content-host,
:root.dark #mulby-window-content-host {
  background: ${contentBackgroundDark} !important;
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

function buildResizeHandleLayouts(resizeMode: WindowResizeMode): ResizeHandleLayout[] {
  if (resizeMode === 'none') return []
  if (resizeMode === 'bottom') {
    return [{
      edge: 'bottom',
      cursor: 'ns-resize',
      styles: `left: 0; right: 0; bottom: 0; height: ${WINDOW_RESIZE_HANDLE_THICKNESS_PX}px;`
    }]
  }

  const allHandles: ResizeHandleLayout[] = [
    {
      edge: 'top',
      cursor: 'ns-resize',
      styles: `top: 0; left: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; right: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; height: ${WINDOW_RESIZE_HANDLE_THICKNESS_PX}px;`
    },
    {
      edge: 'right',
      cursor: 'ew-resize',
      styles: `top: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; right: 0; bottom: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; width: ${WINDOW_RESIZE_HANDLE_THICKNESS_PX}px;`
    },
    {
      edge: 'bottom',
      cursor: 'ns-resize',
      styles: `left: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; right: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; bottom: 0; height: ${WINDOW_RESIZE_HANDLE_THICKNESS_PX}px;`
    },
    {
      edge: 'left',
      cursor: 'ew-resize',
      styles: `top: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; left: 0; bottom: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; width: ${WINDOW_RESIZE_HANDLE_THICKNESS_PX}px;`
    },
    {
      edge: 'top-left',
      cursor: 'nwse-resize',
      styles: `top: 0; left: 0; width: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; height: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px;`
    },
    {
      edge: 'top-right',
      cursor: 'nesw-resize',
      styles: `top: 0; right: 0; width: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; height: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px;`
    },
    {
      edge: 'bottom-right',
      cursor: 'nwse-resize',
      styles: `right: 0; bottom: 0; width: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; height: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px;`
    },
    {
      edge: 'bottom-left',
      cursor: 'nesw-resize',
      styles: `left: 0; bottom: 0; width: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px; height: ${WINDOW_RESIZE_HANDLE_CORNER_PX}px;`
    }
  ]

  if (resizeMode === 'side-bottom') {
    return allHandles.filter((handle) => (
      handle.edge === 'left'
      || handle.edge === 'right'
      || handle.edge === 'bottom'
      || handle.edge === 'bottom-left'
      || handle.edge === 'bottom-right'
    ))
  }

  return allHandles
}

function buildWindowResizeCss(resizeMode: WindowResizeMode): string {
  if (resizeMode === 'none') return ''

  const { top, right, bottom, left } = WINDOWS_FRAMELESS_SURFACE_INSETS
  const handleRules = buildResizeHandleLayouts(resizeMode)
    .map((handle) => `
#mulby-window-resize-layer [data-resize-edge="${handle.edge}"] {
  ${handle.styles}
  cursor: ${handle.cursor} !important;
}
`)
    .join('\n')

  return `
#mulby-window-resize-layer {
  position: fixed !important;
  inset: ${top}px ${right}px ${bottom}px ${left}px !important;
  z-index: 2147483646 !important;
  pointer-events: none !important;
}

#mulby-window-resize-layer .mulby-window-resize-handle {
  position: absolute !important;
  pointer-events: auto !important;
  background: transparent !important;
  touch-action: none !important;
  -webkit-app-region: no-drag !important;
}

${handleRules}
`
}

function buildWindowResizeScript(resizeMode: WindowResizeMode): string {
  const resizeHandles = buildResizeHandleLayouts(resizeMode)
  const resizeHandleMarkup = resizeHandles
    .map((handle) => `<div class="mulby-window-resize-handle" data-resize-edge="${handle.edge}"></div>`)
    .join('')

  return `
(() => {
  const resizeLayerId = 'mulby-window-resize-layer'
  const body = document.body
  if (!body) return

  const resizeMode = ${JSON.stringify(resizeMode)}
  let resizeLayer = document.getElementById(resizeLayerId)
  if (resizeMode === 'none') {
    if (resizeLayer) resizeLayer.remove()
    return
  }

  if (!resizeLayer) {
    resizeLayer = document.createElement('div')
    resizeLayer.id = resizeLayerId
    resizeLayer.innerHTML = ${JSON.stringify(resizeHandleMarkup)}
    resizeLayer.dataset.resizeMode = resizeMode
    body.appendChild(resizeLayer)
  } else if (!resizeLayer.hasChildNodes() || resizeLayer.dataset.resizeMode !== resizeMode) {
    resizeLayer.innerHTML = ${JSON.stringify(resizeHandleMarkup)}
    resizeLayer.dataset.resizeMode = resizeMode
  }

  const resizeApi = window.mulby && window.mulby.window && window.mulby.window.resizeDrag
  if (!resizeApi) return

  for (const handle of Array.from(resizeLayer.querySelectorAll('[data-resize-edge]'))) {
    const element = handle
    if (element.dataset.resizeBound === '1') continue
    element.dataset.resizeBound = '1'

    element.addEventListener('pointerdown', (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return

      const edge = element.getAttribute('data-resize-edge')
      if (!edge) return

      const baseBounds = {
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight
      }

      const state = {
        edge,
        pointerId: event.pointerId,
        startX: event.screenX,
        startY: event.screenY,
        lastX: event.screenX,
        lastY: event.screenY,
        rafId: 0
      }

      const applyResize = () => {
        state.rafId = 0
        resizeApi({
          edge: state.edge,
          startX: state.startX,
          startY: state.startY,
          currentX: state.lastX,
          currentY: state.lastY,
          baseBounds
        })
      }

      const onPointerMove = (moveEvent) => {
        if (!(moveEvent instanceof PointerEvent) || moveEvent.pointerId !== state.pointerId) return
        state.lastX = moveEvent.screenX
        state.lastY = moveEvent.screenY
        if (state.rafId !== 0) return
        state.rafId = window.requestAnimationFrame(applyResize)
      }

      const cleanup = () => {
        if (state.rafId !== 0) {
          window.cancelAnimationFrame(state.rafId)
          state.rafId = 0
        }
        element.removeEventListener('pointermove', onPointerMove)
        element.removeEventListener('pointerup', onPointerUp)
        element.removeEventListener('pointercancel', onPointerCancel)
        if (element.hasPointerCapture(state.pointerId)) {
          element.releasePointerCapture(state.pointerId)
        }
      }

      const onPointerUp = (upEvent) => {
        if (!(upEvent instanceof PointerEvent) || upEvent.pointerId !== state.pointerId) return
        state.lastX = upEvent.screenX
        state.lastY = upEvent.screenY
        if (state.rafId !== 0) {
          window.cancelAnimationFrame(state.rafId)
          state.rafId = 0
        }
        applyResize()
        cleanup()
      }

      const onPointerCancel = (cancelEvent) => {
        if (!(cancelEvent instanceof PointerEvent) || cancelEvent.pointerId !== state.pointerId) return
        cleanup()
      }

      event.preventDefault()
      event.stopPropagation()
      element.setPointerCapture(state.pointerId)
      element.addEventListener('pointermove', onPointerMove)
      element.addEventListener('pointerup', onPointerUp)
      element.addEventListener('pointercancel', onPointerCancel)
    })
  }
})()
`
}

function buildWindowSurfaceScript(includeTitleBar: boolean, resizeMode: WindowResizeMode): string {
  const preserveTitleBar = includeTitleBar ? ", 'mulby-titlebar'" : ''

  return `
(() => {
  const body = document.body
  if (!body) return

  const shadowId = 'mulby-window-surface-shadow'
  const hostId = 'mulby-window-content-host'
  const resizeLayerId = 'mulby-window-resize-layer'
  const preserveIds = new Set([shadowId, hostId, resizeLayerId${preserveTitleBar}])

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
${buildWindowResizeScript(resizeMode)}
`
}

export async function applyWindowsFramelessSurface(
  win: BrowserWindow,
  options: ApplyWindowSurfaceOptions = {}
): Promise<void> {
  if (!shouldUseWindowsFramelessSurface()) return
  if (win.isDestroyed()) return

  await applyWindowsFramelessSurfaceToWebContents(win.webContents, options)
}

export async function applyWindowsFramelessSurfaceToWebContents(
  webContents: WebContents,
  options: ApplyWindowSurfaceOptions = {}
): Promise<void> {
  if (!shouldUseWindowsFramelessSurface()) return
  if (webContents.isDestroyed()) return

  const includeTitleBar = options.includeTitleBar === true
  const resizeMode = options.resizeMode ?? 'all'
  const contentBackground = options.contentBackground ?? 'theme'
  await webContents.insertCSS(buildWindowSurfaceCss(includeTitleBar, contentBackground))
  await webContents.insertCSS(buildWindowResizeCss(resizeMode))
  await webContents.executeJavaScript(buildWindowSurfaceScript(includeTitleBar, resizeMode))
}

export async function applyWindowResizeHandlesToWebContents(
  webContents: WebContents,
  options: ApplyWindowResizeHandlesOptions = {}
): Promise<void> {
  if (webContents.isDestroyed()) return

  const resizeMode = options.resizeMode ?? 'all'
  await webContents.insertCSS(buildWindowResizeCss(resizeMode))
  await webContents.executeJavaScript(buildWindowResizeScript(resizeMode))
}
