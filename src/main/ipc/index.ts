import { BrowserWindow } from 'electron'
import { registerClipboardHandlers } from './clipboard'
import { registerClipboardHistoryHandlers } from './clipboard-history'
import { registerNotificationHandlers } from './notification'
import { registerWindowHandlers } from './window'
import { registerPluginHandlers } from './plugin'
import { registerThemeHandlers } from './theme'
import { registerScreenHandlers } from './screen'
import { registerShellHandlers } from './shell'
import { registerDialogHandlers } from './dialog'
import { registerSystemHandlers } from './system'
import { registerDesktopHandlers } from './desktop'
import { registerGlobalShortcutHandlers } from './shortcut'
import { registerSecurityHandlers } from './security'
import { registerMediaHandlers } from './media'
import { registerPowerMonitorHandlers } from './power'
import { registerTrayHandlers } from './tray'
import { registerNetworkHandlers } from './network'
import { registerHttpHandlers } from './http'
import { registerMenuHandlers } from './menu'
import { registerGeolocationHandlers } from './geolocation'
import { registerInputHandlers } from './input'
import { registerPermissionHandlers } from './permission'
import { registerHostHandlers } from './host'
import { registerFilesystemHandlers } from './filesystem'
import { registerStorageHandlers } from './storage'
import { registerRegionCaptureHandlers } from '../plugin/region-capture'
import { registerColorPickHandlers } from '../plugin/color-pick'
import { PluginManager } from '../plugin'
import { PluginWindowManager } from '../plugin/window'
import { ThemeManager } from '../services/theme'
import { registerInBrowserHandlers } from './inbrowser'
import { registerSharpHandlers } from './sharp'
import { registerFFmpegHandlers } from './ffmpeg'
import { registerSettingsHandlers } from './settings'
import { AppSettingsManager } from '../services/app-settings'
import { AppShortcutManager } from '../services/app-shortcuts'
import { registerDeveloperHandlers } from './developer'
import { registerLogIpc, setDeveloperModeGetter } from './log'
import { registerSchedulerHandlers } from './scheduler'
import { ClipboardHistoryManager } from '../services/clipboard-history'
import { registerAiHandlers } from './ai'
import { registerSystemPluginHandlers } from './system-plugin'
import { SystemPluginWindowManager } from '../services/system-plugin-window-manager'
import { registerSystemPageHandlers } from './system-page'
import { SystemPageWindowManager } from '../services/system-page-window-manager'


export function registerAllHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginManager: PluginManager,
  pluginWindowManager: PluginWindowManager,
  themeManager: ThemeManager,
  appSettingsManager: AppSettingsManager,
  appShortcutManager: AppShortcutManager,
  clipboardHistoryManager: ClipboardHistoryManager,
  systemPluginWindowManager: SystemPluginWindowManager,
  systemPageWindowManager: SystemPageWindowManager
) {
  registerClipboardHandlers()
  registerClipboardHistoryHandlers(clipboardHistoryManager)
  registerNotificationHandlers()
  registerWindowHandlers(getMainWindow, pluginWindowManager, themeManager, appSettingsManager, pluginManager)
  registerPluginHandlers(pluginManager)
  registerThemeHandlers(themeManager)
  registerScreenHandlers()
  registerShellHandlers()
  registerDialogHandlers()
  registerSystemHandlers()
  registerDesktopHandlers()
  registerGlobalShortcutHandlers()
  registerSecurityHandlers()
  registerMediaHandlers()
  registerPowerMonitorHandlers()
  registerTrayHandlers()
  registerNetworkHandlers()
  registerHttpHandlers()
  registerMenuHandlers()
  registerGeolocationHandlers()
  registerInputHandlers()
  registerPermissionHandlers()
  registerHostHandlers(pluginManager)
  registerFilesystemHandlers()
  registerStorageHandlers()
  registerRegionCaptureHandlers()
  registerColorPickHandlers()
  registerInBrowserHandlers()
  registerSharpHandlers()
  registerFFmpegHandlers()
  registerSettingsHandlers(appSettingsManager, appShortcutManager, pluginManager)
  registerDeveloperHandlers(pluginManager)
  registerSchedulerHandlers(pluginManager)
  registerAiHandlers()
  registerSystemPluginHandlers(getMainWindow, systemPluginWindowManager)
  registerSystemPageHandlers(getMainWindow, systemPageWindowManager)

  // 注册日志 IPC 处理器，并设置开发者模式获取器
  setDeveloperModeGetter(() => appSettingsManager.getSettings().developer.enabled)
  registerLogIpc()
}
