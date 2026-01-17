import { ipcMain } from 'electron'
import type { AppSettings } from '../../shared/types/settings'
import { AppSettingsManager } from '../services/app-settings'
import { AppShortcutManager } from '../services/app-shortcuts'

export function registerSettingsHandlers(
  settingsManager: AppSettingsManager,
  shortcutManager: AppShortcutManager
) {
  ipcMain.handle('settings:get', () => {
    return {
      settings: settingsManager.getSettings(),
      shortcutStatus: shortcutManager.getStatus()
    }
  })

  ipcMain.handle('settings:update', (_event, partial: Partial<AppSettings>) => {
    const hasShortcuts = Boolean(partial && typeof partial === 'object' && 'shortcuts' in partial)
    const next = settingsManager.updateSettings(partial || {})
    const shortcutStatus = hasShortcuts
      ? (shortcutManager.isPaused() ? shortcutManager.getStatus() : shortcutManager.apply(next.shortcuts))
      : shortcutManager.getStatus()
    return { settings: next, shortcutStatus }
  })

  ipcMain.handle('settings:reset', () => {
    const next = settingsManager.resetSettings()
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
