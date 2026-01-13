import { ipcMain, BrowserWindow } from 'electron'
import { pluginNativeMenu, MenuItemOptions } from '../plugin/menu'

export function registerMenuHandlers() {
  // 显示上下文菜单
  ipcMain.handle('menu:showContextMenu', (event, items: MenuItemOptions[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    return new Promise<string | null>((resolve) => {
      pluginNativeMenu.showContextMenu(items, win, (id) => {
        resolve(id)
      })
    })
  })
}
