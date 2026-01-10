import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { registerAllHandlers } from './ipc'
import { PluginManager } from './plugin'
import { PluginWindowManager } from './plugin/window'

let mainWindow: BrowserWindow | null = null
const pluginManager = new PluginManager()
const pluginWindowManager = new PluginWindowManager()

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
    mainWindow.show()
    mainWindow.focus()
  }
}

app.whenReady().then(async () => {
  createWindow()

  // 设置主窗口到插件窗口管理器
  pluginWindowManager.setMainWindow(mainWindow!)

  // 设置窗口管理器到插件管理器
  pluginManager.setWindowManager(pluginWindowManager)

  // 初始化插件管理器
  await pluginManager.init()

  // 注册 IPC 处理器
  registerAllHandlers(getMainWindow, pluginManager, pluginWindowManager)

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
