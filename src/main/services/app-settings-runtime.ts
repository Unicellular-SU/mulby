import { appSettingsManager } from './app-settings'

export function getAppSettings() {
  return appSettingsManager.getSettings()
}
