import { ipcMain, BrowserWindow } from 'electron'

export function registerWindowHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.on('window:hide', () => {
    const win = getMainWindow()
    win?.hide()
  })

  ipcMain.on('window:setSize', (_, width: number, height: number) => {
    const win = getMainWindow()
    win?.setSize(width, height)
  })

  ipcMain.on('window:center', () => {
    const win = getMainWindow()
    win?.center()
  })
}
