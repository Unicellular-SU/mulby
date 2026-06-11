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
  it('does not request window icons for screen-only source lists', async () => {
    let receivedOptions: Electron.SourcesOptions | null = null
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async (options) => {
          receivedOptions = options
          return []
        }
      }
    })

    await pluginScreen.getSources({ types: ['screen'] })

    assert.deepEqual(receivedOptions, {
      types: ['screen'],
      thumbnailSize: { width: 150, height: 150 },
      fetchWindowIcons: false
    })
  })

  it('lets callers skip window icons for window source lists', async () => {
    let receivedOptions: Electron.SourcesOptions | null = null
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async (options) => {
          receivedOptions = options
          return []
        }
      }
    })

    await pluginScreen.getSources({ types: ['window'], fetchWindowIcons: false })

    assert.deepEqual(receivedOptions, {
      types: ['window'],
      thumbnailSize: { width: 150, height: 150 },
      fetchWindowIcons: false
    })
  })

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

function displayLike(input: {
  id: number
  bounds?: { x: number; y: number; width: number; height: number }
  scaleFactor?: number
}): Electron.Display {
  const bounds = input.bounds || { x: 0, y: 0, width: 1920, height: 1080 }
  return {
    id: input.id,
    label: `Display ${input.id}`,
    bounds,
    workArea: bounds,
    scaleFactor: input.scaleFactor || 1,
    rotation: 0
  } as unknown as Electron.Display
}

function fallbackSource(source: { id: string; name: string; displayId?: string; png: string }) {
  return {
    id: source.id,
    name: source.name,
    display_id: source.displayId || '',
    appIcon: null,
    thumbnail: {
      toDataURL: () => `data:image/png;base64,${source.png}`,
      toPNG: () => Buffer.from(source.png),
      toJPEG: () => Buffer.from(source.png),
      getSize: () => ({ width: 1920, height: 1080 }),
      crop: () => ({
        toPNG: () => Buffer.from(`crop:${source.png}`),
        toJPEG: () => Buffer.from(`crop:${source.png}`)
      })
    }
  } as unknown as Electron.DesktopCapturerSource
}

function screenApiLike(displays: Electron.Display[], overrides?: {
  primary?: Electron.Display
  matching?: Electron.Display
}) {
  const primary = overrides?.primary || displays[0]
  return {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => primary,
    getDisplayMatching: () => overrides?.matching || primary
  }
}

function nativeCaptureLike(overrides?: {
  isAvailable?: () => boolean
  resolveDisplayIndex?: (display: { id: number }) => number | null
  captureScreen?: (displayIndex: number) => Buffer | null
  captureRegion?: () => Buffer | null
}) {
  return {
    isAvailable: () => true,
    resolveDisplayIndex: () => 0,
    captureScreen: () => null,
    captureRegion: () => null,
    ...overrides
  }
}

describe('PluginScreen captureScreen source routing', () => {
  it('routes window source ids to the desktopCapturer fallback', async () => {
    const display = displayLike({ id: 7 })
    let nativeCaptureCalls = 0
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async () => [fallbackSource({ id: 'window:42:0', name: 'Window', png: 'window-png' })]
      },
      screen: screenApiLike([display]),
      nativeCapture: nativeCaptureLike({
        captureScreen: () => {
          nativeCaptureCalls += 1
          return Buffer.from('native-png')
        }
      })
    })

    const buffer = await pluginScreen.captureScreen({ sourceId: 'window:42:0' })

    assert.equal(nativeCaptureCalls, 0)
    assert.equal(buffer.toString(), 'window-png')
  })

  it('captures the primary display natively when no sourceId is given', async () => {
    const display = displayLike({ id: 7 })
    const resolvedDisplayIds: number[] = []
    let desktopCapturerCalls = 0
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async () => {
          desktopCapturerCalls += 1
          return []
        }
      },
      screen: screenApiLike([display]),
      nativeCapture: nativeCaptureLike({
        resolveDisplayIndex: (target) => {
          resolvedDisplayIds.push(target.id)
          return 0
        },
        captureScreen: () => Buffer.from('native-primary')
      })
    })

    const buffer = await pluginScreen.captureScreen()

    assert.deepEqual(resolvedDisplayIds, [7])
    assert.equal(desktopCapturerCalls, 0)
    assert.equal(buffer.toString(), 'native-primary')
  })

  it('maps screen source ids to the native index of the matching display', async () => {
    const primary = displayLike({ id: 7 })
    const secondary = displayLike({ id: 9, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } })
    const resolvedDisplayIds: number[] = []
    const capturedIndexes: number[] = []
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async () => {
          throw new Error('should not hit desktopCapturer')
        }
      },
      screen: screenApiLike([primary, secondary]),
      nativeCapture: nativeCaptureLike({
        resolveDisplayIndex: (target) => {
          resolvedDisplayIds.push(target.id)
          return 1
        },
        captureScreen: (displayIndex) => {
          capturedIndexes.push(displayIndex)
          return Buffer.from('native-secondary')
        }
      })
    })

    const buffer = await pluginScreen.captureScreen({ sourceId: 'screen:9:0' })

    assert.deepEqual(resolvedDisplayIds, [9])
    assert.deepEqual(capturedIndexes, [1])
    assert.equal(buffer.toString(), 'native-secondary')
  })

  it('resolves the display through desktopCapturer display_id when the embedded id does not match', async () => {
    const first = displayLike({ id: 111 })
    const second = displayLike({ id: 222, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } })
    const requestedOptions: Electron.SourcesOptions[] = []
    const resolvedDisplayIds: number[] = []
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async (options) => {
          requestedOptions.push(options)
          return [fallbackSource({ id: 'screen:0:0', name: 'Screen', displayId: '222', png: 'unused' })]
        }
      },
      screen: screenApiLike([first, second]),
      nativeCapture: nativeCaptureLike({
        resolveDisplayIndex: (target) => {
          resolvedDisplayIds.push(target.id)
          return target.id === 222 ? 0 : null
        },
        captureScreen: () => Buffer.from('native-222')
      })
    })

    const buffer = await pluginScreen.captureScreen({ sourceId: 'screen:0:0' })

    assert.deepEqual(requestedOptions[0].thumbnailSize, { width: 1, height: 1 })
    assert.deepEqual(resolvedDisplayIds, [222])
    assert.equal(buffer.toString(), 'native-222')
  })

  it('falls back to desktopCapturer when the display cannot be mapped to a native index', async () => {
    const display = displayLike({ id: 7 })
    let nativeCaptureCalls = 0
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async () => [fallbackSource({ id: 'screen:7:0', name: 'Screen', displayId: '7', png: 'fallback-png' })]
      },
      screen: screenApiLike([display]),
      nativeCapture: nativeCaptureLike({
        resolveDisplayIndex: () => null,
        captureScreen: () => {
          nativeCaptureCalls += 1
          return Buffer.from('native-png')
        }
      })
    })

    const buffer = await pluginScreen.captureScreen({ sourceId: 'screen:7:0' })

    assert.equal(nativeCaptureCalls, 0)
    assert.equal(buffer.toString(), 'fallback-png')
  })
})

describe('PluginScreen captureRegion fallback source selection', () => {
  const primary = displayLike({ id: 7 })
  const secondary = displayLike({ id: 9, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } })
  const region = { x: 2000, y: 100, width: 200, height: 100 }

  it('prefers the source whose display_id matches the target display', async () => {
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async () => [
          fallbackSource({ id: 'screen:0:0', name: 'A', displayId: '9', png: 'png-a' }),
          fallbackSource({ id: 'screen:1:0', name: 'B', displayId: '7', png: 'png-b' })
        ]
      },
      screen: screenApiLike([primary, secondary], { matching: secondary }),
      nativeCapture: nativeCaptureLike({ isAvailable: () => false })
    })

    const buffer = await pluginScreen.captureRegion(region)

    assert.equal(buffer.toString(), 'crop:png-a')
  })

  it('falls back to the display-ordinal source when display_id is empty', async () => {
    const pluginScreen = new PluginScreen({
      desktopCapturer: {
        getSources: async () => [
          fallbackSource({ id: 'screen:0:0', name: 'A', png: 'png-a' }),
          fallbackSource({ id: 'screen:1:0', name: 'B', png: 'png-b' })
        ]
      },
      screen: screenApiLike([primary, secondary], { matching: secondary }),
      nativeCapture: nativeCaptureLike({ isAvailable: () => false })
    })

    const buffer = await pluginScreen.captureRegion(region)

    assert.equal(buffer.toString(), 'crop:png-b')
  })
})

describe('PluginScreen getMediaStreamConstraints', () => {
  it('only enables desktop audio on platforms that support loopback capture', () => {
    const pluginScreen = new PluginScreen()

    const constraints = pluginScreen.getMediaStreamConstraints({
      sourceId: 'screen:0:0',
      audio: true
    }) as { audio: unknown; video: { mandatory: { chromeMediaSourceId: string } } }

    if (process.platform === 'darwin') {
      assert.equal(constraints.audio, false)
    } else {
      assert.deepEqual(constraints.audio, { mandatory: { chromeMediaSource: 'desktop' } })
    }
    assert.equal(constraints.video.mandatory.chromeMediaSourceId, 'screen:0:0')
  })

  it('keeps audio disabled when not requested', () => {
    const pluginScreen = new PluginScreen()

    const constraints = pluginScreen.getMediaStreamConstraints({
      sourceId: 'screen:0:0'
    }) as { audio: unknown }

    assert.equal(constraints.audio, false)
  })
})
