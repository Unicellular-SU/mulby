import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PERMISSIONS } from '../constants'
import {
  getPermissionOverview,
  getPermissionViewItems,
  shouldShowPermissionRequestButton
} from '../permissions-view-model'

describe('permissions view model', () => {
  it('summarizes Windows permissions as system-managed instead of an authorization ratio', () => {
    const overview = getPermissionOverview({
      platform: 'win32',
      permissions: PERMISSIONS,
      permissionStatus: {
        microphone: 'granted',
        camera: 'denied',
        geolocation: 'not-determined'
      }
    })

    assert.equal(overview.text, '3 项由 Windows 管理')
    assert.equal(overview.progressMode, 'managed')
  })

  it('marks Windows geolocation as use-time checked so not-determined is not shown as a missing grant', () => {
    const [location] = getPermissionViewItems({
      platform: 'win32',
      permissions: PERMISSIONS.filter((item) => item.id === 'geolocation'),
      permissionStatus: {
        geolocation: 'not-determined'
      }
    })

    assert.equal(location.displayStatus, 'runtime-check')
    assert.equal(location.countsAsGranted, null)
  })

  it('does not show in-app request buttons for Windows system-managed permissions', () => {
    assert.equal(
      shouldShowPermissionRequestButton({
        platform: 'win32',
        canRequestProgrammatically: true,
        displayStatus: 'denied'
      }),
      false
    )
  })
})
