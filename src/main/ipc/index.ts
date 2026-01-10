import { BrowserWindow } from 'electron'
import { registerClipboardHandlers } from './clipboard'
import { registerNotificationHandlers } from './notification'
import { registerWindowHandlers } from './window'
import { registerPluginHandlers } from './plugin'
import { PluginManager } from '../plugin'
import { PluginWindowManager } from '../plugin/window'

export function registerAllHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginManager: PluginManager,
  pluginWindowManager: PluginWindowManager
) {
  registerClipboardHandlers()
  registerNotificationHandlers()
  registerWindowHandlers(getMainWindow, pluginWindowManager)
  registerPluginHandlers(pluginManager)
}
