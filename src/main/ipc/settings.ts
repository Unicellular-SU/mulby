import { app, ipcMain } from 'electron'
import type { AppSettings } from '../../shared/types/settings'
import { AppSettingsManager } from '../services/app-settings'
import { AppShortcutManager } from '../services/app-shortcuts'
import { PluginManager } from '../plugin'
import { setLoggerMinLevel } from '../services/logger'
import { applyAutoUpdateSettings, checkAppUpdates, downloadUpdate, getUpdateCenterState, installUpdate, openAppReleasePage } from '../services/update-center'
import { setShortcutRecordingActive } from '../services/shortcut-recording-guard'

function getOpenAtLoginState(): { supported: boolean; enabled: boolean } {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { supported: false, enabled: false }
  }
  const loginItem = app.getLoginItemSettings()
  return {
    supported: true,
    enabled: loginItem.openAtLogin === true
  }
}

function setOpenAtLogin(enabled: boolean): { supported: boolean; enabled: boolean } {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { supported: false, enabled: false }
  }
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
  }
  return getOpenAtLoginState()
}

export function registerSettingsHandlers(
  settingsManager: AppSettingsManager,
  shortcutManager: AppShortcutManager,
  pluginManager: PluginManager,
  options?: {
    /** 超级面板设置变更时回调 */
    onSuperPanelChanged?: (settings: AppSettings) => void
    /** 悬浮球设置变更时回调 */
    onFloatingBallChanged?: (settings: AppSettings) => void
  }
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
    const hasMouseTrigger = Boolean(partial && typeof partial === 'object' && 'mouseTrigger' in partial)
    const hasDoubleTap = Boolean(partial && typeof partial === 'object' && 'doubleTap' in partial)
    const hasSuperPanel = Boolean(partial && typeof partial === 'object' && 'superPanel' in partial)
    const hasFloatingBall = Boolean(partial && typeof partial === 'object' && 'floatingBall' in partial)
    const hasUpdates = Boolean(partial && typeof partial === 'object' && 'updates' in partial)
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

    // 应用鼠标触发设置（P2-A）
    // applyMouseTrigger 内部已处理暂停态（缓存配置以便 resume 时应用）
    if (hasMouseTrigger) {
      shortcutManager.applyMouseTrigger(next.mouseTrigger)
    }

    // 应用双击修饰键设置（P2-B）
    // applyDoubleTap 内部已处理暂停态（缓存配置以便 resume 时应用）
    if (hasDoubleTap) {
      shortcutManager.applyDoubleTap(next.doubleTap)
    }

    // 应用超级面板设置变更
    if (hasSuperPanel) {
      options?.onSuperPanelChanged?.(next)
    }

    if (hasFloatingBall) {
      options?.onFloatingBallChanged?.(next)
    }

    // 自动检查更新设置变更后重新调度
    if (hasUpdates) {
      applyAutoUpdateSettings()
    }

    return { settings: next, shortcutStatus }
  })

  ipcMain.handle('settings:reset', async () => {
    const next = settingsManager.resetSettings()
    setLoggerMinLevel(next.developer.logLevel)
    await pluginManager.init()
    const shortcutStatus = shortcutManager.apply(next.shortcuts)
    // 重置时也重新应用鼠标触发和双击修饰键
    shortcutManager.applyMouseTrigger(next.mouseTrigger)
    shortcutManager.applyDoubleTap(next.doubleTap)
    options?.onSuperPanelChanged?.(next)
    options?.onFloatingBallChanged?.(next)
    applyAutoUpdateSettings()
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

  ipcMain.handle('settings:shortcuts:recording:setActive', (event, active: unknown) => {
    setShortcutRecordingActive(event.sender.id, active === true)
    return true
  })

  ipcMain.handle('settings:startup:getOpenAtLogin', () => {
    return getOpenAtLoginState()
  })

  ipcMain.handle('settings:startup:setOpenAtLogin', (_event, enabled: unknown) => {
    return setOpenAtLogin(enabled === true)
  })

  ipcMain.handle('settings:updateCenter:getState', () => {
    return getUpdateCenterState()
  })

  ipcMain.handle('settings:updateCenter:check', async () => {
    return await checkAppUpdates()
  })

  ipcMain.handle('settings:updateCenter:openReleasePage', async () => {
    return await openAppReleasePage()
  })

  ipcMain.handle('settings:updateCenter:downloadUpdate', async () => {
    return await downloadUpdate()
  })

  ipcMain.handle('settings:updateCenter:installUpdate', () => {
    return installUpdate()
  })
}
