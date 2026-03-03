import { BrowserWindow, app, screen } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { ThemeManager } from './theme'
import { injectCustomTitleBar } from '../plugin/titlebar'
import { isIgnoringBlur } from './blur-manager'
import { ATTACHED_PANEL_HEIGHT, ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT } from '../constants/panel-window'

export type SystemPageMode = 'none' | 'attached' | 'detached'

export type SystemPageId =
  | 'settings'
  | 'plugin-manager'
  | 'plugin-store'
  | 'background-plugins'
  | 'task-scheduler'
  | 'log-viewer'
  | 'ai-settings'
  | 'ai-mcp-settings'
  | 'ai-skills-settings'

export type SettingsCenterSection =
  | 'general'
  | 'shortcuts'
  | 'commandQuickLaunch'
  | 'commandAll'
  | 'permissions'
  | 'security'
  | 'developer'
  | 'about'

export interface OpenSystemPagePayload {
  page: SystemPageId
  settingsSection?: SettingsCenterSection
  shortcutCommandHint?: string
}

export interface SystemPageState {
  open: boolean
  mode: SystemPageMode
  page: SystemPageId | null
  title: string
}

export class SystemPageWindowManager {
  private mainWindow: BrowserWindow | null = null
  private themeManager: ThemeManager | null = null
  private attachedWindow: BrowserWindow | null = null
  private detachedWindow: BrowserWindow | null = null
  private currentRoute: OpenSystemPagePayload | null = null

  private moveHandler: (() => void) | null = null
  private resizeHandler: (() => void) | null = null
  private syncScheduled = false

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
    if (!window) {
      this.closeAll()
      return
    }
    this.emitState()
  }

  setThemeManager(manager: ThemeManager): void {
    this.themeManager = manager
    if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
      manager.registerWindow(this.attachedWindow)
    }
    if (this.detachedWindow && !this.detachedWindow.isDestroyed()) {
      manager.registerWindow(this.detachedWindow)
    }
  }

  getAttachedWindow(): BrowserWindow | null {
    if (!this.attachedWindow || this.attachedWindow.isDestroyed()) return null
    return this.attachedWindow
  }

  getDetachedWindow(): BrowserWindow | null {
    if (!this.detachedWindow || this.detachedWindow.isDestroyed()) return null
    return this.detachedWindow
  }

  isAttachedOpen(): boolean {
    return this.getAttachedWindow() !== null
  }

  getState(): SystemPageState {
    const attached = this.getAttachedWindow()
    if (attached) {
      return {
        open: true,
        mode: 'attached',
        page: this.currentRoute?.page ?? null,
        title: this.resolveTitle(this.currentRoute)
      }
    }

    const detached = this.getDetachedWindow()
    if (detached) {
      return {
        open: true,
        mode: 'detached',
        page: this.currentRoute?.page ?? null,
        title: this.resolveTitle(this.currentRoute)
      }
    }

    return {
      open: false,
      mode: 'none',
      page: null,
      title: ''
    }
  }

  getModeByWindow(win: BrowserWindow | null): SystemPageMode {
    if (!win || win.isDestroyed()) return 'none'
    const attached = this.getAttachedWindow()
    if (attached && attached.id === win.id) return 'attached'
    const detached = this.getDetachedWindow()
    if (detached && detached.id === win.id) return 'detached'
    return 'none'
  }

  async openAttached(input: OpenSystemPagePayload): Promise<boolean> {
    const route = this.normalizeRoute(input)
    const mainWindow = this.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false
    }

    this.currentRoute = route

    const existingDetached = this.getDetachedWindow()
    if (existingDetached) {
      this.dispatchRoute(existingDetached, route)
      existingDetached.setTitle(this.resolveTitle(route))
      if (!existingDetached.isVisible()) {
        existingDetached.show()
      }
      if (existingDetached.isMinimized()) {
        existingDetached.restore()
      }
      existingDetached.focus()
      this.emitState()
      return true
    }

    const existingAttached = this.getAttachedWindow()
    if (existingAttached) {
      this.dispatchRoute(existingAttached, route)
      this.showAttached()
      this.emitState()
      return true
    }

    const { x, y, width } = this.calculateAttachedBounds()
    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const backgroundColor = currentTheme === 'dark' ? '#1e293b' : '#ffffff'

    const win = new BrowserWindow({
      width,
      height: ATTACHED_PANEL_HEIGHT,
      x,
      y,
      frame: false,
      show: false,
      resizable: true,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      parent: mainWindow,
      modal: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor,
      hasShadow: true,
      roundedCorners: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true
      }
    })

    this.attachedWindow = win
    this.setupPositionSync()

    win.once('ready-to-show', () => {
      if (!this.attachedWindow || this.attachedWindow.isDestroyed()) return
      this.syncPosition()
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      this.attachedWindow.show()
      if (this.currentRoute) {
        this.dispatchRoute(this.attachedWindow, this.currentRoute)
      }
      this.emitState()
    })

    win.on('blur', () => {
      if (isIgnoringBlur()) return

      setTimeout(() => {
        const activeAttached = this.getAttachedWindow()
        if (!activeAttached) return
        if (mainWindow.isFocused()) return
        if (activeAttached.isFocused()) return
        this.hideAttached()
        mainWindow.hide()
      }, 50)
    })

    win.on('closed', () => {
      if (this.attachedWindow && this.attachedWindow.id === win.id) {
        this.cleanupAttached()
        if (!this.getDetachedWindow()) {
          this.currentRoute = null
        }
        this.emitState()
      }
    })

    if (this.themeManager) {
      this.themeManager.registerWindow(win)
    }

    try {
      const loadTarget = this.buildWindowLoadTarget(route, 'attached')
      await win.loadURL(loadTarget)
      return true
    } catch (error) {
      console.error('[SystemPageWindowManager] Failed to load attached window:', error)
      if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
        this.attachedWindow.close()
      }
      this.cleanupAttached()
      this.emitState()
      return false
    }
  }

  async detachCurrent(): Promise<BrowserWindow | null> {
    const attached = this.getAttachedWindow()
    const route = this.currentRoute
    if (!attached || !route) {
      return null
    }

    const existingDetached = this.getDetachedWindow()
    if (existingDetached) {
      this.dispatchRoute(existingDetached, route)
      existingDetached.show()
      if (existingDetached.isMinimized()) {
        existingDetached.restore()
      }
      existingDetached.focus()
      this.closeAttached(true)
      this.emitState()
      return existingDetached
    }

    const bounds = attached.getBounds()
    this.closeAttached(true)

    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const backgroundColor = currentTheme === 'dark' ? '#1e293b' : '#ffffff'

    const detachedWindow = new BrowserWindow({
      width: Math.max(bounds.width, 900),
      height: Math.max(bounds.height, 600),
      x: bounds.x,
      y: bounds.y,
      minWidth: 800,
      minHeight: 500,
      frame: false,
      show: false,
      resizable: true,
      movable: true,
      backgroundColor,
      title: this.resolveTitle(route),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true
      }
    })

    this.detachedWindow = detachedWindow

    detachedWindow.once('ready-to-show', async () => {
      const activeDetached = this.getDetachedWindow()
      if (!activeDetached) return
      try {
        await injectCustomTitleBar(activeDetached, this.resolveTitle(route), currentTheme)
      } catch (error) {
        console.error('[SystemPageWindowManager] Failed to inject custom titlebar:', error)
      }
      activeDetached.show()
      this.dispatchRoute(activeDetached, route)
      this.emitState()
    })

    detachedWindow.on('closed', () => {
      if (this.detachedWindow && this.detachedWindow.id === detachedWindow.id) {
        this.detachedWindow = null
        if (!this.getAttachedWindow()) {
          this.currentRoute = null
        }
        this.emitState()
      }
    })

    detachedWindow.on('maximize', () => {
      detachedWindow.webContents.send('window:stateChanged', { isMaximized: true })
    })
    detachedWindow.on('unmaximize', () => {
      detachedWindow.webContents.send('window:stateChanged', { isMaximized: false })
    })

    detachedWindow.webContents.on('did-finish-load', async () => {
      const activeDetached = this.getDetachedWindow()
      if (!activeDetached) return

      try {
        const hasTitleBar = await activeDetached.webContents.executeJavaScript(
          'document.getElementById("mulby-titlebar") !== null'
        )
        if (!hasTitleBar) {
          const theme = this.themeManager?.getActualTheme() || 'dark'
          await injectCustomTitleBar(activeDetached, this.resolveTitle(route), theme)
        }
      } catch (error) {
        console.error('[SystemPageWindowManager] Failed to re-inject titlebar:', error)
      }
    })

    if (this.themeManager) {
      this.themeManager.registerWindow(detachedWindow)
    }

    try {
      const loadTarget = this.buildWindowLoadTarget(route, 'detached')
      await detachedWindow.loadURL(loadTarget)
      this.emitState()
      return detachedWindow
    } catch (error) {
      console.error('[SystemPageWindowManager] Failed to load detached window:', error)
      if (!detachedWindow.isDestroyed()) {
        detachedWindow.close()
      }
      this.detachedWindow = null
      this.emitState()
      return null
    }
  }

  closeAttached(preserveRoute = false): void {
    const attached = this.getAttachedWindow()
    if (attached) {
      attached.close()
    }
    this.cleanupAttached()
    if (!preserveRoute && !this.getDetachedWindow()) {
      this.currentRoute = null
    }
    this.emitState()
  }

  closeByCaller(caller: BrowserWindow | null): boolean {
    if (!caller || caller.isDestroyed()) return false

    const mode = this.getModeByWindow(caller)
    if (mode === 'attached') {
      this.closeAttached()
      return true
    }
    if (mode === 'detached') {
      const detached = this.getDetachedWindow()
      detached?.close()
      return true
    }

    const main = this.mainWindow
    if (main && !main.isDestroyed() && main.id === caller.id) {
      if (this.getAttachedWindow()) {
        this.closeAttached()
        return true
      }
      const detached = this.getDetachedWindow()
      if (detached) {
        detached.close()
        return true
      }
    }

    return false
  }

  async detachByCaller(caller: BrowserWindow | null): Promise<boolean> {
    if (!caller || caller.isDestroyed()) return false

    const mode = this.getModeByWindow(caller)
    const main = this.mainWindow
    const isMainCaller = Boolean(main && !main.isDestroyed() && main.id === caller.id)
    if (!isMainCaller && mode !== 'attached') {
      return false
    }
    const result = await this.detachCurrent()
    return Boolean(result)
  }

  reloadByCaller(caller: BrowserWindow | null): boolean {
    if (!caller || caller.isDestroyed()) return false

    const main = this.mainWindow
    const mode = this.getModeByWindow(caller)
    const isMainCaller = Boolean(main && !main.isDestroyed() && main.id === caller.id)

    if (mode === 'attached') {
      caller.webContents.reload()
      return true
    }
    if (mode === 'detached') {
      caller.webContents.reload()
      return true
    }
    if (isMainCaller) {
      const attached = this.getAttachedWindow()
      if (attached) {
        attached.webContents.reload()
        return true
      }
      const detached = this.getDetachedWindow()
      if (detached) {
        detached.webContents.reload()
        return true
      }
    }
    return false
  }

  hideAttached(): void {
    const attached = this.getAttachedWindow()
    if (attached) {
      attached.hide()
    }
  }

  showAttached(): void {
    const attached = this.getAttachedWindow()
    if (!attached) return
    this.syncPosition()
    attached.showInactive()
  }

  closeAll(): void {
    const attached = this.getAttachedWindow()
    if (attached) {
      attached.close()
    }
    const detached = this.getDetachedWindow()
    if (detached) {
      detached.close()
    }
    this.cleanupAttached()
    this.detachedWindow = null
    this.currentRoute = null
    this.emitState()
  }

  private resolveTitle(route: OpenSystemPagePayload | null): string {
    if (!route) return '系统页面'
    switch (route.page) {
      case 'settings':
        return '设置'
      case 'plugin-manager':
        return '插件管理'
      case 'plugin-store':
        return '插件商店'
      case 'background-plugins':
        return '运行中的插件'
      case 'task-scheduler':
        return '任务调度器'
      case 'log-viewer':
        return '日志查看器'
      case 'ai-settings':
        return 'AI 设置'
      case 'ai-mcp-settings':
        return 'MCP 设置'
      case 'ai-skills-settings':
        return '技能设置'
      default:
        return '系统页面'
    }
  }

  private normalizeRoute(input: OpenSystemPagePayload): OpenSystemPagePayload {
    const page = input.page
    if (page !== 'settings') {
      return { page }
    }
    return {
      page: 'settings',
      settingsSection: input.settingsSection || 'general',
      shortcutCommandHint: (input.shortcutCommandHint || '').trim()
    }
  }

  private dispatchRoute(target: BrowserWindow, route: OpenSystemPagePayload): void {
    if (target.isDestroyed()) return

    switch (route.page) {
      case 'settings':
        target.webContents.send('app:openSystemPlugin', {
          pluginId: 'settings-center',
          params: {
            section: route.settingsSection || 'general',
            shortcutCommandHint: route.shortcutCommandHint || ''
          }
        })
        return
      case 'plugin-manager':
        target.webContents.send('app:openPluginManager')
        return
      case 'plugin-store':
        target.webContents.send('app:openPluginStore')
        return
      case 'background-plugins':
        target.webContents.send('app:openBackgroundPlugins')
        return
      case 'task-scheduler':
        target.webContents.send('app:openTaskScheduler')
        return
      case 'log-viewer':
        target.webContents.send('app:openLogViewer')
        return
      case 'ai-settings':
        target.webContents.send('app:openAiSettings')
        return
      case 'ai-mcp-settings':
        target.webContents.send('app:openAiSettings')
        target.webContents.send('app:openAiMcpSettings')
        return
      case 'ai-skills-settings':
        target.webContents.send('app:openAiSettings')
        target.webContents.send('app:openAiSkillsSettings')
        return
      default:
        return
    }
  }

  private emitState(): void {
    const main = this.mainWindow
    if (!main || main.isDestroyed()) return
    try {
      main.webContents.send('systemPage:state', this.getState())
    } catch {
      // ignore
    }
  }

  private calculateAttachedBounds(): { x: number; y: number; width: number } {
    const main = this.mainWindow
    if (!main || main.isDestroyed()) {
      return { x: 0, y: 0, width: 900 }
    }

    const bounds = main.getBounds()
    return {
      x: bounds.x,
      y: bounds.y + bounds.height + 8,
      width: bounds.width
    }
  }

  private setupPositionSync(): void {
    const main = this.mainWindow
    if (!main || main.isDestroyed()) return

    this.removePositionSync()
    this.moveHandler = () => this.scheduleSync()
    this.resizeHandler = () => this.scheduleSync()
    main.on('move', this.moveHandler)
    main.on('moved', this.moveHandler)
    main.on('resize', this.resizeHandler)
    if (process.platform === 'darwin') {
      const willMoveEvent = 'will-move' as Parameters<BrowserWindow['on']>[0]
      main.on(willMoveEvent, this.moveHandler)
    }
  }

  private removePositionSync(): void {
    const main = this.mainWindow
    if (!main || main.isDestroyed()) {
      this.moveHandler = null
      this.resizeHandler = null
      return
    }
    if (this.moveHandler) {
      main.removeListener('move', this.moveHandler)
      main.removeListener('moved', this.moveHandler)
      if (process.platform === 'darwin') {
        const willMoveEvent = 'will-move' as Parameters<BrowserWindow['on']>[0]
        main.removeListener(willMoveEvent, this.moveHandler)
      }
      this.moveHandler = null
    }
    if (this.resizeHandler) {
      main.removeListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
  }

  private scheduleSync(): void {
    if (this.syncScheduled) return
    this.syncScheduled = true
    setImmediate(() => {
      this.syncPosition()
      this.syncScheduled = false
    })
  }

  private syncPosition(): void {
    const main = this.mainWindow
    const attached = this.getAttachedWindow()
    if (!main || main.isDestroyed() || !attached) return

    const { x, y, width } = this.calculateAttachedBounds()
    const bounds = attached.getBounds()
    const display = screen.getDisplayNearestPoint({ x, y })
    const workArea = display.workArea
    let height = bounds.height
    if (y + height > workArea.y + workArea.height) {
      height = Math.max(ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT, workArea.y + workArea.height - y)
    }
    attached.setBounds({ x, y, width, height })
  }

  private cleanupAttached(): void {
    this.removePositionSync()
    this.attachedWindow = null
    this.syncScheduled = false
  }

  private buildWindowLoadTarget(route: OpenSystemPagePayload, mode: 'attached' | 'detached'): string {
    const baseUrl = this.resolveRendererBaseUrl()
    const parsed = new URL(baseUrl)
    parsed.searchParams.set('mulbySystemWindow', '1')
    parsed.searchParams.set('mulbySystemMode', mode)
    parsed.searchParams.set('mulbySystemPage', route.page)
    if (route.page === 'settings') {
      parsed.searchParams.set('mulbySystemSection', route.settingsSection || 'general')
      parsed.searchParams.set('mulbySystemHint', route.shortcutCommandHint || '')
    } else {
      parsed.searchParams.delete('mulbySystemSection')
      parsed.searchParams.delete('mulbySystemHint')
    }
    return parsed.toString()
  }

  private resolveRendererBaseUrl(): string {
    const mainWindow = this.mainWindow
    if (mainWindow && !mainWindow.isDestroyed()) {
      const loadedUrl = mainWindow.webContents.getURL()
      if (loadedUrl && loadedUrl !== 'about:blank') return loadedUrl
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      return process.env.VITE_DEV_SERVER_URL
    }

    const filePath = join(__dirname, '../renderer/index.html')
    if (app.isPackaged || existsSync(filePath)) {
      return pathToFileURL(filePath).toString()
    }

    if (!app.isPackaged) {
      return 'http://localhost:5173/'
    }

    return pathToFileURL(filePath).toString()
  }
}
