import { app, ipcMain, Notification } from 'electron'
import { permissionManager } from '../plugin/permission-manager'

export function registerNotificationHandlers() {
  ipcMain.handle('notification:show', (event, message: string, type?: string) => {
    permissionManager.ensureCallerAccessPluginPermissions(event.sender, ['notification'])
    const notification = new Notification({
      title: app.getName() || 'Mulby',
      body: message,
      silent: type === 'error' ? false : true
    })
    notification.show()
  })
}
