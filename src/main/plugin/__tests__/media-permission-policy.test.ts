import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getMissingMediaPermissions,
  hasDeclaredMediaPermissions,
  resolveRequiredMediaPermissions
} from '../media-permission-policy'

describe('media permission policy', () => {
  it('maps Electron audio media requests to microphone permission', () => {
    assert.deepEqual(
      resolveRequiredMediaPermissions('media', { mediaTypes: ['audio'] }),
      ['microphone']
    )
    assert.deepEqual(
      resolveRequiredMediaPermissions('media', { mediaType: 'audio' }),
      ['microphone']
    )
  })

  it('maps Electron video media requests to camera permission', () => {
    assert.deepEqual(
      resolveRequiredMediaPermissions('media', { mediaTypes: ['video'] }),
      ['camera']
    )
    assert.deepEqual(
      resolveRequiredMediaPermissions('media', { mediaType: 'video' }),
      ['camera']
    )
  })

  it('requires both manifest permissions for combined audio and video requests', () => {
    const required = resolveRequiredMediaPermissions('media', { mediaTypes: ['audio', 'video'] })

    assert.deepEqual(required, ['microphone', 'camera'])
    assert.equal(hasDeclaredMediaPermissions({ microphone: true }, required!), false)
    assert.deepEqual(getMissingMediaPermissions({ microphone: true }, required!), ['camera'])
    assert.equal(hasDeclaredMediaPermissions({ microphone: true, camera: true }, required!), true)
  })

  it('returns an empty requirement list for unknown media requests so callers can reject plugins explicitly', () => {
    assert.deepEqual(resolveRequiredMediaPermissions('media', {}), [])
    assert.deepEqual(resolveRequiredMediaPermissions('media', { mediaType: 'unknown' }), [])
  })

  it('ignores non-media Electron permissions', () => {
    assert.equal(resolveRequiredMediaPermissions('geolocation', { mediaTypes: ['audio'] }), null)
  })
})
