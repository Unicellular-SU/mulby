import { BrowserWindow } from 'electron'
import { registerClipboardHandlers } from './clipboard'
import { registerNotificationHandlers } from './notification'
import { registerWindowHandlers } from './window'

export function registerAllHandlers(getMainWindow: () => BrowserWindow | null) {
  registerClipboardHandlers()
  registerNotificationHandlers()
  registerWindowHandlers(getMainWindow)
}
