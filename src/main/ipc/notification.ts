import { app, ipcMain, Notification } from 'electron'

export function registerNotificationHandlers() {
  ipcMain.on('notification:show', (_, message: string, type?: string) => {
    const notification = new Notification({
      title: app.getName() || 'Mulby',
      body: message,
      silent: type === 'error' ? false : true
    })
    notification.show()
  })
}
