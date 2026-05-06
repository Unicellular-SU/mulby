import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PluginScreen } from '../screen'

function imageDataUrl(value: string) {
  return {
    toDataURL: () => value
  }
}

function captureSource(source: {
  id: string
  name: string
  displayId?: string
  appIcon?: string | null
}) {
  return {
    id: source.id,
    name: source.name,
    thumbnail: imageDataUrl(`data:image/png;base64,thumb:${source.id}`),
    display_id: source.displayId || '',
    appIcon: source.appIcon ? imageDataUrl(source.appIcon) : null
  } as Electron.DesktopCapturerSource
}

describe('PluginScreen window bounds', () => {
  it('adds bounds to window sources when the native resolver returns them', async () => {
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async () => [
          captureSource({ id: 'window:12345:0', name: 'Target Window', displayId: '7' }),
          captureSource({ id: 'screen:1:0', name: 'Screen 1', displayId: '7' })
        ]
      },
      getWindowBounds: (sourceId) => sourceId === 'window:12345:0'
        ? { x: -100, y: 25, width: 1024, height: 768 }
        : null
    })

    const sources = await pluginScreen.getSources({ types: ['window'] })

    assert.deepEqual(sources[0], {
      id: 'window:12345:0',
      name: 'Target Window',
      thumbnailDataUrl: 'data:image/png;base64,thumb:window:12345:0',
      displayId: '7',
      appIconDataUrl: undefined,
      bounds: { x: -100, y: 25, width: 1024, height: 768 }
    })
    assert.equal(sources[1].bounds, undefined)
  })

  it('returns null for non-window source ids', async () => {
    const pluginScreen = new PluginScreen({
      getWindowBounds: () => null
    })

    assert.equal(await pluginScreen.getWindowBounds('screen:1:0'), null)
  })
})
