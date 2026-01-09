import { BrowserWindow } from 'electron'
import { registerClipboardHandlers } from './clipboard'
import { registerNotificationHandlers } from './notification'
import { registerWindowHandlers } from './window'
import { registerPluginHandlers } from './plugin'
import { PluginManager } from '../plugin'

export function registerAllHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginManager: PluginManager
) {
  registerClipboardHandlers()
  registerNotificationHandlers()
  registerWindowHandlers(getMainWindow)
  registerPluginHandlers(pluginManager)
}
