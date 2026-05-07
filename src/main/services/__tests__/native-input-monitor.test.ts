import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeInputMonitorEventCoordinates, type GlobalInputEvent } from '../native-input-monitor'

function createEvent(x: number, y: number): GlobalInputEvent {
  return {
    type: 'mouseMove',
    timestamp: 1,
    x,
    y,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false
  }
}

describe('normalizeInputMonitorEventCoordinates', () => {
  it('converts Windows native screen coordinates to DIP coordinates', () => {
    const converted = normalizeInputMonitorEventCoordinates(createEvent(1500, 900), {
      platform: 'win32',
      screenToDipPoint: (point) => ({ x: point.x / 1.5, y: point.y / 1.5 })
    })

    assert.equal(converted.x, 1000)
    assert.equal(converted.y, 600)
  })

  it('leaves non-Windows coordinates unchanged', () => {
    const event = createEvent(1500, 900)
    const converted = normalizeInputMonitorEventCoordinates(event, {
      platform: 'darwin',
      screenToDipPoint: (point) => ({ x: point.x / 2, y: point.y / 2 })
    })

    assert.equal(converted, event)
  })

  it('falls back to the original event when conversion fails', () => {
    const event = createEvent(1500, 900)
    const converted = normalizeInputMonitorEventCoordinates(event, {
      platform: 'win32',
      screenToDipPoint: () => {
        throw new Error('screen unavailable')
      }
    })

    assert.equal(converted, event)
  })
})
