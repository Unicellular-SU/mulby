import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

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
