import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createPublicCaptureSource,
  parseDesktopCapturerWindowId
} from '../capture-source-utils'

function imageDataUrl(value: string) {
  return {
    toDataURL: () => value
  }
}

describe('parseDesktopCapturerWindowId', () => {
  it('extracts the native window id from Electron window source ids', () => {
    assert.equal(parseDesktopCapturerWindowId('window:12345:0'), 12345)
    assert.equal(parseDesktopCapturerWindowId('window:12345:1'), 12345)
  })

  it('rejects non-window and malformed source ids', () => {
    assert.equal(parseDesktopCapturerWindowId('screen:1:0'), null)
    assert.equal(parseDesktopCapturerWindowId('window::0'), null)
    assert.equal(parseDesktopCapturerWindowId('window:abc:0'), null)
    assert.equal(parseDesktopCapturerWindowId('window:4294967296:0'), null)
    assert.equal(parseDesktopCapturerWindowId(''), null)
    assert.equal(parseDesktopCapturerWindowId(undefined), null)
  })
})

describe('createPublicCaptureSource', () => {
  it('copies source metadata and attaches valid bounds', () => {
    const source = createPublicCaptureSource(
      {
        id: 'window:12345:0',
        name: 'Target Window',
        thumbnail: imageDataUrl('data:image/png;base64,thumb'),
        display_id: '42',
        appIcon: imageDataUrl('data:image/png;base64,icon')
      },
      { x: -1200, y: 50, width: 800, height: 600 }
    )

    assert.deepEqual(source, {
      id: 'window:12345:0',
      name: 'Target Window',
      thumbnailDataUrl: 'data:image/png;base64,thumb',
      displayId: '42',
      appIconDataUrl: 'data:image/png;base64,icon',
      bounds: { x: -1200, y: 50, width: 800, height: 600 }
    })
  })

  it('omits invalid bounds without dropping the capture source', () => {
    const source = createPublicCaptureSource(
      {
        id: 'window:12345:0',
        name: 'Target Window',
        thumbnail: imageDataUrl('data:image/png;base64,thumb')
      },
      { x: 0, y: 0, width: 0, height: 600 }
    )

    assert.equal(source.bounds, undefined)
    assert.equal(source.thumbnailDataUrl, 'data:image/png;base64,thumb')
  })
})
