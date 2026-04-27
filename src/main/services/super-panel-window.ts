/**
 * 超级面板窗口管理器
 *
 * 参照 TrayMenuWindowManager 模式，管理超级面板的独立 BrowserWindow。
 *
 * 核心能力：
 * - 创建/缓存/复用轻量级无边框透明窗口
 * - 根据鼠标位置智能定位（防溢出）
 * - IPC 双向通信（推送状态 / 接收动作）
 * - 失焦自动隐藏 + 剪贴板恢复回调
 */

import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import type { ThemeManager } from './theme'
import type { SuperPanelState } from './super-panel-manager'
import { registerAppWindow, unregisterAppWindow } from './ipc-caller-resolver'
import log from 'electron-log'

// 面板尺寸
const PANEL_WIDTH = 300
const PANEL_MAX_HEIGHT = 580
const PANEL_MARGIN = 8

interface SuperPanelWindowOptions {
  themeManager: ThemeManager
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  onHide: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export class SuperPanelWindowManager {
  private window: BrowserWindow | null = null
  private currentState: SuperPanelState | null = null
  private _ignoreBlur = false

  constructor(private readonly options: SuperPanelWindowOptions) {
    // 注册 IPC
    this.registerIpc()
  }

  /** 在指定坐标显示面板 */
  async showAt(x: number, y: number, state: SuperPanelState): Promise<void> {
    const win = await this.ensureWindow()
    this.currentState = state

    win.setSize(PANEL_WIDTH, this.computePanelHeight(state))
    this.positionWindow(win, x, y)

    // 推送状态数据
    win.webContents.send('super-panel:state', state)

    if (!win.isVisible()) {
      win.show()
    }
    // 确保窗口获焦以接收键盘事件（↑↓/Enter/Esc）和 blur 自动隐藏
    win.focus()
    win.webContents.focus()
  }

  /** 推送状态更新（不移动窗口位置，但重新计算高度以适配新布局） */
  pushState(state: SuperPanelState): void {
    this.currentState = state
    if (!this.window || this.window.isDestroyed()) return

    const newHeight = this.computePanelHeight(state)
    const [currentWidth, currentHeight] = this.window.getSize()
    if (currentWidth !== PANEL_WIDTH || currentHeight !== newHeight) {
      this.window.setSize(PANEL_WIDTH, newHeight)
      // 高度增大时可能超出屏幕底部，重新定位
      if (newHeight > currentHeight) {
        this.repositionIfOverflow()
      }
    }

    this.window.webContents.send('super-panel:state', state)
  }

  /** 根据面板状态计算所需高度 */
  private computePanelHeight(state: SuperPanelState): number {
    // 固定值来自 super-panel.css 实测（box-sizing: border-box）
    const itemHeight = 48
    const headerHeight = 48        // .sp-header: padding 12+10, min-content 24, border-bottom 1
    const footerHeight = 32        // .sp-footer: border-top 1, padding 6+8, content ~16
    const groupHeaderHeight = 28
    const outerChrome = 14         // body padding 6×2 + .sp-shell border 1×2
    const listPadding = 12         // .sp-list padding 6×2

    let listCount: number
    let groupCount = 0
    if (state.mode === 'pinned') {
      if (state.pinnedGroups) {
        listCount = state.pinnedGroups.reduce((sum, g) => sum + g.items.length, 0)
        const showHeaders = state.pinnedGroups.length > 1 || state.pinnedGroups.some(g => g.boundApp)
        if (showHeaders) {
          groupCount = state.pinnedGroups.filter(g => g.items.length > 0 || showHeaders).length
        }
      } else {
        listCount = state.pinnedItems?.length || 0
      }
    } else {
      listCount = state.items.length
    }

    const searchBarHeight = state.mode === 'match' && state.items.length > 1 ? 38 : 0
    let translationHeight = 0
    if (state.translation) {
      if (state.translation.expanded && state.translation.expandedHeight) {
        translationHeight = state.translation.expandedHeight + 6
      } else {
        // 折叠态实测：margin-top 6 + padding 8×2 + header ~20 + 2-line text ~36 + border 2 ≈ 80
        translationHeight = 80
      }
    }

    const contentHeight = outerChrome + headerHeight + searchBarHeight + translationHeight
      + groupCount * groupHeaderHeight + listPadding
      + Math.max(listCount, 1) * itemHeight + footerHeight
    return Math.min(contentHeight, PANEL_MAX_HEIGHT)
  }

  /** 前端请求调整窗口高度（动作面板展开/收起或渲染后校正） */
  adjustHeight(height: number): void {
    if (!this.window || this.window.isDestroyed()) return
    const clamped = Math.min(Math.max(height, 100), PANEL_MAX_HEIGHT)
    const [currentWidth] = this.window.getSize()
    this.window.setSize(currentWidth, Math.round(clamped))
    this.repositionIfOverflow()
  }

  /** 窗口高度变化后，确保不超出屏幕工作区域 */
  private repositionIfOverflow(): void {
    if (!this.window || this.window.isDestroyed()) return
    const bounds = this.window.getBounds()
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    const area = display.workArea

    let { x, y } = bounds
    const maxX = area.x + area.width - bounds.width - PANEL_MARGIN
    const maxY = area.y + area.height - bounds.height - PANEL_MARGIN
    if (x > maxX) x = Math.max(area.x + PANEL_MARGIN, maxX)
    if (y > maxY) y = Math.max(area.y + PANEL_MARGIN, maxY)

    if (x !== bounds.x || y !== bounds.y) {
      this.window.setPosition(Math.round(x), Math.round(y), false)
    }
  }

  /** 获取当前面板窗口 ID（用于排除面板窗口） */
  getWindowId(): number | null {
    if (!this.window || this.window.isDestroyed()) return null
    return this.window.id
  }

  /** 隐藏面板 */
  hide(): void {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return
    try {
      this.window.hide()
      this.options.onHide()
    } catch (err) {
      log.warn('[SuperPanel] 隐藏窗口失败:', err)
      this.window = null
    }
  }

  /** 销毁窗口和 IPC */
  destroy(): void {
    this.unregisterIpc()
    const win = this.window
    this.window = null
    if (win && !win.isDestroyed()) {
      try {
        win.destroy()
      } catch (err) {
        log.warn('[SuperPanel] 销毁窗口失败:', err)
      }
    }
  }

  // ==================== IPC ====================

  private registerIpc(): void {
    // 清除可能残留的旧 handler
    try { ipcMain.removeHandler('super-panel:getState') } catch { /* 忽略 */ }
    try { ipcMain.removeHandler('super-panel:action') } catch { /* 忽略 */ }
    try { ipcMain.removeHandler('super-panel:close') } catch { /* 忽略 */ }
    try { ipcMain.removeHandler('super-panel:setIgnoreBlur') } catch { /* 忽略 */ }

    ipcMain.handle('super-panel:getState', () => {
      return this.currentState || { capturedText: '', items: [], visible: false }
    })

    ipcMain.handle('super-panel:action', async (_event, action: string, payload?: Record<string, unknown>) => {
      return this.options.onAction(action, payload)
    })

    ipcMain.handle('super-panel:close', () => {
      this.hide()
      this.options.onHide()
      return { success: true }
    })

    ipcMain.handle('super-panel:setIgnoreBlur', (_event, ignore: boolean) => {
      this._ignoreBlur = Boolean(ignore)
    })
  }

  private unregisterIpc(): void {
    try { ipcMain.removeHandler('super-panel:getState') } catch { /* 忽略 */ }
    try { ipcMain.removeHandler('super-panel:action') } catch { /* 忽略 */ }
    try { ipcMain.removeHandler('super-panel:close') } catch { /* 忽略 */ }
    try { ipcMain.removeHandler('super-panel:setIgnoreBlur') } catch { /* 忽略 */ }
  }

  // ==================== 窗口管理 ====================

  /**
   * 预热窗口：提前创建并加载页面，但不显示
   * 
   * 消除了由于 Chromium 渲染进程冷启动造成的 200-500ms 首次唤起延迟。
   * 此操作由 SuperPanelManager 在非阻塞的闲时触发。
   */
  async preWarm(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) return
    await this.ensureWindow()
    log.info('[SuperPanel] 窗口预热完成')
  }

  private windowPromise: Promise<BrowserWindow> | null = null

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }
    
    if (this.windowPromise) {
      return this.windowPromise
    }

    this.windowPromise = (async () => {
      let win: BrowserWindow | null = null
      try {
        win = new BrowserWindow({
          width: PANEL_WIDTH,
          height: PANEL_MAX_HEIGHT,
          show: false,
          frame: false,
          transparent: true,
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          movable: false,
          hasShadow: true,
          type: process.platform === 'darwin' ? 'panel' : 'toolbar',
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false
          }
        })

        // 注册主题管理
        this.options.themeManager.registerWindow(win)

        // macOS: 在所有工作空间和全屏应用上方显示
        if (process.platform === 'darwin') {
          win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
          win.setAlwaysOnTop(true, 'pop-up-menu')
        } else {
          win.setAlwaysOnTop(true)
        }

        // 失焦自动隐藏（弹出原生菜单等操作期间通过 _ignoreBlur 暂停）
        const hideOnBlur = () => {
          if (this._ignoreBlur) return
          if (win && !win.isDestroyed() && win.isVisible()) {
            win.hide()
            this.options.onHide()
          }
        }
        win.on('blur', hideOnBlur)

        // Windows: transparent+frameless+toolbar 窗口可能不触发 blur，
        // 用焦点轮询兜底确保点击外部时隐藏
        if (process.platform === 'win32') {
          let focusPollTimer: ReturnType<typeof setInterval> | null = null
          const startFocusPoll = () => {
            if (focusPollTimer) return
            focusPollTimer = setInterval(() => {
              if (!win || win.isDestroyed()) {
                if (focusPollTimer) { clearInterval(focusPollTimer); focusPollTimer = null }
                return
              }
              if (win.isVisible() && !win.isFocused()) {
                hideOnBlur()
                if (focusPollTimer) { clearInterval(focusPollTimer); focusPollTimer = null }
              }
            }, 100)
          }
          const stopFocusPoll = () => {
            if (focusPollTimer) { clearInterval(focusPollTimer); focusPollTimer = null }
          }
          win.on('show', startFocusPoll)
          win.on('hide', stopFocusPoll)
          win.on('closed', stopFocusPoll)
        }

        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

        // 加载页面
        const devServerUrl = process.env.VITE_DEV_SERVER_URL
        if (devServerUrl) {
          const pageUrl = new URL('/super-panel.html', devServerUrl).toString()
          await win.loadURL(pageUrl)
        } else {
          await win.loadFile(join(__dirname, '../renderer/super-panel.html'))
        }

        // 先注册到 IPC 调用方来源解析器，避免 closed handler 先于 registerAppWindow 触发
        // 导致注册表残留 / 漏解绑
        const winId = win.id
        registerAppWindow(winId)

        win.on('closed', () => {
          if (this.window === win) {
            this.window = null
          }
          unregisterAppWindow(winId)
        })

        this.window = win
        return win
      } catch (err) {
        if (win && !win.isDestroyed()) {
          win.destroy()
        }
        throw err
      } finally {
        this.windowPromise = null
      }
    })()

    return this.windowPromise
  }

  /**
   * 智能定位面板窗口
   *
   * 默认显示在鼠标光标右下方，留 8px 间距。
   * 若右侧/下方溢出显示器工作区域，自动翻转到左侧/上方。
   */
  private positionWindow(win: BrowserWindow, cursorX: number, cursorY: number): void {
    const display = screen.getDisplayNearestPoint({ x: cursorX, y: cursorY })
    const area = display.workArea
    const bounds = win.getBounds()
    const gap = PANEL_MARGIN

    // 默认在光标右下方
    let x = cursorX + gap
    let y = cursorY + gap

    // 右侧溢出 → 翻转到左侧
    if (x + bounds.width > area.x + area.width - gap) {
      x = cursorX - bounds.width - gap
    }

    // 下方溢出 → 翻转到上方
    if (y + bounds.height > area.y + area.height - gap) {
      y = cursorY - bounds.height - gap
    }

    // 最终 clamp 确保不超出工作区域
    x = clamp(x, area.x + gap, area.x + area.width - bounds.width - gap)
    y = clamp(y, area.y + gap, area.y + area.height - bounds.height - gap)

    win.setPosition(Math.round(x), Math.round(y), false)
  }
}
