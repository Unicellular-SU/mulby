import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const actionMenuWindowManagerPath = join(process.cwd(), 'src/main/services/action-menu-window-manager.ts')
const actionMenuHtmlPath = join(process.cwd(), 'public/action-menu.html')

describe('action menu window manager', () => {
  it('keeps the menu window visible on the current macOS Space when reused', () => {
    const source = readFileSync(actionMenuWindowManagerPath, 'utf8')
    const configureMatch = source.match(/private configureWindowForShow\(win: BrowserWindow\): void \{([\s\S]*?)\n\s*\}/)

    assert.ok(configureMatch, 'ActionMenuWindowManager must centralize menu window show-time configuration')
    assert.match(
      source,
      /win\.setVisibleOnAllWorkspaces\(true,\s*\{\s*visibleOnFullScreen: true,\s*skipTransformProcessType: true\s*\}\)/,
      'macOS action menus must be visible on all Spaces to avoid jumping back to the first Space'
    )
    assert.match(
      source,
      /win\.setAlwaysOnTop\(true, 'pop-up-menu'\)/,
      'macOS action menus must keep pop-up-menu z-order'
    )
    assert.match(
      source,
      /this\.configureWindowForShow\(win\)[\s\S]*win\.show\(\)/,
      'the macOS Space configuration must be reapplied each time the reusable menu window is shown'
    )
  })

  it('can resolve a selected item for renderer-owned context menus', () => {
    const source = readFileSync(actionMenuWindowManagerPath, 'utf8')

    assert.match(
      source,
      /async showForSelection\(options: ActionMenuRequestOptions\): Promise<string \| null>/,
      'renderer context menus need a Promise-based selection API'
    )
    assert.match(
      source,
      /this\.closeCurrent\(id\)[\s\S]*await request\.onSelect\?\.\(id\)/,
      'item selection must resolve before running optional callback actions'
    )
    assert.match(
      source,
      /request\?\.resolveSelection\?\.\(selection\)/,
      'closing the menu must resolve pending selection promises'
    )
  })

  it('renders menu content with transparent window padding for a visible shadow', () => {
    const managerSource = readFileSync(actionMenuWindowManagerPath, 'utf8')
    const htmlSource = readFileSync(actionMenuHtmlPath, 'utf8')

    assert.match(
      managerSource,
      /transparent:\s*true/,
      'action menu windows must be transparent so the CSS shadow is visible'
    )
    assert.match(
      managerSource,
      /const MENU_SHADOW_PADDING = 18/,
      'window bounds must reserve padding around the menu for the shadow'
    )
    assert.match(
      htmlSource,
      /background:\s*transparent/,
      'the action menu page background must not cover the window shadow area'
    )
    assert.match(
      htmlSource,
      /box-shadow:\s*var\(--menu-shadow\)/,
      'the menu surface must render a themed shadow'
    )
  })
})
