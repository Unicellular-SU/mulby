import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPluginMedia } from '../media'

describe('PluginMedia permissions', () => {
  it('uses Electron media access status on Windows when available', () => {
    const pluginMedia = createPluginMedia({
      platform: 'win32',
      systemPreferences: {
        getMediaAccessStatus: (mediaType) => mediaType === 'microphone' ? 'denied' : 'granted',
        askForMediaAccess: async () => true
      }
    })

    assert.equal(pluginMedia.getMediaAccessStatus('microphone'), 'denied')
    assert.equal(pluginMedia.getMediaAccessStatus('camera'), 'granted')
  })

  it('falls back to granted on Windows when Electron cannot read media access status', () => {
    const pluginMedia = createPluginMedia({
      platform: 'win32',
      systemPreferences: {
        getMediaAccessStatus: () => {
          throw new Error('unsupported')
        },
        askForMediaAccess: async () => true
      }
    })

    assert.equal(pluginMedia.getMediaAccessStatus('microphone'), 'granted')
  })
})
