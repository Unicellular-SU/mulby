import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectSystemReservedShortcut } from '../system-reserved-shortcuts'

describe('detectSystemReservedShortcut', () => {
  it('detects common Windows-reserved combinations', () => {
    assert.equal(detectSystemReservedShortcut('Alt+Tab', 'win32'), 'win-alt-tab')
    assert.equal(detectSystemReservedShortcut('Alt+Esc', 'win32'), 'win-alt-escape')
    assert.equal(detectSystemReservedShortcut('Alt+F4', 'win32'), 'win-alt-f4')
    assert.equal(detectSystemReservedShortcut('Ctrl+Escape', 'win32'), 'win-ctrl-escape')
  })

  it('allows Alt+Space so the low-level hook can take it over', () => {
    assert.equal(detectSystemReservedShortcut('Alt+Space', 'win32'), null)
  })

  it('normalizes aliases before detection', () => {
    assert.equal(detectSystemReservedShortcut('cmdorctrl+esc', 'win32'), 'win-ctrl-escape')
    assert.equal(detectSystemReservedShortcut('Win+K', 'win32'), 'win-meta')
    assert.equal(detectSystemReservedShortcut('Super+K', 'win32'), 'win-meta')
  })

  it('avoids overblocking when extra modifiers are present', () => {
    assert.equal(detectSystemReservedShortcut('Alt+Shift+Space', 'win32'), null)
    assert.equal(detectSystemReservedShortcut('Ctrl+Shift+Escape', 'win32'), null)
  })

  it('returns null on non-Windows platforms', () => {
    assert.equal(detectSystemReservedShortcut('Alt+Space', 'darwin'), null)
    assert.equal(detectSystemReservedShortcut('Alt+Space', 'linux'), null)
  })
})
