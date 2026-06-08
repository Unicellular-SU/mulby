import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { ThemeManager } from './theme'
import { registerProtectedWindow, unregisterProtectedWindow } from '../plugin/input'
import { startIgnoringBlur, stopIgnoringBlur } from './blur-manager'

export interface ActionMenuItem {
  id: string
  label: string
  separator?: boolean
  danger?: boolean
  disabled?: boolean
  checked?: boolean
}

export interface ActionMenuAnchor {
  x?: unknown
  y?: unknown
}

interface ActionMenuRequestOptions {
  ownerWindow: BrowserWindow
  anchor?: ActionMenuAnchor
  items: ActionMenuItem[]
  onSelect?: (id: string) => void | Promise<void>
}

interface CurrentActionMenuRequest {
  ownerWindow: BrowserWindow
  onSelect?: (id: string) => void | Promise<void>
  resolveSelection?: (id: string | null) => void
}

const MENU_WIDTH = 220
const MENU_SHADOW_PADDING = 18
const MENU_WINDOW_WIDTH = MENU_WIDTH + MENU_SHADOW_PADDING * 2
const MENU_PADDING = 8
const MENU_ITEM_HEIGHT = 36
const MENU_SEPARATOR_HEIGHT = 9
const SCREEN_MARGIN = 8
const ANCHOR_GAP = 6
const TRANSPARENT_MENU_BACKGROUND = '#00000000'

export class ActionMenuWindowManager {
  private menuWindow: BrowserWindow | null = null
  private createPromise: Promise<BrowserWindow> | null = null
  private currentRequest: CurrentActionMenuRequest | null = null
  private ownerCleanup: (() => void) | null = null
  private blurSuppressed = false

  constructor(private readonly themeManager: ThemeManager) {
    ipcMain.handle('actionMenu:select', async (event, id: unknown) => {
      if (!this.isMenuSender(event.sender) || typeof id !== 'string') return false
      const request = this.currentRequest
      if (!request) return false
      this.closeCurrent(id)

      try {
        await request.onSelect?.(id)
      } catch (error) {
        log.error('[ActionMenu] action failed:', error)
      }
      return true
    })

    ipcMain.handle('actionMenu:close', (event) => {
      if (!this.isMenuSender(event.sender)) return false
      this.hide()
      return true
    })
  }

  async show(options: ActionMenuRequestOptions & { onSelect: (id: string) => void | Promise<void> }): Promise<boolean> {
    return await this.present(options)
  }

  async showForSelection(options: ActionMenuRequestOptions): Promise<string | null> {
    let resolveSelection!: (id: string | null) => void
    const selection = new Promise<string | null>((resolve) => {
      resolveSelection = resolve
    })
    const shown = await this.present(options, resolveSelection)
    if (!shown) {
      resolveSelection(null)
    }
    return await selection
  }

  private async present(
    options: ActionMenuRequestOptions,
    resolveSelection?: (id: string | null) => void
  ): Promise<boolean> {
    if (options.ownerWindow.isDestroyed()) return false

    const items = options.items.filter((item) => item.separator || item.label.trim().length > 0)
    if (items.length === 0) return false

    this.hide()

    const win = await this.ensureWindow()
    if (win.isDestroyed()) return false

    this.currentRequest = {
      ownerWindow: options.ownerWindow,
      onSelect: options.onSelect,
      resolveSelection
    }
    this.attachOwner(options.ownerWindow, this.shouldPreserveOwnerFocus())
    this.startBlurSuppression()

    const height = this.measureHeight(items)
    const bounds = this.resolveBounds(options.ownerWindow, options.anchor, height)
    this.configureWindowForShow(win)
    win.setBounds(bounds, false)
    win.setBackgroundColor(TRANSPARENT_MENU_BACKGROUND)

    win.webContents.send('actionMenu:show', {
      items,
      theme: this.themeManager.getActualTheme()
    })

    if (this.shouldPreserveOwnerFocus()) {
      win.setFocusable(false)
      win.showInactive()
    } else {
      win.show()
      win.focus()
    }
    return true
  }

  hide(): void {
    this.closeCurrent(null)
  }

  private closeCurrent(selection: string | null): void {
    const request = this.currentRequest
    this.ownerCleanup?.()
    this.ownerCleanup = null
    this.currentRequest = null
    const win = this.menuWindow
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide()
    }
    this.stopBlurSuppression()
    request?.resolveSelection?.(selection)
  }

  destroy(): void {
    this.hide()
    const win = this.menuWindow
    this.menuWindow = null
    this.createPromise = null
    if (win && !win.isDestroyed()) {
      unregisterProtectedWindow(win.id)
      win.destroy()
    }
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.menuWindow && !this.menuWindow.isDestroyed()) {
      return this.menuWindow
    }
    if (this.createPromise) {
      return this.createPromise
    }

    this.createPromise = this.createWindow()
    try {
      return await this.createPromise
    } finally {
      this.createPromise = null
    }
  }

  private async createWindow(): Promise<BrowserWindow> {
    const preloadPath = join(__dirname, '../preload/action-menu.js')
    const win = new BrowserWindow({
      width: MENU_WINDOW_WIDTH,
      height: 80,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      transparent: true,
      hasShadow: false,
      backgroundColor: TRANSPARENT_MENU_BACKGROUND,
      alwaysOnTop: true,
      // macOS：与主启动窗一致用 NSPanel，配合 setVisibleOnAllWorkspaces /
      // setHiddenInMissionControl，确保菜单悬浮在「当前」Space 而不会在 focus()
      // 时把用户拉回菜单首次创建的桌面（非 darwin 平台会忽略该 type）。
      type: 'panel',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    if (process.platform === 'darwin') {
      this.configureWindowForShow(win)
    }

    registerProtectedWindow(win.id)
    win.on('blur', () => {
      setTimeout(() => {
        const current = this.menuWindow
        if (current && !current.isDestroyed() && !current.isFocused()) {
          this.hide()
        }
      }, 80)
    })
    win.on('closed', () => {
      unregisterProtectedWindow(win.id)
      if (this.menuWindow === win) {
        this.menuWindow = null
      }
      this.stopBlurSuppression()
    })

    const menuPath = this.getActionMenuPath()
    if (!menuPath) {
      throw new Error('Action menu HTML not found')
    }
    await win.loadFile(menuPath)
    this.menuWindow = win
    return win
  }

  private configureWindowForShow(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    try {
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true
        })
        // 与主启动窗同款：隐藏于 Mission Control，避免 focus() 激活时
        // macOS 把当前桌面切回菜单窗「出生」的 Space。
        win.setHiddenInMissionControl(true)
      }
      win.setAlwaysOnTop(true, 'pop-up-menu')
    } catch (error) {
      log.warn('[ActionMenu] Failed to configure menu window:', error)
    }
  }

  private shouldPreserveOwnerFocus(): boolean {
    return process.platform === 'win32'
  }

  private getActionMenuPath(): string | null {
    const candidates = app.isPackaged
      ? [join(__dirname, '../renderer/action-menu.html')]
      : [
          join(process.cwd(), 'public/action-menu.html'),
          join(__dirname, '../../public/action-menu.html'),
          join(__dirname, '../renderer/action-menu.html')
        ]

    return candidates.find((candidate) => existsSync(candidate)) ?? null
  }

  private isMenuSender(sender: Electron.WebContents): boolean {
    const win = this.menuWindow
    return Boolean(win && !win.isDestroyed() && win.webContents.id === sender.id)
  }

  private measureHeight(items: ActionMenuItem[]): number {
    const contentHeight = items.reduce((height, item) => {
      return height + (item.separator ? MENU_SEPARATOR_HEIGHT : MENU_ITEM_HEIGHT)
    }, MENU_PADDING * 2)
    return Math.max(44, Math.round(contentHeight))
  }

  private resolveBounds(ownerWindow: BrowserWindow, anchor: ActionMenuAnchor | undefined, height: number) {
    const ownerBounds = ownerWindow.getBounds()
    const anchorPoint = {
      x: ownerBounds.x + (typeof anchor?.x === 'number' ? Math.round(anchor.x) : ownerBounds.width - MENU_WIDTH),
      y: ownerBounds.y + (typeof anchor?.y === 'number' ? Math.round(anchor.y) : 0)
    }

    const display = screen.getDisplayNearestPoint(anchorPoint)
    const area = display.workArea

    let menuX = anchorPoint.x
    let menuY = anchorPoint.y + ANCHOR_GAP

    const maxX = area.x + area.width - MENU_WIDTH - SCREEN_MARGIN
    const minX = area.x + SCREEN_MARGIN
    menuX = Math.min(Math.max(menuX, minX), Math.max(minX, maxX))

    const maxY = area.y + area.height - height - SCREEN_MARGIN
    if (menuY > maxY) {
      menuY = anchorPoint.y - height - ANCHOR_GAP
    }
    const minY = area.y + SCREEN_MARGIN
    menuY = Math.min(Math.max(menuY, minY), Math.max(minY, maxY))

    return {
      x: menuX - MENU_SHADOW_PADDING,
      y: menuY - MENU_SHADOW_PADDING,
      width: MENU_WINDOW_WIDTH,
      height: height + MENU_SHADOW_PADDING * 2
    }
  }

  private attachOwner(ownerWindow: BrowserWindow, closeOnOwnerBlur = false): void {
    this.ownerCleanup?.()
    const hide = () => this.hide()
    ownerWindow.once('closed', hide)
    ownerWindow.on('hide', hide)
    ownerWindow.on('move', hide)
    ownerWindow.on('resize', hide)
    if (closeOnOwnerBlur) {
      ownerWindow.on('blur', hide)
    }
    this.ownerCleanup = () => {
      ownerWindow.removeListener('closed', hide)
      ownerWindow.removeListener('hide', hide)
      ownerWindow.removeListener('move', hide)
      ownerWindow.removeListener('resize', hide)
      if (closeOnOwnerBlur) {
        ownerWindow.removeListener('blur', hide)
      }
    }
  }

  private startBlurSuppression(): void {
    if (this.blurSuppressed) return
    this.blurSuppressed = true
    startIgnoringBlur()
  }

  private stopBlurSuppression(): void {
    if (!this.blurSuppressed) return
    this.blurSuppressed = false
    stopIgnoringBlur()
  }
}
