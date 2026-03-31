import { ipcMain } from 'electron'
import { pluginNativeMenu, MenuItemOptions } from '../plugin/menu'
import { windowFromWebContents } from '../services/webcontents-registry'

export function registerMenuHandlers() {
  // 显示上下文菜单
  ipcMain.handle('menu:showContextMenu', (event, items: MenuItemOptions[]) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    return new Promise<string | null>((resolve) => {
      pluginNativeMenu.showContextMenu(items, win, (id) => {
        resolve(id)
      })
    })
  })
}
