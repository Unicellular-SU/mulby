import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveDarwinKeyboardHookResult,
  resolveWin32KeyboardHookResult
} from '../native-input-hook'

describe('native input hook consumption helpers', () => {
  it('prevents Windows keyboard events from continuing when handled', () => {
    let callNextCount = 0
    const result = resolveWin32KeyboardHookResult(true, () => {
      callNextCount += 1
      return 99
    })

    assert.equal(result, 1)
    assert.equal(callNextCount, 0)
  })

  it('continues Windows keyboard events when not handled', () => {
    let callNextCount = 0
    const result = resolveWin32KeyboardHookResult(false, () => {
      callNextCount += 1
      return 99
    })

    assert.equal(result, 99)
    assert.equal(callNextCount, 1)
  })

  it('prevents macOS keyboard events from continuing when handled', () => {
    const event = { kind: 'event' }

    assert.equal(resolveDarwinKeyboardHookResult(true, event), null)
    assert.equal(resolveDarwinKeyboardHookResult(false, event), event)
  })
})
