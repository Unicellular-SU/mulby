import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const mainWindowManagerPath = join(process.cwd(), 'src/main/main-window-manager.ts')

describe('main window close handling', () => {
  async function loadClosePolicy() {
    let closePolicyModule: {
      shouldPreventMainWindowClose?: (input: { closeToTray: boolean; isQuitting: boolean }) => boolean
    } | null = null

    try {
      closePolicyModule = await import('../../main-window-close-policy')
    } catch {
      closePolicyModule = null
    }

    const shouldPreventMainWindowClose = closePolicyModule?.shouldPreventMainWindowClose
    assert.equal(typeof shouldPreventMainWindowClose, 'function')
    return shouldPreventMainWindowClose!
  }

  it('does not close to tray while the app is quitting', async () => {
    const shouldPreventMainWindowClose = await loadClosePolicy()
    assert.equal(shouldPreventMainWindowClose({ closeToTray: true, isQuitting: true }), false)
  })

  it('keeps close-to-tray behavior for normal window closes', async () => {
    const shouldPreventMainWindowClose = await loadClosePolicy()
    assert.equal(shouldPreventMainWindowClose({ closeToTray: true, isQuitting: false }), true)
    assert.equal(shouldPreventMainWindowClose({ closeToTray: false, isQuitting: false }), false)
  })
})

describe('main window macOS Space behavior', () => {
  it('keeps the host summonable on every Space without transforming the Dock process', () => {
    const source = readFileSync(mainWindowManagerPath, 'utf8')

    assert.match(
      source,
      /win\.setVisibleOnAllWorkspaces\(true,\s*\{\s*visibleOnFullScreen: true,\s*skipTransformProcessType: true\s*\}\)/,
      'the macOS host window must join all Spaces without showing the Dock icon'
    )
    assert.match(
      source,
      /this\.window\.setVisibleOnAllWorkspaces\(true,\s*\{\s*visibleOnFullScreen: true,\s*skipTransformProcessType: true\s*\}\)/,
      'the macOS Space configuration must be reapplied before each host show'
    )
  })

  it('hides macOS Space transition flashes with an opacity guard', () => {
    const source = readFileSync(mainWindowManagerPath, 'utf8')

    assert.match(
      source,
      /win\.on\('hide', \(\) => \{[\s\S]*process\.platform === 'darwin'[\s\S]*win\.setOpacity\(0\)/,
      'macOS system hide events during Space switches must make the host visually invisible'
    )
    assert.match(
      source,
      /this\.window\.setOpacity\(1\)[\s\S]*this\.window\.show\(\)/,
      'manual host shows must restore opacity before displaying the window again'
    )
  })
})
