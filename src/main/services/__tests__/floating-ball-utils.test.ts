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
      iconId: 'v1',
      size: 52,
      opacity: 0.92,
      snapToEdge: true,
      actions: {
        click: { type: 'builtin', action: 'toggleMulby' },
        doubleClick: { type: 'inheritClick' },
        longPress: { type: 'builtin', action: 'captureRegion' }
      },
      dropAction: 'openMatches'
    })
  })

  it('migrates legacy double-click and long-press settings into action bindings', () => {
    assert.deepEqual(normalizeFloatingBallSettings({
      doubleClickCommand: {
        pluginId: ' system ',
        featureCode: ' open-settings ',
        cmdId: ' keyword:open-settings ',
        cmdSignature: ' keyword:open-settings ',
        commandLabel: ' Open Settings '
      },
      longPressAction: 'captureRegion'
    }), {
      enabled: false,
      label: 'M',
      iconId: 'v1',
      size: 52,
      opacity: 0.92,
      snapToEdge: true,
      actions: {
        click: { type: 'builtin', action: 'toggleMulby' },
        doubleClick: {
          type: 'command',
          target: {
            pluginId: 'system',
            featureCode: 'open-settings',
            cmdId: 'keyword:open-settings',
            cmdSignature: 'keyword:open-settings',
            commandLabel: 'Open Settings'
          }
        },
        longPress: { type: 'builtin', action: 'captureRegion' }
      },
      dropAction: 'openMatches'
    })
  })

  it('normalizes unsafe settings without losing valid action targets', () => {
    assert.deepEqual(normalizeFloatingBallSettings({
      enabled: true,
      label: ' Mulby ',
      size: 200,
      opacity: 2,
      snapToEdge: false,
      actions: {
        click: { type: 'command', target: { pluginId: ' demo ', featureCode: ' launch ' } },
        doubleClick: { type: 'builtin', action: 'captureRegion' },
        longPress: { type: 'bad-action' } as never
      },
      doubleClickCommand: { pluginId: ' legacy ', featureCode: ' ignored ' },
      longPressAction: 'unknown' as never,
      dropAction: 'unknown' as never,
      position: { x: Number.NaN, y: 20 }
    }), {
      enabled: true,
      label: 'Mu',
      iconId: 'label',
      size: 80,
      opacity: 1,
      snapToEdge: false,
      actions: {
        click: { type: 'command', target: { pluginId: 'demo', featureCode: 'launch' } },
        doubleClick: { type: 'builtin', action: 'captureRegion' },
        longPress: { type: 'builtin', action: 'captureRegion' }
      },
      dropAction: 'openMatches'
    })
  })

  it('keeps valid icon choices and falls back to text for legacy custom labels', () => {
    assert.equal(normalizeFloatingBallSettings({ iconId: 'v8' }).iconId, 'v8')
    assert.equal(normalizeFloatingBallSettings({ iconId: 'missing' as never }).iconId, 'v1')
    assert.equal(normalizeFloatingBallSettings({ label: 'AI' }).iconId, 'label')
  })

  it('accepts only valid custom svg icons', () => {
    assert.deepEqual(normalizeFloatingBallSettings({
      iconId: 'custom',
      customIconSvg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
    }).iconId, 'custom')
    assert.equal(normalizeFloatingBallSettings({
      iconId: 'custom',
      customIconSvg: '<script>alert(1)</script>'
    }).iconId, 'v1')
    assert.equal(normalizeFloatingBallSettings({
      iconId: 'custom',
      customIconSvg: '<svg onload="alert(1)"></svg>'
    }).customIconSvg, undefined)
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
