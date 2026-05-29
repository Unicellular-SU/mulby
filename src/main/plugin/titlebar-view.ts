import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron'
import { ThemeManager } from '../services/theme'
import log from 'electron-log'
import { getPinnedSize } from '../services/window-size-pin'
import { getWindowsFramelessSurfaceInsets } from '../services/window-surface'

export const DETACHED_TITLEBAR_HEIGHT = 36

// 存储活跃的标题栏窗口 → 插件视图映射
const titlebarWindows = new Map<number, { win: BrowserWindow; pluginView: WebContentsView }>()

// 存储拖拽状态
const dragStates = new Map<number, { startX: number; startY: number; winStartX: number; winStartY: number }>()

// 全局 handler 只注册一次
let globalHandlersRegistered = false

function canMaximizeWindow(win: BrowserWindow): boolean {
  return !win.isDestroyed() && win.isResizable()
}

function getTitlebarState(win: BrowserWindow) {
  return {
    isMaximized: win.isMaximized(),
    isAlwaysOnTop: win.isAlwaysOnTop(),
    canMaximize: canMaximizeWindow(win)
  }
}

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
        if (!canMaximizeWindow(win)) return
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

  // JS-based window drag: start
  ipcMain.on('titlebar:startDrag', (event, screenX: number, screenY: number) => {
    const entry = titlebarWindows.get(event.sender.id)
    if (!entry) {
      log.info(`[titlebar:startDrag] no entry for sender.id=${event.sender.id}`)
      return
    }
    const { win } = entry
    if (win.isDestroyed()) return
    const [winX, winY] = win.getPosition()
    dragStates.set(event.sender.id, {
      startX: screenX,
      startY: screenY,
      winStartX: winX,
      winStartY: winY
    })
    log.info(`[titlebar:startDrag] winId=${win.id} screen=(${screenX},${screenY}) winPos=(${winX},${winY})`)
  })

  // JS-based window drag: move
  ipcMain.on('titlebar:dragging', (event, screenX: number, screenY: number) => {
    const entry = titlebarWindows.get(event.sender.id)
    const dragState = dragStates.get(event.sender.id)
    if (!entry || !dragState) return
    const { win } = entry
    if (win.isDestroyed()) return
    const dx = screenX - dragState.startX
    const dy = screenY - dragState.startY
    const newX = dragState.winStartX + dx
    const newY = dragState.winStartY + dy
    const pinned = process.platform === 'win32' ? getPinnedSize(win.id) : undefined
    if (pinned) {
      win.setBounds({ x: newX, y: newY, width: pinned.width, height: pinned.height })
    } else {
      win.setPosition(newX, newY)
    }
  })

  // JS-based window drag: end
  ipcMain.on('titlebar:endDrag', (event) => {
    dragStates.delete(event.sender.id)
  })

  // Focus request from titlebar: make window key + focus plugin content
  ipcMain.on('titlebar:requestFocus', (event) => {
    const entry = titlebarWindows.get(event.sender.id)
    if (!entry) {
      log.info(`[titlebar:requestFocus] no entry for sender.id=${event.sender.id}`)
      return
    }
    const { win, pluginView } = entry
    if (win.isDestroyed()) return

    const wasFocused = win.isFocused()
    const pluginWasFocused = pluginView.webContents.isDestroyed() ? false : pluginView.webContents.isFocused()
    log.info(`[titlebar:requestFocus] winId=${win.id} win.isFocused=${wasFocused} pluginView.isFocused=${pluginWasFocused}`)

    if (!wasFocused) {
      if (process.platform === 'darwin') {
        app.focus({ steal: true })
      }
      win.show()
      win.focus()
    }
    if (!pluginView.webContents.isDestroyed() && !pluginView.webContents.isFocused()) {
      pluginView.webContents.focus()
      log.info(`[titlebar:requestFocus] called pluginView.webContents.focus() for winId=${win.id}, now=${pluginView.webContents.isFocused()}`)
    }
  })

  // 处理获取窗口状态（handle 只能注册一次，通过 sender.id 区分）
  ipcMain.handle('titlebar:getState', (event) => {
    const entry = titlebarWindows.get(event.sender.id)
    if (!entry) return { isMaximized: false, isAlwaysOnTop: false, canMaximize: false }
    const { win } = entry
    if (win.isDestroyed()) return { isMaximized: false, isAlwaysOnTop: false, canMaximize: false }
    return getTitlebarState(win)
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
    const state = getTitlebarState(win)
    if (!win.isDestroyed()) {
      win.webContents.send('titlebar:windowState', state)
    }
    if (!pluginView.webContents.isDestroyed()) {
      pluginView.webContents.send('window:stateChanged', state)
    }
  })
  win.on('unmaximize', () => {
    const state = getTitlebarState(win)
    if (!win.isDestroyed()) {
      win.webContents.send('titlebar:windowState', state)
    }
    if (!pluginView.webContents.isDestroyed()) {
      pluginView.webContents.send('window:stateChanged', state)
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
  theme: 'light' | 'dark',
  isDev = false
): void {
  if (win.isDestroyed()) return
  win.webContents.send('titlebar:init', { title, theme, isDev })
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
  const { top, right, bottom, left } = getWindowsFramelessSurfaceInsets()
  pluginView.setBounds({
    x: left,
    y: top + titleBarHeight,
    width: Math.max(1, contentWidth - left - right),
    height: Math.max(1, contentHeight - top - bottom - titleBarHeight)
  })
}
