import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldCacheWindowsForegroundWindow, shouldPublishActiveWindowInfo } from '../active-window'

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
})
