import { ipcMain, BrowserWindow } from 'electron'
import { PluginWindowManager } from '../plugin/window'

export function registerWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginWindowManager: PluginWindowManager
) {
  ipcMain.on('window:hide', () => {
    const win = getMainWindow()
    win?.hide()
  })

  ipcMain.on('window:setSize', (_, width: number, height: number) => {
    const win = getMainWindow()
    if (win) {
      // macOS 上需要临时启用 resizable 才能动态调整大小
      win.setResizable(true)
      win.setSize(width, height)
      win.setResizable(false)
    }
  })

  ipcMain.on('window:center', () => {
    const win = getMainWindow()
    win?.center()
  })

  // 分离插件为独立窗口
  ipcMain.on('plugin:detach', () => {
    pluginWindowManager.detachCurrent()
  })

  // 关闭当前插件
  ipcMain.on('plugin:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const mainWin = getMainWindow()
      if (win === mainWin) {
        pluginWindowManager.closeAttached()
      } else {
        win.close()
      }
    }
  })

  // 窗口置顶
  ipcMain.on('window:alwaysOnTop', (event, flag: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setAlwaysOnTop(flag)
  })

  // 获取插件模式
  ipcMain.handle('plugin:getMode', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const mainWin = getMainWindow()
    return win === mainWin ? 'attached' : 'detached'
  })

  // 最小化窗口
  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  // 最大化/还原窗口
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    }
  })

  // 获取窗口状态
  ipcMain.handle('window:getState', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return {
      isMaximized: win?.isMaximized() ?? false,
      isAlwaysOnTop: win?.isAlwaysOnTop() ?? false
    }
  })

  // 重新加载插件
  ipcMain.on('plugin:reload', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.reload()
  })
}
