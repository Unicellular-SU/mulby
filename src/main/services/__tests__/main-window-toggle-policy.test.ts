import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldHideMainWindowOnToggle } from '../main-window-toggle-policy'

describe('main window toggle policy', () => {
  it('hides only when the main app surface is already focused', () => {
    assert.equal(shouldHideMainWindowOnToggle({
      isWindowVisible: true,
      isMainSurfaceFocused: true,
      isAppFocused: true
    }), true)
  })

  it('shows instead of hiding when a detached window owns focus', () => {
    assert.equal(shouldHideMainWindowOnToggle({
      isWindowVisible: true,
      isMainSurfaceFocused: false,
      isAppFocused: true
    }), false)
  })

  it('shows when the main window is not visible', () => {
    assert.equal(shouldHideMainWindowOnToggle({
      isWindowVisible: false,
      isMainSurfaceFocused: true,
      isAppFocused: true
    }), false)
  })

  it('shows on macOS Space changes when focus state is stale but the app is inactive', () => {
    assert.equal(shouldHideMainWindowOnToggle({
      isWindowVisible: true,
      isMainSurfaceFocused: true,
      isAppFocused: false
    }), false)
  })

  it('shows when macOS has visually hidden the window with opacity guard', () => {
    assert.equal(shouldHideMainWindowOnToggle({
      isWindowVisible: true,
      isMainSurfaceFocused: true,
      isAppFocused: true,
      windowOpacity: 0
    }), false)
  })
})
