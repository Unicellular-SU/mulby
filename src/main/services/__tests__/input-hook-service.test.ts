import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InputHookService } from '../input-hook'

function createStartedService(): InputHookService {
  const service = new InputHookService()
  ;(service as unknown as { running: boolean }).running = true
  return service
}

describe('InputHookService keyboard bindings', () => {
  it('returns handled when a consuming accelerator matches', () => {
    const service = createStartedService()
    let called = 0

    assert.equal(service.register('app-shortcut:toggleWindow', 'Alt+Space', () => { called += 1 }), true)

    const handled = (service as unknown as {
      onKeyDown: (event: { vkCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => boolean
    }).onKeyDown({ vkCode: 0x20, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })

    assert.equal(called, 1)
    assert.equal(handled, true)
  })

  it('does not handle non-matching keyboard events', () => {
    const service = createStartedService()

    assert.equal(service.register('app-shortcut:toggleWindow', 'Alt+Space', () => {}), true)

    const handled = (service as unknown as {
      onKeyDown: (event: { vkCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => boolean
    }).onKeyDown({ vkCode: 0x41, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })

    assert.equal(handled, false)
  })

  it('unregisters keyboard bindings by prefix without touching other owners', () => {
    const service = createStartedService()
    let appCalls = 0
    let pluginCalls = 0

    assert.equal(service.register('app-shortcut:toggleWindow', 'Alt+Space', () => { appCalls += 1 }), true)
    assert.equal(service.register('plugin-command:alpha', 'F1', () => { pluginCalls += 1 }), true)

    service.unregisterByPrefix('app-shortcut:')

    const keyDown = (event: { vkCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => (
      service as unknown as {
        onKeyDown: (input: typeof event) => boolean
      }
    ).onKeyDown(event)

    assert.equal(keyDown({ vkCode: 0x20, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }), false)
    assert.equal(keyDown({ vkCode: 0x70, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }), true)
    assert.equal(appCalls, 0)
    assert.equal(pluginCalls, 1)
  })
})
