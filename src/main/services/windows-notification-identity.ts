export const WINDOWS_PRODUCTION_APP_USER_MODEL_ID = 'com.mulby.app'
export const WINDOWS_TOAST_ACTIVATOR_CLSID = '{BBAE23D7-2D64-4F90-A351-22D1731416B3}'

interface ResolveWindowsNotificationIdentityOptions {
  isPackaged: boolean
  execPath: string
}

interface WindowsNotificationIdentity {
  appUserModelId: string
  toastActivatorClsid?: string
}

export function resolveWindowsNotificationIdentity(
  options: ResolveWindowsNotificationIdentityOptions
): WindowsNotificationIdentity {
  if (!options.isPackaged) {
    return {
      appUserModelId: options.execPath
    }
  }

  return {
    appUserModelId: WINDOWS_PRODUCTION_APP_USER_MODEL_ID,
    toastActivatorClsid: WINDOWS_TOAST_ACTIVATOR_CLSID
  }
}
