import { BrowserWindow, app, screen } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { ThemeManager } from './theme'
import { attachShortcutRecordingGuard } from './shortcut-recording-guard'
import { injectCustomTitleBar } from '../plugin/titlebar'
import { isIgnoringBlur } from './blur-manager'
import { ATTACHED_PANEL_HEIGHT, ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT } from '../constants/panel-window'
import { SYSTEM_PAGE_FALLBACK_WIDTH } from '../constants/window-defaults'
import {
  MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT,
  getMainWindowVisibleBounds,
  getMainWindowWindowSize
} from '../main-window-frame'
import {
  applyWindowsFramelessSurface,
  getWindowsFramelessSurfaceInsets,
  getWindowsFramelessSurfaceVisibleBounds,
  getWindowsFramelessSurfaceWindowBounds,
  shouldUseWindowsFramelessSurface
} from './window-surface'
import { registerAppWindow, unregisterAppWindow } from './ipc-caller-resolver'
import { registerProtectedWindow, unregisterProtectedWindow } from '../plugin/input'
import log from 'electron-log'

const ATTACHED_SYSTEM_SHADOW_MARGIN = 12
const WINDOWS_ATTACHED_SHOW_OPACITY_GUARD_MS = 50
const ATTACHED_SYSTEM_SHADOW_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      pointer-events: none;
    }
    .shadow {
      position: absolute;
      inset: ${ATTACHED_SYSTEM_SHADOW_MARGIN}px;
      border-radius: 12px;
      box-shadow:
        0 2px 10px rgba(15, 23, 42, 0.12),
        0 1px 2px rgba(15, 23, 42, 0.08);
    }
  </style>
</head>
<body>
  <div class="shadow"></div>
</body>
</html>`
const ATTACHED_SYSTEM_SHADOW_URL = `data:text/html;charset=UTF-8,${encodeURIComponent(ATTACHED_SYSTEM_SHADOW_HTML)}`

export type SystemPageMode = 'none' | 'attached' | 'detached'

export type SystemPageId =
  | 'settings'
  | 'plugin-manager'
  | 'plugin-store'
  | 'background-plugins'
  | 'task-scheduler'
  | 'log-viewer'
  | 'storage-explorer'
  | 'ai-settings'
  | 'ai-mcp-settings'
  | 'ai-tools-settings'
  | 'ai-skills-settings'

export type SettingsCenterSection =
  | 'dashboard'
  | 'general'
  | 'superPanel'
  | 'shortcuts'
  | 'commandQuickLaunch'
  | 'commandAll'
  | 'permissions'
  | 'security'
  | 'openclaw'
  | 'developer'
  | 'about'

export interface OpenSystemPagePayload {
  page: SystemPageId
  settingsSection?: SettingsCenterSection
  shortcutCommandHint?: string
  detailsPluginId?: string
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
  private attachedShadowWindow: BrowserWindow | null = null
  private detachedWindow: BrowserWindow | null = null
  private currentRoute: OpenSystemPagePayload | null = null

  private moveHandler: (() => void) | null = null
  private resizeHandler: (() => void) | null = null
  private syncScheduled = false
  private preferredAttachedHeight = ATTACHED_PANEL_HEIGHT
  private syncingBounds = false
  private attachedWindowHasBeenShown = false
  private attachedOpacityRestoreTimer: NodeJS.Timeout | null = null

  private shouldUseAttachedShadowWindow(): boolean {
    return process.platform !== 'win32'
  }

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
    const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
    const initialBounds = getWindowsFramelessSurfaceWindowBounds({
      x,
      y,
      width,
      height: ATTACHED_PANEL_HEIGHT
    })
    const backgroundColor = useWindowsFramelessSurface ? '#00000000' : (currentTheme === 'dark' ? '#1e293b' : '#ffffff')

    this.preferredAttachedHeight = ATTACHED_PANEL_HEIGHT
    if (this.shouldUseAttachedShadowWindow()) {
      this.createAttachedShadowWindow(mainWindow)
    }
    const win = new BrowserWindow({
      width: initialBounds.width,
      height: initialBounds.height,
      x: initialBounds.x,
      y: initialBounds.y,
      frame: false,
      thickFrame: !useWindowsFramelessSurface,
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
      transparent: useWindowsFramelessSurface,
      hasShadow: false, // 使用自定义阴影层，避免原生阴影黑边
      roundedCorners: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        // Attached system pages share the same translucent host-window behavior
        // as the search panel, so keep Chromium from background-throttling them.
        backgroundThrottling: false
      }
    })
    this.suppressSystemContextMenu(win)
    attachShortcutRecordingGuard(win)

    this.attachedWindow = win
    registerAppWindow(win.id)
    this.setupPositionSync()

    win.once('ready-to-show', async () => {
      if (!this.attachedWindow || this.attachedWindow.isDestroyed()) return
      if (useWindowsFramelessSurface) {
        await applyWindowsFramelessSurface(this.attachedWindow, { resizeMode: 'bottom' })
        if (!this.attachedWindow || this.attachedWindow.isDestroyed()) return
      }
      this.collapseMainWindowForAttachedPage()
      this.syncPosition()
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      this.showAttachedShadow()
      this.attachedWindow.show()
      this.attachedWindowHasBeenShown = true
      if (this.currentRoute) {
        this.dispatchRoute(this.attachedWindow, this.currentRoute)
      }
      this.emitState()
    })

    win.webContents.on('did-finish-load', () => {
      if (!useWindowsFramelessSurface || !this.attachedWindow || this.attachedWindow.isDestroyed()) return
      void applyWindowsFramelessSurface(this.attachedWindow, { resizeMode: 'bottom' })
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
        unregisterAppWindow(win.id)
        this.cleanupAttached()
        if (!this.getDetachedWindow()) {
          this.currentRoute = null
        }
        this.emitState()
      }
    })

    win.on('resize', () => {
      if (this.syncingBounds || !this.attachedWindow || this.attachedWindow.isDestroyed()) return
      const nextHeight = getWindowsFramelessSurfaceVisibleBounds(this.attachedWindow.getBounds()).height
      this.preferredAttachedHeight = Math.max(ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT, nextHeight)
    })

    if (this.themeManager) {
      this.themeManager.registerWindow(win)
    }

    try {
      const loadTarget = this.buildWindowLoadTarget(route, 'attached')
      await win.loadURL(loadTarget)
      return true
    } catch (error) {
      log.error('[SystemPageWindowManager] Failed to load attached window:', error)
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

    const bounds = getWindowsFramelessSurfaceVisibleBounds(attached.getBounds())
    this.closeAttached(true)

    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
    const windowInsets = getWindowsFramelessSurfaceInsets()
    const toWindowWidth = (value: number | undefined) => value == null ? undefined : value + windowInsets.left + windowInsets.right
    const toWindowHeight = (value: number | undefined) => value == null ? undefined : value + windowInsets.top + windowInsets.bottom
    const detachedBounds = getWindowsFramelessSurfaceWindowBounds({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(bounds.width, 900),
      height: Math.max(bounds.height, 600)
    })
    const backgroundColor = useWindowsFramelessSurface ? '#00000000' : (currentTheme === 'dark' ? '#1e293b' : '#ffffff')

    const detachedWindow = new BrowserWindow({
      width: detachedBounds.width,
      height: detachedBounds.height,
      x: detachedBounds.x,
      y: detachedBounds.y,
      minWidth: toWindowWidth(800)!,
      minHeight: toWindowHeight(500)!,
      frame: false,
      thickFrame: !useWindowsFramelessSurface,
      show: false,
      resizable: true,
      movable: true,
      backgroundColor,
      transparent: useWindowsFramelessSurface,
      hasShadow: !useWindowsFramelessSurface,
      title: this.resolveTitle(route),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true
      }
    })
    this.suppressSystemContextMenu(detachedWindow)
    attachShortcutRecordingGuard(detachedWindow)

    this.detachedWindow = detachedWindow
    registerAppWindow(detachedWindow.id)
    registerProtectedWindow(detachedWindow.id)

    detachedWindow.once('ready-to-show', async () => {
      const activeDetached = this.getDetachedWindow()
      if (!activeDetached) return
      try {
        await injectCustomTitleBar(activeDetached, this.resolveTitle(route), currentTheme)
        if (useWindowsFramelessSurface) {
          await applyWindowsFramelessSurface(activeDetached, { includeTitleBar: true, resizeMode: 'all' })
          if (activeDetached.isDestroyed()) return
        }
      } catch (error) {
        log.error('[SystemPageWindowManager] Failed to inject custom titlebar:', error)
      }
      activeDetached.show()
      this.dispatchRoute(activeDetached, route)
      this.emitState()
    })

    detachedWindow.on('closed', () => {
      if (this.detachedWindow && this.detachedWindow.id === detachedWindow.id) {
        unregisterAppWindow(detachedWindow.id)
        unregisterProtectedWindow(detachedWindow.id)
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
        if (useWindowsFramelessSurface && !activeDetached.isDestroyed()) {
          await applyWindowsFramelessSurface(activeDetached, { includeTitleBar: true, resizeMode: 'all' })
        }
      } catch (error) {
        log.error('[SystemPageWindowManager] Failed to re-inject titlebar:', error)
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
      log.error('[SystemPageWindowManager] Failed to load detached window:', error)
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
    this.clearAttachedOpacityRestoreTimer(true)
    if (attached) {
      attached.hide()
    }
    this.hideAttachedShadow()
  }

  showAttached(): void {
    const attached = this.getAttachedWindow()
    if (!attached) return
    const main = this.mainWindow
    if (main && !main.isDestroyed() && this.shouldUseAttachedShadowWindow()) {
      this.createAttachedShadowWindow(main)
    }
    this.collapseMainWindowForAttachedPage()
    this.syncPosition()
    const needsOpacityGuard = process.platform === 'win32'
      && this.attachedWindowHasBeenShown
      && !attached.isVisible()
    this.clearAttachedOpacityRestoreTimer(false)
    if (needsOpacityGuard) {
      attached.setOpacity(0)
    } else {
      attached.setOpacity(1)
    }
    this.showAttachedShadow()
    attached.showInactive()
    this.attachedWindowHasBeenShown = true
    if (needsOpacityGuard) {
      attached.webContents.invalidate()
      this.attachedOpacityRestoreTimer = setTimeout(() => {
        this.attachedOpacityRestoreTimer = null
        const activeAttached = this.getAttachedWindow()
        if (!activeAttached || !activeAttached.isVisible()) return
        activeAttached.setOpacity(1)
      }, WINDOWS_ATTACHED_SHOW_OPACITY_GUARD_MS)
    }
  }

  closeAll(): void {
    const attached = this.getAttachedWindow()
    if (attached && !attached.isDestroyed()) {
      attached.destroy()
    }
    const detached = this.getDetachedWindow()
    if (detached && !detached.isDestroyed()) {
      detached.destroy()
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
      case 'ai-tools-settings':
        return '工具设置'
      case 'ai-skills-settings':
        return '技能设置'
      case 'storage-explorer':
        return '插件数据浏览器'
      default:
        return '系统页面'
    }
  }

  private normalizeRoute(input: OpenSystemPagePayload): OpenSystemPagePayload {
    const page = input.page
    if (page !== 'settings') {
      return { page, detailsPluginId: input.detailsPluginId }
    }
    return {
      page: 'settings',
      settingsSection: input.settingsSection || 'dashboard',
      shortcutCommandHint: (input.shortcutCommandHint || '').trim()
    }
  }

  private dispatchRoute(target: BrowserWindow, route: OpenSystemPagePayload): void {
    if (target.isDestroyed() || target.webContents.isDestroyed()) return

    switch (route.page) {
      case 'settings':
        target.webContents.send('app:openSystemPlugin', {
          pluginId: 'settings-center',
          params: {
            section: route.settingsSection || 'dashboard',
            shortcutCommandHint: route.shortcutCommandHint || ''
          }
        })
        return
      case 'plugin-manager':
        target.webContents.send('app:openPluginManager', route.detailsPluginId)
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
      case 'storage-explorer':
        target.webContents.send('app:openStorageExplorer')
        return
      case 'ai-settings':
        target.webContents.send('app:openAiSettings')
        return
      case 'ai-mcp-settings':
        target.webContents.send('app:openAiSettings')
        target.webContents.send('app:openAiMcpSettings')
        return
      case 'ai-tools-settings':
        target.webContents.send('app:openAiSettings')
        target.webContents.send('app:openAiToolsSettings')
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
    if (!main || main.isDestroyed() || main.webContents.isDestroyed()) return
    try {
      main.webContents.send('systemPage:state', this.getState())
    } catch {
      // Render frame may have been disposed (e.g. after render process crash)
    }
  }

  private calculateAttachedBounds(): { x: number; y: number; width: number } {
    const main = this.mainWindow
    if (!main || main.isDestroyed()) {
      return { x: 0, y: 0, width: SYSTEM_PAGE_FALLBACK_WIDTH }
    }

    const bounds = getMainWindowVisibleBounds(main.getBounds())
    return {
      x: bounds.x,
      y: bounds.y + bounds.height + 8,
      width: bounds.width
    }
  }

  private createAttachedShadowWindow(mainWindow: BrowserWindow): void {
    if (!this.shouldUseAttachedShadowWindow()) {
      return
    }
    if (this.attachedShadowWindow && !this.attachedShadowWindow.isDestroyed()) {
      return
    }

    const shadowWindow = new BrowserWindow({
      width: 1,
      height: 1,
      x: 0,
      y: 0,
      frame: false,
      show: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      parent: mainWindow,
      modal: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    shadowWindow.setIgnoreMouseEvents(true, { forward: true })
    void shadowWindow.loadURL(ATTACHED_SYSTEM_SHADOW_URL)

    shadowWindow.on('closed', () => {
      if (this.attachedShadowWindow && this.attachedShadowWindow.id === shadowWindow.id) {
        this.attachedShadowWindow = null
      }
    })

    this.attachedShadowWindow = shadowWindow
  }

  private setAttachedShadowBounds(x: number, y: number, width: number, height: number): void {
    if (!this.shouldUseAttachedShadowWindow()) return
    const shadow = this.attachedShadowWindow
    if (!shadow || shadow.isDestroyed()) return
    const margin = ATTACHED_SYSTEM_SHADOW_MARGIN
    shadow.setBounds({
      x: x - margin,
      y: y - margin,
      width: Math.max(1, width + margin * 2),
      height: Math.max(1, height + margin * 2)
    })
  }

  private showAttachedShadow(): void {
    if (!this.shouldUseAttachedShadowWindow()) return
    if (this.attachedShadowWindow && !this.attachedShadowWindow.isDestroyed()) {
      this.attachedShadowWindow.showInactive()
    }
  }

  private collapseMainWindowForAttachedPage(): void {
    const main = this.mainWindow
    if (!main || main.isDestroyed()) return

    const visibleBounds = getMainWindowVisibleBounds(main.getBounds())
    if (visibleBounds.height === MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT) return

    const minSize = getMainWindowWindowSize(400, MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT)
    const maxSize = getMainWindowWindowSize(9999, MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT)
    const nextSize = getMainWindowWindowSize(visibleBounds.width, MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT)

    main.setMinimumSize(minSize.width, minSize.height)
    main.setMaximumSize(maxSize.width, maxSize.height)
    main.setSize(nextSize.width, nextSize.height)

    setImmediate(() => {
      if (main.isDestroyed() || main.webContents.isDestroyed() || !main.isVisible()) return
      main.webContents.invalidate()
    })
  }

  private hideAttachedShadow(): void {
    if (!this.shouldUseAttachedShadowWindow()) return
    if (this.attachedShadowWindow && !this.attachedShadowWindow.isDestroyed()) {
      this.attachedShadowWindow.hide()
    }
  }

  private closeAttachedShadow(): void {
    if (!this.shouldUseAttachedShadowWindow()) {
      this.attachedShadowWindow = null
      return
    }
    if (this.attachedShadowWindow && !this.attachedShadowWindow.isDestroyed()) {
      this.attachedShadowWindow.close()
    }
    this.attachedShadowWindow = null
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
    const display = screen.getDisplayNearestPoint({ x, y })
    const workArea = display.workArea
    let height = this.preferredAttachedHeight
    if (y + height > workArea.y + workArea.height) {
      height = Math.max(ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT, workArea.y + workArea.height - y)
    }
    this.syncingBounds = true
    try {
      attached.setBounds(getWindowsFramelessSurfaceWindowBounds({ x, y, width, height }))
      this.setAttachedShadowBounds(x, y, width, height)
    } finally {
      this.syncingBounds = false
    }
  }

  private cleanupAttached(): void {
    this.clearAttachedOpacityRestoreTimer(true)
    this.removePositionSync()
    this.closeAttachedShadow()
    this.attachedWindow = null
    this.syncScheduled = false
    this.preferredAttachedHeight = ATTACHED_PANEL_HEIGHT
    this.syncingBounds = false
    this.attachedWindowHasBeenShown = false
  }

  private clearAttachedOpacityRestoreTimer(resetOpacity: boolean): void {
    if (this.attachedOpacityRestoreTimer) {
      clearTimeout(this.attachedOpacityRestoreTimer)
      this.attachedOpacityRestoreTimer = null
    }
    if (!resetOpacity) return
    if (process.platform !== 'win32') return
    const attached = this.getAttachedWindow()
    if (!attached) return
    attached.setOpacity(1)
  }

  private suppressSystemContextMenu(win: BrowserWindow): void {
    if (process.platform !== 'win32') return
    win.on('system-context-menu', (event) => {
      event.preventDefault()
    })
  }

  private buildWindowLoadTarget(route: OpenSystemPagePayload, mode: 'attached' | 'detached'): string {
    const baseUrl = this.resolveRendererBaseUrl()
    const parsed = new URL(baseUrl)
    parsed.searchParams.set('mulbySystemWindow', '1')
    parsed.searchParams.set('mulbySystemMode', mode)
    parsed.searchParams.set('mulbySystemPage', route.page)
    if (route.page === 'settings') {
      parsed.searchParams.set('mulbySystemSection', route.settingsSection || 'dashboard')
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
