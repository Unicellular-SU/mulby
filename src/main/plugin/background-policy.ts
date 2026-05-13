import type { Plugin } from '../../shared/types/plugin'

export interface BackgroundPluginStateSnapshot {
  backgroundRunning?: boolean
}

export function supportsBackground(plugin: Pick<Plugin, 'manifest'>): boolean {
  return plugin.manifest.pluginSetting?.background === true
}

export function shouldRestorePersistentBackgroundPlugin(
  plugin: Pick<Plugin, 'enabled' | 'manifest'>,
  state: BackgroundPluginStateSnapshot
): boolean {
  return (
    plugin.enabled &&
    state.backgroundRunning === true &&
    supportsBackground(plugin) &&
    plugin.manifest.pluginSetting?.persistent === true
  )
}

export function shouldPreserveBackgroundRunningOnShutdown(plugin: Pick<Plugin, 'manifest'>): boolean {
  return supportsBackground(plugin) && plugin.manifest.pluginSetting?.persistent === true
}
