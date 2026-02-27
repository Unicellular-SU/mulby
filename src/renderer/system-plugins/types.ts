import type { SettingsSection } from '../components/SettingsView'

export type SystemPluginId = 'settings-center'

export interface SettingsCenterSystemPluginRoute {
  section: SettingsSection
  shortcutCommandHint: string
}

export interface SystemPluginRoute {
  pluginId: SystemPluginId
  params: SettingsCenterSystemPluginRoute
}

export const DEFAULT_SYSTEM_PLUGIN_ROUTE: SystemPluginRoute = {
  pluginId: 'settings-center',
  params: {
    section: 'general',
    shortcutCommandHint: ''
  }
}
