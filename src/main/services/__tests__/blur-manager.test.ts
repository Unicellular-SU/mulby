import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldHideWholeAppAfterWindowHide } from '../blur-manager'

describe('blur manager macOS app hide policy', () => {
  it('allows app.hide only when restoring focus with no other app surfaces', () => {
    assert.equal(shouldHideWholeAppAfterWindowHide({
      platform: 'darwin',
      restorePreviousWindow: true,
      hasOtherVisibleWindows: false,
      hasDetachedWindows: false
    }), true)
  })

  it('keeps the app visible while detached windows exist', () => {
    assert.equal(shouldHideWholeAppAfterWindowHide({
      platform: 'darwin',
      restorePreviousWindow: true,
      hasOtherVisibleWindows: false,
      hasDetachedWindows: true
    }), false)
  })

  it('does not hide the whole app for non-macOS platforms or normal hides', () => {
    assert.equal(shouldHideWholeAppAfterWindowHide({
      platform: 'win32',
      restorePreviousWindow: true,
      hasOtherVisibleWindows: false,
      hasDetachedWindows: false
    }), false)
    assert.equal(shouldHideWholeAppAfterWindowHide({
      platform: 'darwin',
      restorePreviousWindow: false,
      hasOtherVisibleWindows: false,
      hasDetachedWindows: false
    }), false)
  })
})
