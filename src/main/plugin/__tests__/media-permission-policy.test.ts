import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getMissingMediaPermissions,
  getMissingPluginPermissions,
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

  it('maps desktop video media requests to screen permission', () => {
    assert.deepEqual(
      resolveRequiredMediaPermissions('media', { mediaTypes: ['video'] }, { desktopCapture: true }),
      ['screen']
    )
    assert.deepEqual(
      resolveRequiredMediaPermissions('media', {
        mediaTypes: ['video'],
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: 'screen:1:0'
          }
        }
      }),
      ['screen']
    )
  })

  it('requires both manifest permissions for combined audio and video requests', () => {
    const required = resolveRequiredMediaPermissions('media', { mediaTypes: ['audio', 'video'] })

    assert.deepEqual(required, ['microphone', 'camera'])
    assert.equal(hasDeclaredMediaPermissions({ microphone: true }, required!), false)
    assert.deepEqual(getMissingMediaPermissions({ microphone: true }, required!), ['camera'])
    assert.equal(hasDeclaredMediaPermissions({ microphone: true, camera: true }, required!), true)
  })

  it('requires screen permission for desktop recording with system audio', () => {
    const required = resolveRequiredMediaPermissions(
      'media',
      { mediaTypes: ['audio', 'video'] },
      { desktopCapture: true, desktopAudio: true }
    )

    assert.deepEqual(required, ['screen'])
    assert.equal(hasDeclaredMediaPermissions({ screen: true }, required!), true)
    assert.deepEqual(getMissingMediaPermissions({ microphone: true }, required!), ['screen'])
  })

  it('uses pending desktop capture context when Electron omits media details', () => {
    assert.deepEqual(
      resolveRequiredMediaPermissions('media', {}, { desktopCapture: true }),
      ['screen']
    )
    assert.deepEqual(
      resolveRequiredMediaPermissions('media', {}, { desktopCapture: true, desktopAudio: true }),
      ['screen']
    )
  })

  it('returns an empty requirement list for unknown media requests so callers can reject plugins explicitly', () => {
    assert.deepEqual(resolveRequiredMediaPermissions('media', {}), [])
    assert.deepEqual(resolveRequiredMediaPermissions('media', { mediaType: 'unknown' }), [])
  })

  it('ignores non-media Electron permissions', () => {
    assert.equal(resolveRequiredMediaPermissions('geolocation', { mediaTypes: ['audio'] }), null)
  })

  it('reports missing non-media plugin manifest permissions', () => {
    assert.deepEqual(
      getMissingPluginPermissions({ clipboard: true, notification: true }, ['clipboard', 'notification']),
      []
    )
    assert.deepEqual(
      getMissingPluginPermissions({ inputMonitor: true }, ['inputMonitor', 'accessibility']),
      ['accessibility']
    )
  })
})
