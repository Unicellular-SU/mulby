import { BrowserWindow } from 'electron'
import { registerClipboardHandlers } from './clipboard'
import { registerClipboardHistoryHandlers } from './clipboard-history'
import { registerNotificationHandlers } from './notification'
import { registerWindowHandlers } from './window'
import { registerPluginHandlers } from './plugin'
import type { PluginToolRegistry } from '../plugin/plugin-tools'
import { registerThemeHandlers } from './theme'
import { registerScreenHandlers } from './screen'
import { registerShellHandlers, setShellPluginLookup } from './shell'
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
import { registerInputMonitorHandlers } from './input-monitor'
import { registerPermissionHandlers } from './permission'
import { setPermissionPluginLookup } from '../plugin/permission-manager'
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
import { registerLogIpc } from './log'
import { registerSchedulerHandlers } from './scheduler'
import { ClipboardHistoryManager } from '../services/clipboard-history'
import { registerAiHandlers, setAiPluginLookup, type AiHandlersHooks } from './ai'
import { registerSystemPluginHandlers } from './system-plugin'
import { SystemPluginWindowManager } from '../services/system-plugin-window-manager'
import { registerSystemPageHandlers } from './system-page'
import { SystemPageWindowManager } from '../services/system-page-window-manager'
import { OnboardingWindowManager } from '../services/onboarding-window'
import { ActionMenuWindowManager } from '../services/action-menu-window-manager'
import { registerOnboardingHandlers } from './onboarding'


/**
 * IPC Channel Naming Convention (L4)
 *
 * All channels follow the pattern: `domain:action` (camelCase)
 *
 * Domains: clipboard, clipboardHistory, storage, filesystem, shell,
 *   plugin, settings, screen, dialog, system, desktop, shortcut,
 *   security, media, power, tray, network, http, menu, geolocation,
 *   input, permission, host, inbrowser, sharp, ffmpeg, log, scheduler,
 *   ai, systemPlugin, systemPage, onboarding, window, subInput,
 *   ai:mcpServer (nested domain for MCP Server specific ops)
 *
 * Actions: get, set, remove, list, clear, open, close, search, ...
 *
 * Examples:
 *   storage:get, filesystem:readFile, shell:openPath,
 *   plugin:search, settings:update, ai:mcpServer:start
 */
export function registerAllHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginManager: PluginManager,
  pluginWindowManager: PluginWindowManager,
  themeManager: ThemeManager,
  appSettingsManager: AppSettingsManager,
  appShortcutManager: AppShortcutManager,
  clipboardHistoryManager: ClipboardHistoryManager,
  systemPluginWindowManager: SystemPluginWindowManager,
  systemPageWindowManager: SystemPageWindowManager,
  onboardingWindowManager: OnboardingWindowManager,
  actionMenuWindowManager: ActionMenuWindowManager,
  pluginToolRegistry?: PluginToolRegistry,
  refreshMacDockPresentation?: () => void
): {
  warmupFeatureIconCache: () => void
  setOnDisabledPluginToolsChanged: (fn: () => void) => void
  setOnSuperPanelChanged: (fn: (settings: import('../../shared/types/settings').AppSettings) => void) => void
  setOnFloatingBallChanged: (fn: (settings: import('../../shared/types/settings').AppSettings) => void) => void
} {
  registerClipboardHandlers()
  registerClipboardHistoryHandlers(clipboardHistoryManager)
  registerNotificationHandlers()
  registerWindowHandlers(
    getMainWindow,
    pluginWindowManager,
    themeManager,
    appSettingsManager,
    pluginManager,
    actionMenuWindowManager,
    refreshMacDockPresentation
  )
  const pluginHooks = registerPluginHandlers(pluginManager, pluginToolRegistry)
  registerThemeHandlers(themeManager)
  registerScreenHandlers()
  registerShellHandlers()
  // 注入插件查找函数，供 shell:runCommand 来源识别时检查 manifest 权限
  setShellPluginLookup((pluginId) => pluginManager.get(pluginId))
  // 注入插件查找函数，供 AI 请求传播宿主身份与权限
  setAiPluginLookup((pluginId) => pluginManager.get(pluginId))
  // 注入插件查找函数，供媒体设备权限请求检查 manifest 权限
  setPermissionPluginLookup((pluginId) => pluginManager.get(pluginId))
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
  registerMenuHandlers(actionMenuWindowManager)
  registerGeolocationHandlers()
  registerInputHandlers()
  registerInputMonitorHandlers(pluginWindowManager)
  registerPermissionHandlers()
  registerHostHandlers(pluginManager)
  registerFilesystemHandlers()
  registerStorageHandlers()
  registerRegionCaptureHandlers()
  registerColorPickHandlers()
  registerInBrowserHandlers()
  registerSharpHandlers()
  registerFFmpegHandlers()
  const settingsHooks: {
    onSuperPanelChanged?: (settings: import('../../shared/types/settings').AppSettings) => void
    onFloatingBallChanged?: (settings: import('../../shared/types/settings').AppSettings) => void
  } = {}
  registerSettingsHandlers(appSettingsManager, appShortcutManager, pluginManager, {
    onSuperPanelChanged: (settings) => settingsHooks.onSuperPanelChanged?.(settings),
    onFloatingBallChanged: (settings) => settingsHooks.onFloatingBallChanged?.(settings)
  })
  registerDeveloperHandlers(pluginManager)
  registerSchedulerHandlers(pluginManager)
  const aiHooks: AiHandlersHooks = {}
  registerAiHandlers(aiHooks)
  registerSystemPluginHandlers(getMainWindow, systemPluginWindowManager)
  registerSystemPageHandlers(getMainWindow, systemPageWindowManager, actionMenuWindowManager)

  // 注册日志 IPC 处理器
  registerLogIpc()

  // 注册引导窗口 IPC 处理器
  registerOnboardingHandlers(appSettingsManager, appShortcutManager, themeManager, onboardingWindowManager)

  return {
    ...pluginHooks,
    setOnDisabledPluginToolsChanged: (fn: () => void) => {
      aiHooks.onDisabledPluginToolsChanged = fn
    },
    setOnSuperPanelChanged: (fn: (settings: import('../../shared/types/settings').AppSettings) => void) => {
      settingsHooks.onSuperPanelChanged = fn
    },
    setOnFloatingBallChanged: (fn: (settings: import('../../shared/types/settings').AppSettings) => void) => {
      settingsHooks.onFloatingBallChanged = fn
    }
  }
}
