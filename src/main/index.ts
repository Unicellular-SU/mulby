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

// 用于防止 show/focus 过程中的 blur 误触发
let ignoringBlur = false

// 单实例锁：确保只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  // 当第二个实例启动时，聚焦到已有窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        toggleWindow()
      } else {
        mainWindow.focus()
      }
    }
  })
}

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
    transparent: true,
    type: 'panel', // macOS 上 panel 类型有助于浮动在全屏应用之上
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  // macOS: 设置窗口在所有工作区可见，并使用 floating 级别置顶
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    mainWindow.setAlwaysOnTop(true, 'floating')
  } else {
    mainWindow.setAlwaysOnTop(true)
  }

  // 失焦隐藏（类似 uTools 的交互）
  mainWindow.on('blur', () => {
    if (ignoringBlur) return

    // 延迟检查，让焦点转移完成
    setTimeout(() => {
      // 如果焦点转移到了面板窗口，不隐藏
      const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
      if (panelWin && panelWin.isFocused()) {
        return
      }
      // 焦点转移到其他地方，隐藏主窗口和面板
      pluginWindowManager.hidePanelWindow()
      mainWindow?.hide()
    }, 50)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible()) {
    pluginWindowManager.hidePanelWindow()
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

    // 临时忽略 blur 事件，防止 show/focus 过程中误触发
    ignoringBlur = true

    mainWindow.show()
    mainWindow.focus()

    // 恢复之前隐藏的面板
    pluginWindowManager.showPanelWindow()

    // 延迟恢复 blur 监听（确保窗口完全获得焦点）
    setTimeout(() => {
      ignoringBlur = false
    }, 100)
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

  // 设置主题管理器到插件窗口管理器
  pluginWindowManager.setThemeManager(themeManager)

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
