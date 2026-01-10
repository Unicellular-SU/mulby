import { BrowserWindow } from 'electron'
import { registerClipboardHandlers } from './clipboard'
import { registerNotificationHandlers } from './notification'
import { registerWindowHandlers } from './window'
import { registerPluginHandlers } from './plugin'
import { registerThemeHandlers } from './theme'
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
}
