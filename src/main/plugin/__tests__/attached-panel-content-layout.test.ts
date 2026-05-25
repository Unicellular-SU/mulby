import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const panelWindowSourcePath = join(process.cwd(), 'src/main/plugin/panel-window.ts')

describe('attached panel content layout', () => {
  it('keeps attached plugin content inside the visible frameless surface bounds', () => {
    const source = readFileSync(panelWindowSourcePath, 'utf8')
    const layoutStart = source.indexOf('private layoutAttachedPluginView()')
    const nextMethodStart = source.indexOf('private collapseMainWindowForAttachedPanel()', layoutStart)
    const layoutMethod = layoutStart >= 0 && nextMethodStart > layoutStart
      ? source.slice(layoutStart, nextMethodStart)
      : ''

    assert.ok(layoutMethod, 'layoutAttachedPluginView method must exist')
    assert.match(
      layoutMethod,
      /const \{ top, right, bottom, left \} = getWindowsFramelessSurfaceInsets\(\)/,
      'attached plugin view layout must use the same Windows frameless surface insets as the shell'
    )
    assert.match(
      layoutMethod,
      /x: left[\s\S]*y: top[\s\S]*width: Math\.max\(1, contentWidth - left - right\)[\s\S]*height: Math\.max\(1, contentHeight - top - bottom\)/,
      'attached plugin view must fill only the shell visible content area'
    )
  })

  it('injects only resize handles into attached plugin content', () => {
    const source = readFileSync(panelWindowSourcePath, 'utf8')
    const ensureStart = source.indexOf('const ensureAttachedPluginContentSurface = (): Promise<void> => {')
    const showPanelStart = source.indexOf('const showPanel = async', ensureStart)
    const ensureBlock = ensureStart >= 0 && showPanelStart > ensureStart
      ? source.slice(ensureStart, showPanelStart)
      : ''

    assert.ok(ensureBlock, 'ensureAttachedPluginContentSurface block must exist')
    assert.doesNotMatch(
      ensureBlock,
      /applyWindowsFramelessSurfaceToWebContents/,
      'attached plugin content must not receive the full frameless surface host'
    )
    assert.match(
      ensureBlock,
      /applyWindowContentClipToWebContents\(capturedWebContents\)[\s\S]*applyWindowResizeHandlesToWebContents\(capturedWebContents,/,
      'attached plugin content should keep rounded clipping before resize handles are injected'
    )
    assert.match(
      ensureBlock,
      /applyWindowResizeHandlesToWebContents\(capturedWebContents,[\s\S]*resizeMode: 'bottom'[\s\S]*useSurfaceInsets: false/,
      'attached plugin content should receive bottom resize handles without surface insets'
    )
  })
})
