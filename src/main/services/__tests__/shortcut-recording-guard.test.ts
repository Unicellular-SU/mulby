import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Input } from 'electron'
import { toShortcutRecordingAccelerator } from '../shortcut-recording-guard'

function input(init: Partial<Input>): Input {
  return {
    type: 'keyDown',
    key: init.key || '',
    code: init.code || '',
    alt: false,
    control: false,
    meta: false,
    shift: false,
    isAutoRepeat: false,
    isComposing: false,
    ...init
  } as Input
}

describe('shortcut recording guard accelerator conversion', () => {
  it('allows function keys without modifiers', () => {
    assert.equal(toShortcutRecordingAccelerator(input({ code: 'F1', key: 'F1' })), 'F1')
    assert.equal(toShortcutRecordingAccelerator(input({ code: 'F24', key: 'F24' })), 'F24')
  })

  it('still requires a primary modifier for ordinary keys', () => {
    assert.equal(toShortcutRecordingAccelerator(input({ code: 'KeyA', key: 'a' })), null)
    assert.equal(
      toShortcutRecordingAccelerator(input({ code: 'KeyA', key: 'a', control: true })),
      'CommandOrControl+A'
    )
  })

  it('records Alt+Space when the input key is the literal space character', () => {
    assert.equal(
      toShortcutRecordingAccelerator(input({ code: 'Space', key: ' ', alt: true })),
      'Alt+Space'
    )
  })
})
