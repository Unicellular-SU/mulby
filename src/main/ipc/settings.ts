import { ipcMain } from 'electron'
import type { AppSettings } from '../../shared/types/settings'
import { AppSettingsManager } from '../services/app-settings'
import { AppShortcutManager } from '../services/app-shortcuts'
import { PluginManager } from '../plugin'
import { setLoggerMinLevel } from '../services/logger'

export function registerSettingsHandlers(
  settingsManager: AppSettingsManager,
  shortcutManager: AppShortcutManager,
  pluginManager: PluginManager
) {
  setLoggerMinLevel(settingsManager.getSettings().developer.logLevel)

  ipcMain.handle('settings:get', () => {
    return {
      settings: settingsManager.getSettings(),
      shortcutStatus: shortcutManager.getStatus()
    }
  })

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    const previous = settingsManager.getSettings()
    const hasShortcuts = Boolean(partial && typeof partial === 'object' && 'shortcuts' in partial)
    const next = settingsManager.updateSettings(partial || {})
    setLoggerMinLevel(next.developer.logLevel)

    const hasPluginPathDiff = previous.developer.pluginPaths.length !== next.developer.pluginPaths.length
      || previous.developer.pluginPaths.some((path, index) => path !== next.developer.pluginPaths[index])
    const needsPluginReload = previous.developer.enabled !== next.developer.enabled
      || previous.developer.autoReload !== next.developer.autoReload
      || hasPluginPathDiff

    if (needsPluginReload) {
      await pluginManager.init()
    }

    const shortcutStatus = hasShortcuts
      ? (shortcutManager.isPaused() ? shortcutManager.getStatus() : shortcutManager.apply(next.shortcuts))
      : shortcutManager.getStatus()
    return { settings: next, shortcutStatus }
  })

  ipcMain.handle('settings:reset', async () => {
    const next = settingsManager.resetSettings()
    setLoggerMinLevel(next.developer.logLevel)
    await pluginManager.init()
    const shortcutStatus = shortcutManager.apply(next.shortcuts)
    return { settings: next, shortcutStatus }
  })

  ipcMain.handle('settings:shortcuts:pause', () => {
    shortcutManager.pause()
    return shortcutManager.getStatus()
  })

  ipcMain.handle('settings:shortcuts:resume', () => {
    const next = settingsManager.getSettings()
    return shortcutManager.resume(next.shortcuts)
  })
}
