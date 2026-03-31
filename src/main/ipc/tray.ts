import { ipcMain } from 'electron'
import { createPluginTray, TrayOptions } from '../plugin/tray'
import { windowFromWebContents } from '../services/webcontents-registry'

// 存储每个窗口对应的托盘实例
const windowTrays = new Map<number, ReturnType<typeof createPluginTray>>()

export function registerTrayHandlers() {
  // 创建托盘
  ipcMain.handle('tray:create', (event, options: TrayOptions) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return false

    const pluginName = `window-${win.id}`
    if (!windowTrays.has(win.id)) {
      windowTrays.set(win.id, createPluginTray(pluginName))
    }

    return windowTrays.get(win.id)!.create(options)
  })

  // 销毁托盘
  ipcMain.handle('tray:destroy', (event) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    const tray = windowTrays.get(win.id)
    if (tray) {
      tray.destroy()
    }
  })

  // 设置图标
  ipcMain.handle('tray:setIcon', (event, icon: string) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    const tray = windowTrays.get(win.id)
    if (tray) {
      tray.setIcon(icon)
    }
  })

  // 设置提示
  ipcMain.handle('tray:setTooltip', (event, tooltip: string) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    const tray = windowTrays.get(win.id)
    if (tray) {
      tray.setTooltip(tooltip)
    }
  })

  // 设置标题
  ipcMain.handle('tray:setTitle', (event, title: string) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    const tray = windowTrays.get(win.id)
    if (tray) {
      tray.setTitle(title)
    }
  })

  // 检查是否存在
  ipcMain.handle('tray:exists', (event) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return false

    const tray = windowTrays.get(win.id)
    return tray ? tray.exists() : false
  })
}
