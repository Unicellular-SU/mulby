import { BrowserWindow, app, ipcMain, Rectangle, screen, shell } from 'electron'
import { join } from 'path'
import type { PluginManager } from '../plugin'
import type { AppSettingsManager } from './app-settings'
import type { ThemeManager } from './theme'
import { loggerService } from './logger'

interface TrayMenuWindowOptions {
  pluginManager: PluginManager
  settingsManager: AppSettingsManager
  themeManager: ThemeManager
  showMainWindow: () => void
  openSettings: () => void
  openAiSettings: () => void
  openPluginManager: () => void
  openBackgroundPlugins: () => void
  openTaskScheduler: () => void
  openPluginStore: () => void
  resetMainWindowPosition: () => void
  reloadPlugins: () => Promise<void>
  restartMainProcess: () => void
  quitMainProcess: () => void
}

type TrayMenuAction =
  | 'toggleOpenAtLogin'
  | 'openSettings'
  | 'openAiSettings'
  | 'openPluginManager'
  | 'openBackgroundPlugins'
  | 'openTaskScheduler'
  | 'openPluginStore'
  | 'openLogsDir'
  | 'reloadPlugins'
  | 'resetWindowPosition'
  | 'restartMainProcess'
  | 'quitMainProcess'
  | 'runRecentPlugin'
  | 'close'

interface TrayMenuRecentItem {
  id: string
  type: 'plugin' | 'command'
  title: string
  subtitle: string
  timestamp: number
  pluginId?: string
  featureCode?: string
}

interface TrayMenuState {
  platform: NodeJS.Platform
  openAtLogin: {
    supported: boolean
    enabled: boolean
  }
  status: {
    backgroundPluginCount: number
    activeHostCount: number
    runningTaskCount: number
    pendingTaskCount: number
    pausedTaskCount: number
  }
  recentActions: TrayMenuRecentItem[]
}

const TRAY_MENU_WIDTH = 380
const TRAY_MENU_HEIGHT = 560
const TRAY_MENU_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function safeText(input: unknown, fallback = ''): string {
  const text = String(input ?? '').trim()
  return text || fallback
}

function shorten(input: string, max = 80): string {
  if (input.length <= max) return input
  return `${input.slice(0, max - 1)}…`
}

export class TrayMenuWindowManager {
  private window: BrowserWindow | null = null

  constructor(private readonly options: TrayMenuWindowOptions) {
    ipcMain.removeHandler('tray-menu:getState')
    ipcMain.removeHandler('tray-menu:action')
    ipcMain.removeHandler('tray-menu:close')

    ipcMain.handle('tray-menu:getState', async () => {
      return this.buildState()
    })

    ipcMain.handle('tray-menu:action', async (_event, action: TrayMenuAction, payload?: Record<string, unknown>) => {
      return this.handleAction(action, payload)
    })

    ipcMain.handle('tray-menu:close', () => {
      this.hide()
      return { success: true }
    })
  }

  async toggle(anchorBounds?: Rectangle): Promise<void> {
    if (this.window && this.window.isVisible()) {
      this.hide()
      return
    }
    await this.open(anchorBounds)
  }

  async open(anchorBounds?: Rectangle): Promise<void> {
    const win = await this.ensureWindow()
    this.positionWindow(win, anchorBounds)
    await this.pushState()
    win.show()
    win.focus()
  }

  hide(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.hide()
  }

  destroy(): void {
    ipcMain.removeHandler('tray-menu:getState')
    ipcMain.removeHandler('tray-menu:action')
    ipcMain.removeHandler('tray-menu:close')
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    const win = new BrowserWindow({
      width: TRAY_MENU_WIDTH,
      height: TRAY_MENU_HEIGHT,
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
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.options.themeManager.registerWindow(win)

    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setAlwaysOnTop(true, 'pop-up-menu')
    } else {
      win.setAlwaysOnTop(true)
    }

    win.on('blur', () => {
      if (!win.isDestroyed()) {
        win.hide()
      }
    })

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const devServerUrl = process.env.VITE_DEV_SERVER_URL
    if (devServerUrl) {
      const pageUrl = new URL('/tray-menu.html', devServerUrl).toString()
      await win.loadURL(pageUrl)
    } else {
      await win.loadFile(join(__dirname, '../renderer/tray-menu.html'))
    }

    win.on('closed', () => {
      this.window = null
    })

    this.window = win
    return win
  }

  private positionWindow(win: BrowserWindow, anchorBounds?: Rectangle): void {
    const anchor = anchorBounds || this.buildFallbackAnchor()
    const anchorPoint = {
      x: Math.round(anchor.x + anchor.width / 2),
      y: Math.round(anchor.y + anchor.height / 2)
    }
    const display = screen.getDisplayNearestPoint(anchorPoint)
    const area = display.workArea
    const bounds = win.getBounds()
    const gap = TRAY_MENU_MARGIN

    const xExpandRight = Math.round(anchor.x)
    const xFallbackLeft = Math.round(anchor.x + anchor.width - bounds.width)
    const rightEdgeLimit = area.x + area.width - gap
    const canExpandRight = xExpandRight + bounds.width <= rightEdgeLimit
    let x = process.platform === 'darwin' && canExpandRight
      ? xExpandRight
      : xFallbackLeft

    const preferAbove =
      process.platform === 'win32' ||
      anchor.y > area.y + area.height / 2
    const yAbove = Math.round(anchor.y - bounds.height - gap)
    const yBelow = Math.round(anchor.y + anchor.height + gap)
    let y = preferAbove ? yAbove : yBelow

    if (y < area.y + gap) {
      y = yBelow
    }
    if (y + bounds.height > area.y + area.height - gap) {
      y = yAbove
    }

    x = clamp(x, area.x + gap, area.x + area.width - bounds.width - gap)
    y = clamp(y, area.y + gap, area.y + area.height - bounds.height - gap)

    win.setPosition(x, y, false)
  }

  private buildFallbackAnchor(): Rectangle {
    const cursor = screen.getCursorScreenPoint()
    return {
      x: cursor.x,
      y: cursor.y,
      width: 1,
      height: 1
    }
  }

  private async pushState(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return
    const state = await this.buildState()
    this.window.webContents.send('tray-menu:state', state)
  }

  private async handleAction(action: TrayMenuAction, payload?: Record<string, unknown>): Promise<{ success: boolean; state?: TrayMenuState; error?: string }> {
    try {
      switch (action) {
        case 'toggleOpenAtLogin':
          this.toggleOpenAtLogin()
          break
        case 'openSettings':
          this.options.openSettings()
          this.hide()
          break
        case 'openAiSettings':
          this.options.openAiSettings()
          this.hide()
          break
        case 'openPluginManager':
          this.options.openPluginManager()
          this.hide()
          break
        case 'openBackgroundPlugins':
          this.options.openBackgroundPlugins()
          this.hide()
          break
        case 'openTaskScheduler':
          this.options.openTaskScheduler()
          this.hide()
          break
        case 'openPluginStore':
          this.options.openPluginStore()
          this.hide()
          break
        case 'openLogsDir':
          await shell.openPath(loggerService.getLogsDir())
          this.hide()
          break
        case 'reloadPlugins':
          await this.options.reloadPlugins()
          break
        case 'resetWindowPosition':
          this.options.resetMainWindowPosition()
          this.options.showMainWindow()
          this.hide()
          break
        case 'restartMainProcess':
          this.options.restartMainProcess()
          break
        case 'quitMainProcess':
          this.options.quitMainProcess()
          break
        case 'runRecentPlugin': {
          const pluginId = safeText(payload?.pluginId)
          const featureCode = safeText(payload?.featureCode)
          if (!pluginId || !featureCode) {
            return { success: false, error: 'Invalid recent plugin payload' }
          }
          await this.options.pluginManager.run(pluginId, featureCode, '')
          this.hide()
          break
        }
        case 'close':
          this.hide()
          break
        default:
          return { success: false, error: `Unsupported action: ${action}` }
      }

      const state = await this.buildState()
      return { success: true, state }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private buildOpenAtLoginState(): { supported: boolean; enabled: boolean } {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return { supported: false, enabled: false }
    }
    const loginItem = app.getLoginItemSettings()
    return {
      supported: true,
      enabled: loginItem.openAtLogin === true
    }
  }

  private toggleOpenAtLogin(): void {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return
    }
    const current = app.getLoginItemSettings().openAtLogin === true
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: !current })
      return
    }
    app.setLoginItemSettings({ openAtLogin: !current, openAsHidden: true })
  }

  private async buildStatus() {
    const backgroundPluginCount = this.options.pluginManager.getBackgroundManager().list().length
    const activeHostCount = this.options.pluginManager.getHostManager().getActiveHosts().length
    const scheduler = (this.options.pluginManager as any).taskScheduler
    let runningTaskCount = 0
    let pendingTaskCount = 0
    let pausedTaskCount = 0

    if (scheduler) {
      try {
        ;[runningTaskCount, pendingTaskCount, pausedTaskCount] = await Promise.all([
          scheduler.getTaskCount({ status: 'running' }),
          scheduler.getTaskCount({ status: 'pending' }),
          scheduler.getTaskCount({ status: 'paused' })
        ])
      } catch {
        runningTaskCount = 0
        pendingTaskCount = 0
        pausedTaskCount = 0
      }
    }

    return {
      backgroundPluginCount,
      activeHostCount,
      runningTaskCount,
      pendingTaskCount,
      pausedTaskCount
    }
  }

  private buildRecentActions(): TrayMenuRecentItem[] {
    const settings = this.options.settingsManager.getSettings()
    const pluginRecent = this.options.pluginManager.getRecentUsed(5).map((item) => ({
      id: `plugin:${item.plugin.id}:${item.feature.code}`,
      type: 'plugin' as const,
      title: safeText(item.plugin.manifest.displayName, item.plugin.id),
      subtitle: shorten(safeText(item.feature.explain, item.feature.code), 56),
      timestamp: item.lastUsedAt,
      pluginId: item.plugin.id,
      featureCode: item.feature.code
    }))

    const commandRecent = [...settings.commandRunner.audit.records]
      .slice(-30)
      .map((item) => {
        const args = Array.isArray(item.args) ? item.args.map((part) => safeText(part)).filter(Boolean).join(' ') : ''
        const subtitle = shorten(args || safeText(item.status), 56)
        return {
          id: `command:${safeText(item.id, `${item.timestamp}`)}`,
          type: 'command' as const,
          title: shorten(safeText(item.command), 40),
          subtitle,
          timestamp: Number(item.timestamp) || 0
        }
      })

    return [...pluginRecent, ...commandRecent]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5)
  }

  private async buildState(): Promise<TrayMenuState> {
    return {
      platform: process.platform,
      openAtLogin: this.buildOpenAtLoginState(),
      status: await this.buildStatus(),
      recentActions: this.buildRecentActions()
    }
  }
}
