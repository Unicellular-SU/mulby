import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAcceleratorFromKeyboardEvent,
  formatAcceleratorForPlatform
} from '../../../shared/shortcut-accelerator'

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return init as KeyboardEvent
}

describe('shortcut accelerator helpers', () => {
  it('formats CommandOrControl using the current platform convention', () => {
    assert.equal(formatAcceleratorForPlatform('CommandOrControl+K', 'win32'), 'Ctrl+K')
    assert.equal(formatAcceleratorForPlatform('CommandOrControl+,', 'linux'), 'Ctrl+,')
    assert.equal(formatAcceleratorForPlatform('CommandOrControl+K', 'darwin'), '⌘+K')
  })

  it('records CommandOrControl from platform primary modifier keys', () => {
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'KeyK', key: 'k', ctrlKey: true }), 'win32'),
      { accelerator: 'CommandOrControl+K', error: null }
    )
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'KeyK', key: 'k', metaKey: true }), 'darwin'),
      { accelerator: 'CommandOrControl+K', error: null }
    )
  })

  it('does not treat the Windows key as Control on non-macOS platforms', () => {
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'KeyK', key: 'k', metaKey: true }), 'win32'),
      { accelerator: 'Meta+K', error: null }
    )
    assert.equal(formatAcceleratorForPlatform('Meta+K', 'win32'), 'Win+K')
  })

  it('allows function keys without modifiers', () => {
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'F1', key: 'F1' })),
      { accelerator: 'F1', error: null }
    )
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'F24', key: 'F24' })),
      { accelerator: 'F24', error: null }
    )
  })

  it('records Alt+Space when KeyboardEvent.key is the literal space character', () => {
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'Space', key: ' ', altKey: true }), 'win32'),
      { accelerator: 'Alt+Space', error: null }
    )
  })

  it('rejects ordinary keys without a primary modifier', () => {
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'KeyA', key: 'a' })),
      {
        accelerator: 'A',
        error: '请按 Ctrl/Alt + 按键，或直接按 F1–F24'
      }
    )
  })

  it('ignores cancellation and modifier-only keys', () => {
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'Escape', key: 'Escape' })),
      { accelerator: '', error: null }
    )
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'ControlLeft', key: 'Control', ctrlKey: true }), 'win32'),
      {
        accelerator: 'CommandOrControl',
        error: '请按 Ctrl/Alt + 按键，或直接按 F1–F24'
      }
    )
    assert.deepEqual(
      buildAcceleratorFromKeyboardEvent(keyEvent({ code: 'ControlLeft', key: 'Control', ctrlKey: true }), 'darwin'),
      {
        accelerator: 'Control',
        error: '请按 Ctrl/Alt + 按键，或直接按 F1–F24'
      }
    )
  })
})
