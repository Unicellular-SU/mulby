import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearWindowsInputTargetWindows,
  isWindowsInputTargetWindowHandle,
  nativeWindowHandleBufferToBigInt,
  normalizeWindowsNativeWindowHandle,
  registerWindowsInputTargetWindow,
  unregisterWindowsInputTargetWindow
} from '../windows-input-target-window'

describe('Windows input target window registry', () => {
  it('normalizes Electron native window handles and tracks registered input targets', () => {
    clearWindowsInputTargetWindows()

    const handle = Buffer.alloc(8)
    handle.writeBigUInt64LE(0x1234n)

    assert.equal(nativeWindowHandleBufferToBigInt(handle), 0x1234n)
    assert.equal(isWindowsInputTargetWindowHandle(0x1234n), false)

    registerWindowsInputTargetWindow(10, handle)
    assert.equal(isWindowsInputTargetWindowHandle(0x1234n), true)

    unregisterWindowsInputTargetWindow(10)
    assert.equal(isWindowsInputTargetWindowHandle(0x1234n), false)
  })

  it('normalizes Koffi pointer handles via injected address resolver', () => {
    const pointer = { external: true }
    const resolveAddress = (value: unknown) => {
      assert.equal(value, pointer)
      return 0x5678n
    }

    assert.equal(normalizeWindowsNativeWindowHandle(pointer, resolveAddress), 0x5678n)
  })
})
