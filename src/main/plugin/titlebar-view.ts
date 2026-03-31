import { BrowserWindow, ipcMain, WebContentsView } from 'electron'
import { ThemeManager } from '../services/theme'

export const DETACHED_TITLEBAR_HEIGHT = 36

// 存储活跃的标题栏窗口 → 插件视图映射
const titlebarWindows = new Map<number, { win: BrowserWindow; pluginView: WebContentsView }>()

// 全局 handler 只注册一次
let globalHandlersRegistered = false

function ensureGlobalHandlers(): void {
  if (globalHandlersRegistered) return
  globalHandlersRegistered = true

  // 处理标题栏动作 (on 可以多次监听)
  ipcMain.on('titlebar:action', (event, action: string) => {
    const entry = titlebarWindows.get(event.sender.id)
    if (!entry) return
    const { win, pluginView } = entry
    if (win.isDestroyed()) return

    switch (action) {
      case 'minimize':
        win.minimize()
        break
      case 'maximize':
        if (win.isMaximized()) {
          win.unmaximize()
        } else {
          win.maximize()
        }
        break
      case 'close':
        win.close()
        break
      case 'toggle-pin': {
        const current = win.isAlwaysOnTop()
        win.setAlwaysOnTop(!current)
        break
      }
      case 'reload':
        if (!pluginView.webContents.isDestroyed()) {
          pluginView.webContents.reload()
        }
        break
    }
  })

  // 处理获取窗口状态（handle 只能注册一次，通过 sender.id 区分）
  ipcMain.handle('titlebar:getState', (event) => {
    const entry = titlebarWindows.get(event.sender.id)
    if (!entry) return { isMaximized: false, isAlwaysOnTop: false }
    const { win } = entry
    if (win.isDestroyed()) return { isMaximized: false, isAlwaysOnTop: false }
    return {
      isMaximized: win.isMaximized(),
      isAlwaysOnTop: win.isAlwaysOnTop()
    }
  })
}

/**
 * 设置标题栏 IPC 通道。
 * 当标题栏 HTML 页面通过 preload 发送动作时，这里转发到对应的窗口操作。
 */
export function setupTitlebarIPC(
  win: BrowserWindow,
  pluginView: WebContentsView,
  _themeManager: ThemeManager | null
): void {
  // 确保全局 handler 已注册
  ensureGlobalHandlers()

  // 注册当前窗口到映射表
  const wcId = win.webContents.id
  titlebarWindows.set(wcId, { win, pluginView })

  // 窗口状态变化时通知标题栏
  win.on('maximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('titlebar:windowState', { isMaximized: true })
    }
    if (!pluginView.webContents.isDestroyed()) {
      pluginView.webContents.send('window:stateChanged', { isMaximized: true })
    }
  })
  win.on('unmaximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('titlebar:windowState', { isMaximized: false })
    }
    if (!pluginView.webContents.isDestroyed()) {
      pluginView.webContents.send('window:stateChanged', { isMaximized: false })
    }
  })

  // 窗口关闭时清理映射
  win.once('closed', () => {
    titlebarWindows.delete(wcId)
  })
}

/**
 * 初始化标题栏内容（发送标题和主题信息）。
 * 在标题栏 HTML 加载完成后调用。
 */
export function initTitlebar(
  win: BrowserWindow,
  title: string,
  theme: 'light' | 'dark'
): void {
  if (win.isDestroyed()) return
  win.webContents.send('titlebar:init', { title, theme })
}

/**
 * 向标题栏发送主题变更通知。
 */
export function notifyTitlebarThemeChange(
  win: BrowserWindow,
  theme: 'light' | 'dark'
): void {
  if (win.isDestroyed()) return
  win.webContents.send('titlebar:themeChanged', theme)
}

/**
 * 设置插件 WebContentsView 的布局 bounds —— 紧贴标题栏下方。
 */
export function layoutPluginView(
  win: BrowserWindow,
  pluginView: WebContentsView,
  includeTitleBar: boolean
): void {
  if (win.isDestroyed()) return
  const [contentWidth, contentHeight] = win.getContentSize()
  const titleBarHeight = includeTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0
  pluginView.setBounds({
    x: 0,
    y: titleBarHeight,
    width: contentWidth,
    height: Math.max(1, contentHeight - titleBarHeight)
  })
}
