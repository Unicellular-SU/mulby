import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const pluginWindowSourcePath = join(process.cwd(), 'src/main/plugin/window.ts')
const panelWindowSourcePath = join(process.cwd(), 'src/main/plugin/panel-window.ts')
const windowIpcSourcePath = join(process.cwd(), 'src/main/ipc/window.ts')
const windowSurfaceSourcePath = join(process.cwd(), 'src/main/services/window-surface.ts')

describe('detached window size pinning', () => {
  it('pins promoted panel windows so Windows titlebar dragging cannot fall back to setPosition drift', () => {
    const source = readFileSync(pluginWindowSourcePath, 'utf8')
    const promoteBranch = source.match(
      /\/\/ 使用 promoteToWindow 将面板升级为独立窗口[\s\S]*?return win\s*\n\s*\}\s*\n\s*\}/
    )

    assert.ok(promoteBranch, 'detachCurrent must handle the promoteToWindow path')
    assert.match(
      promoteBranch[0],
      /const promotedBounds = win\.getBounds\(\)[\s\S]*pinWindowSize\(windowId, promotedBounds\.width, promotedBounds\.height\)/,
      'promoted detached windows must register their actual size before titlebar dragging starts'
    )
    assert.match(
      promoteBranch[0],
      /win\.on\('closed', \(\) => \{[\s\S]*unpinWindowSize\(windowId\)/,
      'promoted detached windows must remove their pinned size when closed'
    )
  })

  it('keeps the pinned size in sync after custom resize drags', () => {
    const source = readFileSync(windowIpcSourcePath, 'utf8')
    const resizeDragHandler = source.match(
      /ipcMain\.on\('window:resizeDrag'[\s\S]*?\n\s*ipcMain\.on\('plugin:reload'/
    )

    assert.ok(resizeDragHandler, 'window:resizeDrag handler must exist')
    assert.match(
      resizeDragHandler[0],
      /const appliedWidth = Math\.max\(1, Math\.round\(clampedWidth\)\)[\s\S]*const appliedHeight = Math\.max\(1, Math\.round\(clampedHeight\)\)[\s\S]*updatePinnedSize\(win\.id, appliedWidth, appliedHeight\)/,
      'custom resize drags must update the pinned size used by later Windows titlebar moves'
    )
  })

  it('injects resize handles into WebContentsView-backed detached plugin content', () => {
    const pluginWindowSource = readFileSync(pluginWindowSourcePath, 'utf8')
    const panelWindowSource = readFileSync(panelWindowSourcePath, 'utf8')
    const windowSurfaceSource = readFileSync(windowSurfaceSourcePath, 'utf8')

    assert.match(
      windowSurfaceSource,
      /export type WindowResizeMode = 'none' \| 'bottom' \| 'side-bottom' \| 'all'/,
      'window surface must support side/bottom resize handles for plugin WebContentsView content'
    )
    assert.match(
      pluginWindowSource,
      /applyWindowResizeHandlesToWebContents\(pluginWebContents,[\s\S]*resizeMode: showTitleBar \? 'side-bottom' : 'all'/,
      'fresh detached titlebar windows must inject resize handles into the plugin WebContentsView'
    )
    assert.match(
      pluginWindowSource,
      /const shouldInjectPluginResizeHandles = isResizable && !isFullscreen && process\.platform !== 'darwin'/,
      'fresh detached windows must not inject plugin-content resize handles on macOS'
    )
    assert.match(
      pluginWindowSource,
      /const pluginResizeUsesSurfaceInsets = useWindowsFramelessSurface && !showTitleBar && !windowConfig\.transparent[\s\S]*useSurfaceInsets: pluginResizeUsesSurfaceInsets/,
      'fresh detached windows must only reserve surface insets for direct Windows surface content'
    )
    assert.match(
      panelWindowSource,
      /applyWindowResizeHandlesToWebContents\(pluginWebContents,[\s\S]*resizeMode: showTitleBar \? 'side-bottom' : 'all'/,
      'promoted detached titlebar windows must keep the same plugin-content resize handles'
    )
    assert.match(
      panelWindowSource,
      /const shouldInjectPluginResizeHandles = isResizable && process\.platform !== 'darwin'/,
      'promoted detached windows must not inject plugin-content resize handles on macOS'
    )
    assert.match(
      panelWindowSource,
      /applyWindowResizeHandlesToWebContents\(pluginWebContents,[\s\S]*useSurfaceInsets: false/,
      'promoted detached WebContentsView content must not reserve Windows surface insets'
    )
  })

  it('clears attached panel surface padding before promoting plugin content to a detached window', () => {
    const panelWindowSource = readFileSync(panelWindowSourcePath, 'utf8')
    const windowSurfaceSource = readFileSync(windowSurfaceSourcePath, 'utf8')
    const readyToShowStart = panelWindowSource.indexOf("independentWindow.once('ready-to-show'")
    const didFinishLoadStart = panelWindowSource.indexOf("pluginWebContents.on('did-finish-load'", readyToShowStart)
    const readyToShowHandler = readyToShowStart >= 0 && didFinishLoadStart > readyToShowStart
      ? panelWindowSource.slice(readyToShowStart, didFinishLoadStart)
      : ''

    assert.match(
      windowSurfaceSource,
      /export async function clearWindowsFramelessSurfaceFromWebContents/,
      'window surface module must expose a cleanup helper for reused plugin WebContents'
    )
    assert.match(
      panelWindowSource,
      /clearWindowsFramelessSurfaceFromWebContents/,
      'promoted panel windows must call the cleanup helper'
    )
    assert.ok(readyToShowHandler, 'promoted detached window ready-to-show handler must exist')
    assert.match(
      readyToShowHandler,
      /await clearWindowsFramelessSurfaceFromWebContents\(pluginWebContents\)[\s\S]*applyWindowResizeHandlesToWebContents\(pluginWebContents,/,
      'promoted plugin content must clear attached panel padding before detached resize handles are injected'
    )
  })
})
