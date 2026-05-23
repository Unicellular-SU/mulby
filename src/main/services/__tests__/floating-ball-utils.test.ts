import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFloatingBallFilePayload,
  getFloatingBallVisualPosition,
  getFloatingBallWindowPosition,
  getFloatingBallWindowSize,
  isFloatingBallPluginPackageDrop,
  normalizeFloatingBallSettings,
  resolveFloatingBallPosition,
  snapFloatingBallPosition
} from '../floating-ball-utils'

const displays = [
  { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { id: 2, workArea: { x: 1920, y: 0, width: 1280, height: 900 } }
]

describe('floating ball utilities', () => {
  it('normalizes missing settings to the default disabled floating ball', () => {
    assert.deepEqual(normalizeFloatingBallSettings(undefined), {
      enabled: false,
      label: 'M',
      size: 52,
      opacity: 0.92,
      snapToEdge: true,
      doubleClickCommand: undefined,
      longPressAction: 'captureRegion',
      dropAction: 'openMatches'
    })
  })

  it('normalizes unsafe settings without losing a valid command target', () => {
    assert.deepEqual(normalizeFloatingBallSettings({
      enabled: true,
      label: ' Mulby ',
      size: 200,
      opacity: 2,
      snapToEdge: false,
      doubleClickCommand: { pluginId: ' system ', featureCode: ' open-settings ' },
      longPressAction: 'unknown' as never,
      dropAction: 'unknown' as never,
      position: { x: Number.NaN, y: 20 }
    }), {
      enabled: true,
      label: 'Mu',
      size: 80,
      opacity: 1,
      snapToEdge: false,
      doubleClickCommand: { pluginId: 'system', featureCode: 'open-settings' },
      longPressAction: 'captureRegion',
      dropAction: 'openMatches'
    })
  })

  it('restores a saved position only when it intersects a known work area', () => {
    assert.deepEqual(resolveFloatingBallPosition({
      savedPosition: { x: 1950, y: 40, displayId: 2 },
      displays,
      size: 52
    }), { x: 1950, y: 40, displayId: 2 })

    assert.deepEqual(resolveFloatingBallPosition({
      savedPosition: { x: 5000, y: 5000, displayId: 2 },
      displays,
      size: 52
    }), { x: 1860, y: 494, displayId: 1 })
  })

  it('snaps to the nearest horizontal edge while staying inside the work area', () => {
    assert.deepEqual(snapFloatingBallPosition({
      position: { x: 700, y: -40 },
      display: displays[0],
      size: 52
    }), { x: 8, y: 8, displayId: 1 })

    assert.deepEqual(snapFloatingBallPosition({
      position: { x: 1400, y: 1200 },
      display: displays[0],
      size: 52
    }), { x: 1860, y: 980, displayId: 1 })
  })

  it('detects plugin package drops separately from regular file payloads', () => {
    const files = [
      { path: 'D:\\Downloads\\demo.inplugin', name: 'demo.inplugin', size: 10, type: '', isDirectory: false },
      { path: 'D:\\Docs\\note.txt', name: 'note.txt', size: 20, type: 'text/plain', isDirectory: false }
    ]

    assert.equal(isFloatingBallPluginPackageDrop(files), true)
    assert.deepEqual(buildFloatingBallFilePayload([files[1]]), {
      format: 'files',
      files: [files[1]]
    })
  })

  it('keeps the visible ball position separate from the padded shadow window', () => {
    assert.equal(getFloatingBallWindowSize(52), 84)
    assert.deepEqual(getFloatingBallWindowPosition({ x: 100, y: 200 }), { x: 84, y: 184 })
    assert.deepEqual(getFloatingBallVisualPosition({ x: 84, y: 184 }), { x: 100, y: 200 })
  })
})
