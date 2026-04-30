import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WINDOWS_PRODUCTION_APP_USER_MODEL_ID,
  WINDOWS_TOAST_ACTIVATOR_CLSID,
  resolveWindowsNotificationIdentity
} from '../windows-notification-identity'

describe('windows notification identity', () => {
  it('keeps development notifications on the Electron executable identity', () => {
    const identity = resolveWindowsNotificationIdentity({
      isPackaged: false,
      execPath: String.raw`D:\Node.js\mulby\node_modules\.pnpm\electron@41.2.0\node_modules\electron\dist\electron.exe`
    })

    assert.equal(
      identity.appUserModelId,
      String.raw`D:\Node.js\mulby\node_modules\.pnpm\electron@41.2.0\node_modules\electron\dist\electron.exe`
    )
    assert.notEqual(identity.appUserModelId, WINDOWS_PRODUCTION_APP_USER_MODEL_ID)
  })

  it('uses stable production identifiers for packaged notifications', () => {
    const identity = resolveWindowsNotificationIdentity({
      isPackaged: true,
      execPath: String.raw`C:\Program Files\Mulby\Mulby.exe`
    })

    assert.equal(identity.appUserModelId, WINDOWS_PRODUCTION_APP_USER_MODEL_ID)
    assert.equal(identity.toastActivatorClsid, WINDOWS_TOAST_ACTIVATOR_CLSID)
    assert.match(identity.toastActivatorClsid, /^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/i)
  })
})
