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

  it('reapplies attached plugin content surface after renderer reloads', () => {
    const source = readFileSync(panelWindowSourcePath, 'utf8')
    const didFinishLoadStart = source.indexOf("capturedWebContents.on('did-finish-load'")
    const didFinishLoadEnd = source.indexOf('// 安装 console 输出捕获', didFinishLoadStart)
    const didFinishLoadHandler = didFinishLoadStart >= 0 && didFinishLoadEnd > didFinishLoadStart
      ? source.slice(didFinishLoadStart, didFinishLoadEnd)
      : ''

    assert.ok(didFinishLoadHandler, 'attached panel did-finish-load handler must exist')
    assert.match(
      didFinishLoadHandler,
      /pluginContentSurfacePromise = null[\s\S]*void ensureAttachedPluginContentSurface\(\)/,
      'attached plugin content clipping and resize handles must be re-injected after every load'
    )
    assert.doesNotMatch(
      didFinishLoadHandler,
      /await ensureAttachedPluginContentSurface\(\)/,
      're-injecting plugin content surface must not block did-finish-load'
    )
  })

  it('restores the host search window opacity before showing an attached panel', () => {
    const source = readFileSync(panelWindowSourcePath, 'utf8')
    const helperStart = source.indexOf('private showMainWindowForAttachedPanel()')
    const helperEnd = source.indexOf('private destroyPluginView()', helperStart)
    const helperMethod = helperStart >= 0 && helperEnd > helperStart
      ? source.slice(helperStart, helperEnd)
      : ''
    const createShowStart = source.indexOf('const showPanel = async')
    const createShowEnd = source.indexOf("capturedWebContents.once('dom-ready'", createShowStart)
    const createShowBlock = createShowStart >= 0 && createShowEnd > createShowStart
      ? source.slice(createShowStart, createShowEnd)
      : ''
    const showMethodStart = source.indexOf('show(options: { activate?: boolean } = {})')
    const showMethodEnd = source.indexOf('// Clean up the deferred opacity restore', showMethodStart)
    const showMethod = showMethodStart >= 0 && showMethodEnd > showMethodStart
      ? source.slice(showMethodStart, showMethodEnd)
      : ''

    assert.ok(helperMethod, 'host show helper must exist')
    assert.match(
      helperMethod,
      /this\.mainWindow\.setOpacity\(1\)[\s\S]*this\.mainWindow\.show\(\)/,
      'attached panel launches must undo the macOS hidden-host opacity guard before showing the host'
    )
    assert.match(
      createShowBlock,
      /this\.showMainWindowForAttachedPanel\(\)/,
      'cold attached panel launches must restore the host window before showing the panel'
    )
    assert.match(
      showMethod,
      /this\.showMainWindowForAttachedPanel\(\)/,
      'resident attached panel restores must also restore the host window'
    )
  })
})
