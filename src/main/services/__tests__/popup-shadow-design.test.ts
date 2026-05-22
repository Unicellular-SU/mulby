import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = process.cwd()
const mainWindowManagerPath = join(root, 'src/main/main-window-manager.ts')
const mainWindowFramePath = join(root, 'src/main/main-window-frame.ts')
const panelWindowPath = join(root, 'src/main/plugin/panel-window.ts')
const systemPageWindowManagerPath = join(root, 'src/main/services/system-page-window-manager.ts')
const windowSurfacePath = join(root, 'src/main/services/window-surface.ts')
const superPanelCssPath = join(root, 'public/super-panel.css')
const trayMenuCssPath = join(root, 'public/tray-menu.css')
const rendererCssPath = join(root, 'src/renderer/styles/index.css')

const lightShadowPattern = /0 6px 12px rgba\(15, 23, 42, 0\.14\)[\s\S]*0 1px 3px rgba\(15, 23, 42, 0\.10\)/
const darkShadowPattern = /0 6px 14px rgba\(0, 0, 0, 0\.34\)[\s\S]*0 1px 3px rgba\(0, 0, 0, 0\.26\)/

describe('popup shadow design', () => {
  it('uses the shared compact two-layer shadow for popup surfaces', () => {
    for (const filePath of [
      mainWindowManagerPath,
      panelWindowPath,
      systemPageWindowManagerPath,
      windowSurfacePath,
      superPanelCssPath,
      trayMenuCssPath,
      rendererCssPath
    ]) {
      const source = readFileSync(filePath, 'utf8')
      assert.match(source, lightShadowPattern, `${filePath} must use the compact light popup shadow`)
    }

    for (const filePath of [
      windowSurfacePath,
      superPanelCssPath,
      trayMenuCssPath,
      rendererCssPath
    ]) {
      const source = readFileSync(filePath, 'utf8')
      assert.match(source, darkShadowPattern, `${filePath} must use the compact dark popup shadow`)
    }
  })

  it('reserves enough transparent padding around custom popup shadows', () => {
    const mainFrameSource = readFileSync(mainWindowFramePath, 'utf8')
    const mainWindowSource = readFileSync(mainWindowManagerPath, 'utf8')
    const panelWindowSource = readFileSync(panelWindowPath, 'utf8')
    const systemPageSource = readFileSync(systemPageWindowManagerPath, 'utf8')
    const windowSurfaceSource = readFileSync(windowSurfacePath, 'utf8')
    const superPanelCss = readFileSync(superPanelCssPath, 'utf8')
    const trayMenuCss = readFileSync(trayMenuCssPath, 'utf8')

    assert.match(mainFrameSource, /top: 18,[\s\S]*right: 18,[\s\S]*bottom: 18,[\s\S]*left: 18/, 'main window frame must reserve 18px for its shadow')
    assert.match(mainWindowSource, /export const MW_SHADOW_MARGIN = 18/, 'main shadow window must reserve 18px')
    assert.match(panelWindowSource, /const ATTACHED_PANEL_SHADOW_MARGIN = 18/, 'attached plugin panel shadow must reserve 18px')
    assert.match(systemPageSource, /const ATTACHED_SYSTEM_SHADOW_MARGIN = 18/, 'attached system page shadow must reserve 18px')
    assert.match(windowSurfaceSource, /top: 18,[\s\S]*right: 18,[\s\S]*bottom: 18,[\s\S]*left: 18/, 'frameless detached windows must reserve 18px')
    assert.match(superPanelCss, /--popup-window-padding: 18px/, 'super panel mac popup must reserve 18px')
    assert.match(trayMenuCss, /--popup-window-padding: 18px/, 'tray menu mac popup must reserve 18px')
  })

  it('keeps the main search box from drawing a clipped window shadow', () => {
    const rendererCss = readFileSync(rendererCssPath, 'utf8')
    const searchBoxRules = Array.from(rendererCss.matchAll(/([^{}]*\.search-box-container[^{}]*)\{([^{}]*)\}/g))

    assert.ok(searchBoxRules.length > 0, 'renderer css must define search box styles')

    for (const [, selector, body] of searchBoxRules) {
      if (!/box-shadow\s*:/.test(body)) continue
      assert.doesNotMatch(
        body,
        /var\(--popup-window-shadow\)/,
        `${selector.trim()} must not use the external popup shadow`
      )
    }
  })
})
