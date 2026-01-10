import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'path'
import { registerAllHandlers } from './ipc'
import { PluginManager } from './plugin'
import { PluginWindowManager } from './plugin/window'
import { ThemeManager } from './theme'

let mainWindow: BrowserWindow | null = null
const pluginManager = new PluginManager()
const pluginWindowManager = new PluginWindowManager()
const themeManager = new ThemeManager()

function getMainWindow() {
  return mainWindow
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 62,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  // 失焦隐藏（类似 Spotlight/uTools 的交互）
  mainWindow.on('blur', () => {
    // 只有在没有附着插件时才隐藏
    if (!pluginWindowManager.hasAttachedPlugin()) {
      mainWindow?.hide()
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function toggleWindow() {
  if (!mainWindow) return
  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    // 获取当前鼠标所在的显示器
    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const { width: screenWidth, height: screenHeight } = display.workAreaSize
    const { x: screenX, y: screenY } = display.workArea

    // 计算窗口位置：水平居中，垂直方向在屏幕 1/5 处
    const windowBounds = mainWindow.getBounds()
    const x = screenX + Math.round((screenWidth - windowBounds.width) / 2)
    const y = screenY + Math.round(screenHeight / 5)

    mainWindow.setPosition(x, y)
    mainWindow.show()
    mainWindow.focus()
  }
}

app.whenReady().then(async () => {
  // macOS: 默认隐藏 Dock 图标，只有独立窗口时才显示
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  createWindow()

  // 设置主窗口到插件窗口管理器
  pluginWindowManager.setMainWindow(mainWindow!)

  // 注册主窗口到主题管理器
  themeManager.registerWindow(mainWindow!)

  // 设置窗口管理器到插件管理器
  pluginManager.setWindowManager(pluginWindowManager)

  // 初始化插件管理器
  await pluginManager.init()

  // 注册 IPC 处理器
  registerAllHandlers(getMainWindow, pluginManager, pluginWindowManager, themeManager)

  // 注册全局快捷键
  globalShortcut.register('Alt+Space', toggleWindow)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
