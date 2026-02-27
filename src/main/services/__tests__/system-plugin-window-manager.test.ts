import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SystemPluginWindowManager,
  type SystemPluginBeforeAttachPayload
} from '../system-plugin-window-manager'

function createMockWindow(onSend?: (channel: string, payload: unknown) => void) {
  let destroyed = false
  return {
    setDestroyed: (value: boolean) => {
      destroyed = value
    },
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload: unknown) => {
        onSend?.(channel, payload)
      }
    }
  }
}

describe('system plugin window manager', () => {
  it('no-ops when no active system plugin', async () => {
    const events: Array<{ channel: string; payload: unknown }> = []
    const window = createMockWindow((channel, payload) => events.push({ channel, payload }))
    const manager = new SystemPluginWindowManager()
    manager.setMainWindow(window)

    await manager.prepareForAttachedPluginLaunch(20)
    assert.equal(events.length, 0)
  })

  it('requests renderer collapse and resolves after ready notification', async () => {
    const events: Array<{ channel: string; payload: unknown }> = []
    const window = createMockWindow((channel, payload) => events.push({ channel, payload }))
    const manager = new SystemPluginWindowManager()
    manager.setMainWindow(window)
    manager.setActiveSystemPlugin('settings-center')

    const pending = manager.prepareForAttachedPluginLaunch(200)
    assert.equal(events.length, 1)
    assert.equal(events[0].channel, 'app:systemPluginBeforeAttach')
    const payload = events[0].payload as SystemPluginBeforeAttachPayload
    assert.equal(payload.pluginId, 'settings-center')
    assert.ok(payload.requestId.length > 0)

    const acked = manager.notifyReadyForAttach(payload.requestId)
    assert.equal(acked, true)
    await pending
  })

  it('falls back to timeout when renderer does not ack', async () => {
    const window = createMockWindow()
    const manager = new SystemPluginWindowManager()
    manager.setMainWindow(window)
    manager.setActiveSystemPlugin('settings-center')

    const startedAt = Date.now()
    await manager.prepareForAttachedPluginLaunch(30)
    const elapsedMs = Date.now() - startedAt
    assert.ok(elapsedMs >= 20)
  })

  it('clears pending waits when main window is detached', async () => {
    let capturedRequestId = ''
    const window = createMockWindow((_channel, payload) => {
      capturedRequestId = (payload as SystemPluginBeforeAttachPayload).requestId
    })
    const manager = new SystemPluginWindowManager()
    manager.setMainWindow(window)
    manager.setActiveSystemPlugin('settings-center')

    const pending = manager.prepareForAttachedPluginLaunch(1000)
    assert.ok(capturedRequestId.length > 0)

    manager.setMainWindow(null)
    await pending
    assert.equal(manager.notifyReadyForAttach(capturedRequestId), false)
  })
})
