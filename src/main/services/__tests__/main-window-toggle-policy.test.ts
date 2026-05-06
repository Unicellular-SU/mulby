import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldHideMainWindowOnToggle } from '../main-window-toggle-policy'

describe('main window toggle policy', () => {
  it('hides only when the main app surface is already focused', () => {
    assert.equal(shouldHideMainWindowOnToggle({
      isWindowVisible: true,
      isMainSurfaceFocused: true
    }), true)
  })

  it('shows instead of hiding when a detached window owns focus', () => {
    assert.equal(shouldHideMainWindowOnToggle({
      isWindowVisible: true,
      isMainSurfaceFocused: false
    }), false)
  })

  it('shows when the main window is not visible', () => {
    assert.equal(shouldHideMainWindowOnToggle({
      isWindowVisible: false,
      isMainSurfaceFocused: true
    }), false)
  })
})
