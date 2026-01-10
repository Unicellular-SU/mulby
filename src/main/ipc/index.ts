import { BrowserWindow } from 'electron'
import { registerClipboardHandlers } from './clipboard'
import { registerNotificationHandlers } from './notification'
import { registerWindowHandlers } from './window'
import { registerPluginHandlers } from './plugin'
import { registerThemeHandlers } from './theme'
import { registerScreenHandlers } from './screen'
import { registerShellHandlers } from './shell'
import { registerDialogHandlers } from './dialog'
import { registerSystemHandlers } from './system'
import { registerGlobalShortcutHandlers } from './shortcut'
import { registerSecurityHandlers } from './security'
import { PluginManager } from '../plugin'
import { PluginWindowManager } from '../plugin/window'
import { ThemeManager } from '../theme'

export function registerAllHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginManager: PluginManager,
  pluginWindowManager: PluginWindowManager,
  themeManager: ThemeManager
) {
  registerClipboardHandlers()
  registerNotificationHandlers()
  registerWindowHandlers(getMainWindow, pluginWindowManager, themeManager)
  registerPluginHandlers(pluginManager)
  registerThemeHandlers(themeManager)
  registerScreenHandlers()
  registerShellHandlers()
  registerDialogHandlers()
  registerSystemHandlers()
  registerGlobalShortcutHandlers()
  registerSecurityHandlers()
}
