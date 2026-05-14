import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearActiveWindowCache,
  getCachedActiveWindow,
  getCachedLinuxActiveWindowId,
  getCachedWindowsForegroundWindow,
  rememberLinuxActiveWindowId,
  rememberWindowsForegroundWindow,
  setCachedActiveWindowForTest,
  shouldCacheWindowsForegroundWindow,
  shouldPublishActiveWindowInfo
} from '../active-window'

describe('active window cache helpers', () => {
  it('keeps the last external Windows foreground window when Mulby becomes foreground', () => {
    assert.equal(shouldCacheWindowsForegroundWindow(100, process.pid, 1234), true)
    assert.equal(shouldCacheWindowsForegroundWindow(100, process.pid, process.pid), false)
    assert.equal(shouldCacheWindowsForegroundWindow(100, process.pid, process.pid, true), true)
    assert.equal(shouldCacheWindowsForegroundWindow(null, process.pid, 1234), false)
    assert.equal(shouldCacheWindowsForegroundWindow(100, process.pid, undefined), false)
  })

  it('does not publish Mulby itself as the cached target application', () => {
    assert.equal(shouldPublishActiveWindowInfo({ app: 'notepad', title: 'note', pid: 1234 }, process.pid), true)
    assert.equal(shouldPublishActiveWindowInfo({ app: 'Mulby', title: 'Mulby', pid: process.pid }, process.pid), false)
    assert.equal(shouldPublishActiveWindowInfo({ app: 'unknown', title: 'no pid' }, process.pid), true)
    assert.equal(shouldPublishActiveWindowInfo(null, process.pid), false)
  })

  it('returns the previous Windows target when the current foreground target is the caller window', () => {
    clearActiveWindowCache()

    rememberWindowsForegroundWindow(100)
    rememberWindowsForegroundWindow(200)

    assert.equal(getCachedWindowsForegroundWindow(), 200)
    assert.equal(getCachedWindowsForegroundWindow({ excludeWindowHandle: 200 }), 100)
  })

  it('tracks the previous Linux active window id for visible input restore', () => {
    clearActiveWindowCache()

    rememberLinuxActiveWindowId('0x100')
    rememberLinuxActiveWindowId('0x200')

    assert.equal(getCachedLinuxActiveWindowId(), '0x200')
    assert.equal(getCachedLinuxActiveWindowId({ excludeWindowId: '0x200' }), '0x100')
  })

  it('allows tests to seed cached active window info for macOS target activation', () => {
    clearActiveWindowCache()

    setCachedActiveWindowForTest({
      app: 'TextEdit',
      title: 'Untitled',
      pid: 123,
      bundleId: 'com.apple.TextEdit'
    })

    assert.deepEqual(getCachedActiveWindow(), {
      app: 'TextEdit',
      title: 'Untitled',
      pid: 123,
      bundleId: 'com.apple.TextEdit'
    })
  })
})
