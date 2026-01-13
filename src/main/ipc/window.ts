import { ipcMain, BrowserWindow } from 'electron'
import { PluginWindowManager } from '../plugin/window'
import { ThemeManager } from '../services/theme'

export function registerWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginWindowManager: PluginWindowManager,
  themeManager: ThemeManager
) {
  ipcMain.on('window:hide', (event) => {
    // 使用发送者窗口而非主窗口，以支持面板和独立窗口模式
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.hide()
  })

  ipcMain.on('window:setSize', (event, width: number, height: number) => {
    // 使用发送者窗口而非主窗口，以支持面板和独立窗口模式
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      // 直接调整大小，无需切换 resizable 状态
      // setSize 在 macOS 上对无边框窗口也有效
      win.setSize(width, height)
    }
  })

  ipcMain.on('window:center', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
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
    if (win) {
      // 重载前设置背景色并隐藏窗口内容，避免闪白
      const isDark = themeManager.getActualTheme() === 'dark'
      const bgColor = isDark ? '#1e293b' : '#ffffff'
      win.setBackgroundColor(bgColor)
      win.setOpacity(0)

      // 监听加载完成事件
      const onFinishLoad = () => {
        // 延迟一点再显示，确保页面完全渲染
        setTimeout(() => {
          win.setOpacity(1)
        }, 50)
        win.webContents.removeListener('did-finish-load', onFinishLoad)
      }
      win.webContents.on('did-finish-load', onFinishLoad)

      win.webContents.reload()
    }
  })
}
