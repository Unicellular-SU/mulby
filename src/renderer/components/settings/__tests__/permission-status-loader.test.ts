import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PERMISSIONS } from '../constants'
import { loadPermissionStatuses } from '../permission-status-loader'

describe('settings permission status loader', () => {
  it('loads Windows media statuses from the media API instead of the generic permission API', async () => {
    const calls: string[] = []
    const statuses = await loadPermissionStatuses({
      permissions: PERMISSIONS.filter((item) => item.id === 'microphone' || item.id === 'camera'),
      api: {
        permission: {
          getStatus: async (id) => {
            calls.push(`permission:${id}`)
            return 'not-determined'
          }
        },
        media: {
          getAccessStatus: async (id) => {
            calls.push(`media:${id}`)
            return id === 'microphone' ? 'denied' : 'granted'
          }
        }
      }
    })

    assert.deepEqual(statuses, {
      microphone: 'denied',
      camera: 'granted'
    })
    assert.deepEqual(calls, ['media:microphone', 'media:camera'])
  })

  it('keeps geolocation on the generic permission API', async () => {
    const statuses = await loadPermissionStatuses({
      permissions: PERMISSIONS.filter((item) => item.id === 'geolocation'),
      api: {
        permission: {
          getStatus: async () => 'not-determined'
        }
      }
    })

    assert.deepEqual(statuses, {
      geolocation: 'not-determined'
    })
  })
})
