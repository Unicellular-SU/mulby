import { BrowserWindow, app, screen, type Display, type Rectangle } from 'electron'
import http from 'http'
import https from 'https'
import { join } from 'path'
import log from 'electron-log'
import { appSettingsManager } from './services/app-settings'
import { captureAutoPasteClipboardPayload } from './ipc/clipboard'
import { isIgnoringBlur, startIgnoringBlur, stopIgnoringBlur, isAppExplicitlyHidden, markAppVisible } from './services/blur-manager'
import { attachShortcutRecordingGuard } from './services/shortcut-recording-guard'
import { refreshActiveWindowCache } from './services/active-window'
import { restoreWin32ForegroundWindow } from './services/native-win32-input'
import { normalizeWindowsNativeWindowHandle } from './services/windows-input-target-window'
import { registerAppWindow } from './services/ipc-caller-resolver'
import { shouldHideMainWindowOnToggle } from './services/main-window-toggle-policy'
import {
  MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT,
  getMainWindowVisibleBounds,
  getMainWindowWindowBounds,
  getMainWindowWindowSize
} from './main-window-frame'
import { shouldPreventMainWindowClose } from './main-window-close-policy'

// ── Constants (L5: extracted magic numbers) ────────────────────────────
export const MW_SHADOW_MARGIN = 18
export const MW_TOGGLE_DEBOUNCE_MS = 180
export const MW_SHOW_BLUR_GUARD_MS = 260
export const MW_SHOW_WITH_DETACHED_BLUR_GUARD_MS = 1800
export const MW_MAC_STAGE_MANAGER_ACTIVATION_SETTLE_MS = 350
export const MW_STATE_SAVE_DEBOUNCE_MS = 500
export const MW_BLUR_HIDE_DELAY_MS = 50
export const MW_MIN_COLLAPSED_WIDTH = 400
export const MW_MIN_COLLAPSED_HEIGHT = MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT
export const MW_DEFAULT_WIDTH = 800
export const MW_EXPANDED_HEIGHT_THRESHOLD = 100
export const MW_DEFAULT_Y_RATIO = 1 / 5
export const MW_OPACITY_RESTORE_DELAY_MS = 50
export const MW_POST_SHOW_FOCUS_RETRY_MS = 80
export const MW_POST_SHOW_FOCUS_VERIFY_MS = 180

const SHADOW_HTML = `<!doctype html>
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
      inset: ${MW_SHADOW_MARGIN}px;
      border-radius: 12px;
      box-shadow:
        0 6px 12px rgba(15, 23, 42, 0.14),
        0 1px 3px rgba(15, 23, 42, 0.10);
    }
  </style>
</head>
<body>
  <div class="shadow"></div>
</body>
</html>`
const SHADOW_DATA_URL = `data:text/html;charset=UTF-8,${encodeURIComponent(SHADOW_HTML)}`

const WINDOWS_WM_INITMENU = 0x0116

// ── Dependency interfaces (L7: explicit contracts instead of full imports) ──

export interface PanelWindowProxy {
  getWindow(): BrowserWindow | null
}

export interface MainWindowPluginDeps {
  getAllDetachedWindows(): BrowserWindow[]
  hidePanelWindow(): void
  showPanelWindow(): void
  getPanelWindow(): PanelWindowProxy | null
}

export interface MainWindowSystemPageDeps {
  getDetachedWindow(): BrowserWindow | null
  hideAttached(): void
  showAttached(): void
  getAttachedWindow(): BrowserWindow | null
}

export interface MainWindowDeps {
  pluginWindowManager: MainWindowPluginDeps
  systemPageWindowManager: MainWindowSystemPageDeps
  getTrayMenuManager: () => { hide: () => void } | null
  clipboardWatcher: { isRecentlyChanged: (maxAge: number) => boolean }
  getLastDeepLinkTime: () => number
  refreshMacDockPresentation?: () => void
}

// ── Utility helpers ────────────────────────────────────────────────────

export function isWindowAvailable(win: BrowserWindow | null): win is BrowserWindow {
  if (!win) return false
  try {
    return !win.isDestroyed()
  } catch {
    return false
  }
}

export function canReachUrl(url: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url)
      const requester = parsed.protocol === 'https:' ? https : http
      const req = requester.request(
        {
          method: 'GET',
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname || '/',
          timeout: timeoutMs
        },
        () => resolve(true)
      )
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.end()
    } catch {
      resolve(false)
    }
  })
}

// ── MainWindowManager ──────────────────────────────────────────────────

export class MainWindowManager {
  private window: BrowserWindow | null = null
  private shadowWindow: BrowserWindow | null = null
  private blurHideTimer: NodeJS.Timeout | null = null
  private blurSuppressionFlushTimer: NodeJS.Timeout | null = null
  private postShowFocusRetryTimer: NodeJS.Timeout | null = null
  private stateSaveTimer: NodeJS.Timeout | null = null
  private suppressBlurHideUntil = 0
  private suppressActivationRoutingUntil = 0
  private pendingBlurHideAfterSuppression = false
  private lastToggleAt = 0
  private hasBeenShown = false
  private deferShadowShow = false
  private deps: MainWindowDeps | null = null
  private quitting = false
  private appBlurListenerInstalled = false
  private readonly handleAppBlur = (): void => {
    this.notifySurfaceBlur()
  }

  getWindow(): BrowserWindow | null {
    return this.window
  }

  setDeps(deps: MainWindowDeps): void {
    this.deps = deps
  }

  // ── Timer management (L2: centralised) ─────────────────────────

  private clearBlurHideTimer(): void {
    if (!this.blurHideTimer) return
    clearTimeout(this.blurHideTimer)
    this.blurHideTimer = null
  }

  private clearBlurSuppressionFlushTimer(): void {
    if (!this.blurSuppressionFlushTimer) return
    clearTimeout(this.blurSuppressionFlushTimer)
    this.blurSuppressionFlushTimer = null
  }

  private clearPostShowFocusRetryTimer(): void {
    if (!this.postShowFocusRetryTimer) return
    clearTimeout(this.postShowFocusRetryTimer)
    this.postShowFocusRetryTimer = null
  }

  private clearStateSaveTimer(): void {
    if (!this.stateSaveTimer) return
    clearTimeout(this.stateSaveTimer)
    this.stateSaveTimer = null
  }

  private shouldSuppressBlurHide(): boolean {
    return Date.now() < this.suppressBlurHideUntil
  }

  private extendBlurHideSuppression(durationMs: number): void {
    this.suppressBlurHideUntil = Math.max(this.suppressBlurHideUntil, Date.now() + durationMs)
  }

  private getBlurSuppressionFlushDelay(): number {
    const suppressionDelay = Math.max(0, this.suppressBlurHideUntil - Date.now())
    const ignoringBlurDelay = isIgnoringBlur() ? 120 : 0
    return Math.max(MW_BLUR_HIDE_DELAY_MS, suppressionDelay + MW_BLUR_HIDE_DELAY_MS, ignoringBlurDelay)
  }

  suppressActivationRouting(durationMs: number): void {
    const until = Date.now() + Math.max(0, durationMs)
    this.suppressActivationRoutingUntil = Math.max(this.suppressActivationRoutingUntil, until)
  }

  shouldSuppressActivationRouting(): boolean {
    return Date.now() < this.suppressActivationRoutingUntil
  }

  private hasDetachedAppSurface(): boolean {
    return (this.deps?.pluginWindowManager.getAllDetachedWindows().length ?? 0) > 0
      || Boolean(this.deps?.systemPageWindowManager.getDetachedWindow())
  }

  private isMainSurfaceFocused(): boolean {
    if (this.window && !this.window.isDestroyed() && this.window.isFocused()) return true
    const panelWin = this.deps?.pluginWindowManager.getPanelWindow()?.getWindow()
    if (panelWin && !panelWin.isDestroyed() && panelWin.isFocused()) return true
    const systemPageAttached = this.deps?.systemPageWindowManager.getAttachedWindow()
    if (systemPageAttached && !systemPageAttached.isDestroyed() && systemPageAttached.isFocused()) return true
    return false
  }

  private isMainSurfaceVisible(): boolean {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) return true
    const panelWin = this.deps?.pluginWindowManager.getPanelWindow()?.getWindow()
    if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) return true
    const systemPageAttached = this.deps?.systemPageWindowManager.getAttachedWindow()
    if (systemPageAttached && !systemPageAttached.isDestroyed() && systemPageAttached.isVisible()) return true
    return false
  }

  /**
   * 统一的失焦隐藏入口。主窗口自身、附着插件面板、系统页附着窗口的 blur，以及
   * 应用级 browser-window-blur 兜底，全部汇聚到这里，用同一套 isMainSurfaceFocused
   * 判定 + 抑制期 defer。取代以往三个窗口各自 setTimeout + 局部焦点判断的做法，
   * 避免「判断口径不一致」「忽略期直接丢弃 blur」导致点击别处有时不隐藏。
   */
  notifySurfaceBlur(): void {
    if (isIgnoringBlur() || this.shouldSuppressBlurHide()) {
      this.deferBlurHideUntilSuppressionEnds()
      return
    }
    this.scheduleBlurHideCheck()
  }

  private hideIfMainSurfaceUnfocused(): void {
    if (isIgnoringBlur() || this.shouldSuppressBlurHide()) {
      this.deferBlurHideUntilSuppressionEnds()
      return
    }
    // 没有任何主表面可见时无需隐藏——避免被无关窗口（如独立插件窗）的 blur 触发空转。
    if (!this.isMainSurfaceVisible()) return
    if (this.isMainSurfaceFocused()) return
    this.hide()
  }

  /**
   * 应用级失焦兜底：任意 Mulby 窗口 blur 时统一走 notifySurfaceBlur。
   * 主要补上「附着面板 / 系统页失焦」原本各自处理、判断口径不一的缺口。
   * 仅注册一次；handler 内部经 isMainSurfaceVisible/Focused 自行判定，无副作用。
   */
  private installAppBlurWatchdog(): void {
    if (this.appBlurListenerInstalled) return
    this.appBlurListenerInstalled = true
    app.on('browser-window-blur', this.handleAppBlur)
  }

  private scheduleBlurHideCheck(): void {
    this.clearBlurHideTimer()
    this.blurHideTimer = setTimeout(() => {
      this.blurHideTimer = null
      this.hideIfMainSurfaceUnfocused()
    }, MW_BLUR_HIDE_DELAY_MS)
  }

  private deferBlurHideUntilSuppressionEnds(): void {
    this.pendingBlurHideAfterSuppression = true
    this.clearBlurSuppressionFlushTimer()
    this.blurSuppressionFlushTimer = setTimeout(() => {
      this.blurSuppressionFlushTimer = null
      if (isIgnoringBlur() || this.shouldSuppressBlurHide()) {
        this.deferBlurHideUntilSuppressionEnds()
        return
      }
      if (!this.pendingBlurHideAfterSuppression) return
      this.pendingBlurHideAfterSuppression = false
      this.scheduleBlurHideCheck()
    }, this.getBlurSuppressionFlushDelay())
  }

  /**
   * Windows 强制前台。响应全局快捷键唤醒时，后台进程的 win.show()/win.focus()
   * 会被系统 SetForegroundWindow 前台锁拒绝——窗口浮在最上但键盘焦点仍留在
   * 上一个程序，且因主窗口从未真正聚焦，点击别处也不会触发 blur 隐藏。
   * 这里复用经实战与单测验证的 AttachThreadInput 方案强制夺取前台焦点。
   */
  private forceWindowsForeground(): void {
    if (process.platform !== 'win32') return
    if (!isWindowAvailable(this.window)) return
    try {
      // Electron 的 getNativeWindowHandle() 返回 Buffer；koffi 的 void* 需要 HWND 的
      // 「地址数值」。直接传 Buffer 会被当成「指向 Buffer 的指针」→ IsWindow() 失败 →
      // 整个夺取前台静默空转。必须先转成 bigint 地址（与 windows-input-target-window 同口径）。
      const handle = normalizeWindowsNativeWindowHandle(this.window.getNativeWindowHandle())
      if (!handle) {
        log.warn('[MainWindow] win32 foreground: could not resolve native window handle')
        return
      }
      const ok = restoreWin32ForegroundWindow(handle)
      if (!ok) log.warn('[MainWindow] win32 foreground: SetForegroundWindow chain failed')
    } catch (error) {
      log.warn('[MainWindow] win32 force foreground failed:', error)
    }
  }

  private schedulePostShowFocusRetry(): void {
    this.clearPostShowFocusRetryTimer()
    this.postShowFocusRetryTimer = setTimeout(() => {
      this.postShowFocusRetryTimer = null
      if (!isWindowAvailable(this.window) || !this.window.isVisible()) return
      if (this.isMainSurfaceFocused()) return

      try {
        if (this.window.isMinimized()) this.window.restore()
        this.window.show()
        this.window.focus()
        this.window.webContents.focus()
        this.forceWindowsForeground()
      } catch (error) {
        log.warn('[MainWindow] Failed to retry focus after show:', error)
        return
      }

      this.postShowFocusRetryTimer = setTimeout(() => {
        this.postShowFocusRetryTimer = null
        if (!isWindowAvailable(this.window) || !this.window.isVisible()) return
        if (this.isMainSurfaceFocused()) return
        log.warn('[MainWindow] Main window is visible but not focused after show retry')
      }, MW_POST_SHOW_FOCUS_VERIFY_MS)
    }, MW_POST_SHOW_FOCUS_RETRY_MS)
  }

  // ── Persistence ────────────────────────────────────────────────

  private persistState(): void {
    if (!isWindowAvailable(this.window)) return

    const bounds = getMainWindowVisibleBounds(this.window.getBounds())
    if (bounds.height > MW_EXPANDED_HEIGHT_THRESHOLD) {
      appSettingsManager.updateSettings({
        window: { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y }
      })
    } else {
      appSettingsManager.updateSettings({
        window: { width: bounds.width, x: bounds.x, y: bounds.y }
      })
    }
  }

  private scheduleStateSave(): void {
    this.clearStateSaveTimer()
    this.stateSaveTimer = setTimeout(() => {
      this.stateSaveTimer = null
      this.persistState()
    }, MW_STATE_SAVE_DEBOUNCE_MS)
  }

  flushStateSave(): void {
    this.clearStateSaveTimer()
    this.persistState()
  }

  // ── Position helpers ───────────────────────────────────────────

  private getDefaultVisiblePosition(visibleBounds: Rectangle, display: Display): { x: number; y: number } {
    const { x: screenX, y: screenY, width: screenWidth, height: screenHeight } = display.workArea
    return {
      x: screenX + Math.round((screenWidth - visibleBounds.width) / 2),
      y: screenY + Math.round(screenHeight * MW_DEFAULT_Y_RATIO)
    }
  }

  private getCursorDisplay(): Display {
    const cursorPoint = screen.getCursorScreenPoint()
    return screen.getDisplayNearestPoint(cursorPoint)
  }

  private boundsIntersectWorkArea(bounds: Rectangle, workArea: Rectangle): boolean {
    return bounds.x < workArea.x + workArea.width
      && bounds.x + bounds.width > workArea.x
      && bounds.y < workArea.y + workArea.height
      && bounds.y + bounds.height > workArea.y
  }

  private clampVisibleBoundsToWorkArea(bounds: Rectangle, workArea: Rectangle): Rectangle {
    const maxX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width)
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height)
    return {
      ...bounds,
      x: Math.min(Math.max(bounds.x, workArea.x), maxX),
      y: Math.min(Math.max(bounds.y, workArea.y), maxY)
    }
  }

  private resolveVisibleBounds(currentVisibleBounds: Rectangle): Rectangle {
    const settings = appSettingsManager.getSettings()
    const cursorDisplay = this.getCursorDisplay()
    const defaultVisibleBounds = {
      ...currentVisibleBounds,
      ...this.getDefaultVisiblePosition(currentVisibleBounds, cursorDisplay)
    }

    if (settings.window?.x !== undefined && settings.window?.y !== undefined) {
      const savedVisibleBounds = {
        ...currentVisibleBounds,
        x: settings.window.x,
        y: settings.window.y
      }
      const savedDisplay = screen.getDisplayMatching(savedVisibleBounds)
      if (
        savedDisplay.id === cursorDisplay.id
        && this.boundsIntersectWorkArea(savedVisibleBounds, cursorDisplay.workArea)
      ) {
        return this.clampVisibleBoundsToWorkArea(savedVisibleBounds, cursorDisplay.workArea)
      }
    }

    return defaultVisibleBounds
  }

  // ── Shadow window ──────────────────────────────────────────────

  private shouldUseShadow(): boolean {
    return process.platform === 'linux'
  }

  private createShadow(): void {
    if (!this.shouldUseShadow()) return
    if (!isWindowAvailable(this.window)) return
    if (isWindowAvailable(this.shadowWindow)) return

    const shadow = new BrowserWindow({
      width: 1, height: 1, x: 0, y: 0,
      frame: false, show: false, transparent: true, hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, focusable: false,
      parent: this.window!,
      modal: false, skipTaskbar: true, backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })

    shadow.setIgnoreMouseEvents(true, { forward: true })
    void shadow.loadURL(SHADOW_DATA_URL)
    shadow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    shadow.on('closed', () => {
      if (this.shadowWindow && this.shadowWindow.id === shadow.id) {
        this.shadowWindow = null
      }
    })
    this.shadowWindow = shadow
  }

  private syncShadowBounds(): void {
    if (!this.shouldUseShadow()) return
    if (!isWindowAvailable(this.window) || !isWindowAvailable(this.shadowWindow)) return
    const bounds = this.window.getBounds()
    const m = MW_SHADOW_MARGIN
    this.shadowWindow.setBounds({
      x: bounds.x - m,
      y: bounds.y - m,
      width: Math.max(1, bounds.width + m * 2),
      height: Math.max(1, bounds.height + m * 2)
    })
  }

  private showShadow(): void {
    if (!this.shouldUseShadow() || this.deferShadowShow) return
    if (!isWindowAvailable(this.window)) return
    if (!isWindowAvailable(this.shadowWindow)) this.createShadow()
    if (!isWindowAvailable(this.shadowWindow)) return
    this.syncShadowBounds()
    this.shadowWindow!.showInactive()
  }

  private closeShadow(): void {
    if (isWindowAvailable(this.shadowWindow)) {
      this.shadowWindow.close()
    }
    this.shadowWindow = null
  }

  // ── Windows context-menu suppression ───────────────────────────

  private suppressSystemContextMenu(win: BrowserWindow): void {
    if (process.platform !== 'win32') return
    win.on('system-context-menu', (event) => { event.preventDefault() })
    try {
      if (!win.isWindowMessageHooked(WINDOWS_WM_INITMENU)) {
        win.hookWindowMessage(WINDOWS_WM_INITMENU, () => {
          if (!win.isDestroyed()) {
            win.setEnabled(false)
            win.setEnabled(true)
          }
        })
      }
    } catch (error) {
      log.warn('[MainWindow] Failed to hook WM_INITMENU:', error)
    }
    win.once('closed', () => {
      try {
        if (!win.isDestroyed() && win.isWindowMessageHooked(WINDOWS_WM_INITMENU)) {
          win.unhookWindowMessage(WINDOWS_WM_INITMENU)
        }
      } catch { /* ignore */ }
    })
  }

  // ── Core lifecycle ─────────────────────────────────────────────

  create(): void {
    const settings = appSettingsManager.getSettings()
    const visibleWidth = settings.window?.width || MW_DEFAULT_WIDTH
    const initialVisibleBounds = this.resolveVisibleBounds({
      x: 0, y: 0, width: visibleWidth, height: MW_MIN_COLLAPSED_HEIGHT
    })
    const initialWindowBounds = getMainWindowWindowBounds(initialVisibleBounds)
    const minCollapsedSize = getMainWindowWindowSize(MW_MIN_COLLAPSED_WIDTH, MW_MIN_COLLAPSED_HEIGHT)

    const win = new BrowserWindow({
      width: initialWindowBounds.width,
      height: initialWindowBounds.height,
      x: initialWindowBounds.x,
      y: initialWindowBounds.y,
      show: false, frame: false, resizable: true,
      minHeight: minCollapsedSize.height,
      maxHeight: minCollapsedSize.height,
      minWidth: minCollapsedSize.width,
      skipTaskbar: true, transparent: true, hasShadow: false,
      type: 'panel',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        // Keep throttling disabled for the translucent macOS launcher window.
        // Chromium can misclassify this panel as occluded/backgrounded, which
        // makes search updates keep running in JS while the UI stops repainting.
        backgroundThrottling: false
      }
    })

    this.window = win
    registerAppWindow(win.id)
    this.installAppBlurWatchdog()

    if (process.platform === 'darwin') {
      win.setFullScreenable(false)
      // Keep the global launcher summonable from every Space without letting
      // Electron transform the process type and briefly expose a Dock icon.
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
      win.setHiddenInMissionControl(true)
      win.setAlwaysOnTop(true, 'floating')
    } else {
      win.setAlwaysOnTop(true)
    }

    if (this.shouldUseShadow()) this.createShadow()

    this.suppressSystemContextMenu(win)
    attachShortcutRecordingGuard(win)

    win.on('closed', () => {
      this.clearBlurHideTimer()
      this.clearBlurSuppressionFlushTimer()
      this.clearPostShowFocusRetryTimer()
      this.clearStateSaveTimer()
      this.closeShadow()
      this.pendingBlurHideAfterSuppression = false
      this.window = null
    })

    win.on('close', (event) => {
      this.flushStateSave()
      const closeToTray = appSettingsManager.getSettings().tray.closeToTray
      if (!shouldPreventMainWindowClose({ closeToTray, isQuitting: this.quitting })) return
      event.preventDefault()
      this.hide()
    })

    win.on('blur', () => {
      if (isIgnoringBlur() || this.shouldSuppressBlurHide()) {
        this.deferBlurHideUntilSuppressionEnds()
        return
      }
      this.scheduleBlurHideCheck()
    })

    win.on('focus', () => {
      this.clearBlurHideTimer()
    })

    // State save on resize/move (L2: unified timer)
    const saveOnResize = () => { this.scheduleStateSave() }
    win.on('resize', saveOnResize)
    win.on('move', () => this.scheduleStateSave())
    win.on('resize', () => this.syncShadowBounds())
    win.on('show', () => this.showShadow())
    win.on('hide', () => {
      this.flushStateSave()
      if (process.platform === 'darwin') {
        try {
          win.setOpacity(0)
        } catch (error) {
          log.warn('[MainWindow] Failed to apply macOS Space opacity guard:', error)
        }
        this.deps?.pluginWindowManager.hidePanelWindow()
        this.deps?.systemPageWindowManager.hideAttached()
      }
      if (isWindowAvailable(this.shadowWindow)) this.shadowWindow.hide()
    })

    const loadApp = async () => {
      if (process.env.VITE_DEV_SERVER_URL) {
        if (await canReachUrl(process.env.VITE_DEV_SERVER_URL)) {
          await win.loadURL(process.env.VITE_DEV_SERVER_URL)
          return
        }
        log.warn(`[MainWindow] Dev server not reachable at ${process.env.VITE_DEV_SERVER_URL}, falling back to local file.`)
      }
      const isDevEnv = !app.isPackaged || process.env.NODE_ENV === 'development' || !process.env.NODE_ENV
      if (isDevEnv) {
        const devUrl = 'http://localhost:5173'
        if (await canReachUrl(devUrl)) {
          await win.loadURL(devUrl)
          return
        }
      }
      await win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    void loadApp().catch((e) => {
      log.error('[MainWindow] Failed to load app:', e)
    })
  }

  show(options?: { skipAutoPaste?: boolean }): void {
    if (!isWindowAvailable(this.window)) return
    this.clearBlurHideTimer()
    this.clearBlurSuppressionFlushTimer()
    this.clearPostShowFocusRetryTimer()
    this.pendingBlurHideAfterSuppression = false
    this.deps?.getTrayMenuManager()?.hide()
    const hasDetachedAppSurface = this.hasDetachedAppSurface()
    if (process.platform === 'darwin' && hasDetachedAppSurface) {
      this.suppressActivationRouting(MW_MAC_STAGE_MANAGER_ACTIVATION_SETTLE_MS)
    }

    // Only activate the app when it was explicitly hidden (via app.hide()).
    // Unconditional app.show() / app.focus({ steal: true }) triggers macOS
    // Stage Manager to minimize the previously focused app's windows.
    const needsAppReactivation = process.platform === 'darwin' && isAppExplicitlyHidden()

    if (needsAppReactivation) {
      try { app.show() } catch (error) {
        log.warn('[MainWindow] app.show() failed:', error)
      }
      markAppVisible()
    }

    if (process.platform === 'darwin') {
      try {
        this.window.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true
        })
        this.window.setHiddenInMissionControl(true)
        this.window.setAlwaysOnTop(true, 'floating')
        this.window.setOpacity(1)
      } catch (e) {
        log.error('[MainWindow] Error setting window properties:', e)
      }
    } else {
      this.window.setAlwaysOnTop(true)
    }

    try {
      if (process.platform === 'win32') {
        refreshActiveWindowCache()
      }

      const visibleBounds = getMainWindowVisibleBounds(this.window.getBounds())
      const targetVisibleBounds = this.resolveVisibleBounds(visibleBounds)
      const windowBounds = getMainWindowWindowBounds(targetVisibleBounds)
      this.window.setPosition(windowBounds.x, windowBounds.y)

      startIgnoringBlur()
      this.extendBlurHideSuppression(
        process.platform === 'darwin' && hasDetachedAppSurface
          ? MW_SHOW_WITH_DETACHED_BLUR_GUARD_MS
          : MW_SHOW_BLUR_GUARD_MS
      )

      const needsOpacityGuard = process.platform === 'win32' && this.hasBeenShown
      if (needsOpacityGuard) {
        this.deferShadowShow = true
        this.window.setOpacity(0)
      }

      this.window.show()
      this.window.focus()
      this.hasBeenShown = true

      if (needsAppReactivation && !(process.platform === 'darwin' && hasDetachedAppSurface)) {
        try { app.focus({ steal: true }) } catch (error) {
          log.warn('[MainWindow] app.focus() failed:', error)
        }
      }

      // Windows: 真正夺取前台键盘焦点（win.focus() 不足以越过前台锁）。
      this.forceWindowsForeground()

      if (process.platform !== 'win32') {
        refreshActiveWindowCache()
      }

      if (needsOpacityGuard) {
        this.window.webContents.invalidate()
        setTimeout(() => {
          this.deferShadowShow = false
          if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
            this.window.setOpacity(1)
            this.showShadow()
            // 透明层恢复后再夺一次前台：覆盖「opacity 0 期间夺取被系统忽略」的二次唤醒场景。
            this.forceWindowsForeground()
          }
        }, MW_OPACITY_RESTORE_DELAY_MS)
      }

      this.deps?.pluginWindowManager.showPanelWindow()
      this.deps?.systemPageWindowManager.showAttached()

      const skipAutoPaste = options?.skipAutoPaste
        || (Date.now() - (this.deps?.getLastDeepLinkTime() ?? 0) < 1000)
      let autoPastePayload: ReturnType<typeof captureAutoPasteClipboardPayload> | null = null
      if (!skipAutoPaste) {
        const appSettings = appSettingsManager.getSettings()
        if (appSettings.input.autoPasteOnShow
            && this.deps?.clipboardWatcher.isRecentlyChanged(appSettings.input.autoPasteMaxAge)) {
          autoPastePayload = captureAutoPasteClipboardPayload()
        }
      }
      const shouldAutoPaste = Boolean(
        autoPastePayload && (
          (autoPastePayload.format === 'text' && autoPastePayload.text?.trim()) ||
          (autoPastePayload.format === 'image' && autoPastePayload.image) ||
          (autoPastePayload.format === 'files' && autoPastePayload.files && autoPastePayload.files.length > 0)
        )
      )

      this.window.webContents.send('app:mainWindowShow', {
        autoPasteScheduled: shouldAutoPaste
      })
      this.schedulePostShowFocusRetry()

      if (shouldAutoPaste && autoPastePayload) {
        this.window.webContents.send('clipboard:autoPaste', autoPastePayload)
      }

      stopIgnoringBlur()
      this.scheduleMacDockPresentationRefresh()

    } catch (e) {
      stopIgnoringBlur()
      log.error('[MainWindow] Error in show sequence:', e)
    }
  }

  hide(): void {
    if (!isWindowAvailable(this.window)) {
      this.clearBlurHideTimer()
      this.clearBlurSuppressionFlushTimer()
      this.clearPostShowFocusRetryTimer()
      this.closeShadow()
      this.pendingBlurHideAfterSuppression = false
      this.window = null
      return
    }

    this.clearBlurHideTimer()
    this.clearBlurSuppressionFlushTimer()
    this.clearPostShowFocusRetryTimer()
    this.pendingBlurHideAfterSuppression = false
    this.deps?.getTrayMenuManager()?.hide()
    this.deps?.pluginWindowManager.hidePanelWindow()
    this.deps?.systemPageWindowManager.hideAttached()
    this.window.hide()
    this.shadowWindow?.hide()
    this.scheduleMacDockPresentationRefresh()

  }

  private scheduleMacDockPresentationRefresh(): void {
    if (process.platform !== 'darwin') return
    setImmediate(() => this.deps?.refreshMacDockPresentation?.())
    setTimeout(() => this.deps?.refreshMacDockPresentation?.(), 50)
  }

  toggle(): void {
    if (!isWindowAvailable(this.window)) return
    const now = Date.now()
    if (now - this.lastToggleAt < MW_TOGGLE_DEBOUNCE_MS) return
    this.lastToggleAt = now
    if (shouldHideMainWindowOnToggle({
      isWindowVisible: this.window.isVisible(),
      isMainSurfaceFocused: this.isMainSurfaceFocused(),
      isAppFocused: process.platform === 'darwin' ? BrowserWindow.getFocusedWindow() !== null : true,
      windowOpacity: process.platform === 'darwin' ? this.window.getOpacity() : 1
    })) {
      this.hide()
    } else {
      this.show()
    }
  }

  resetPosition(): void {
    const settings = appSettingsManager.getSettings()
    appSettingsManager.updateSettings({
      window: { ...(settings.window || { width: MW_DEFAULT_WIDTH }), x: undefined, y: undefined }
    })
  }

  /** Allow external code to suppress blur-hide (e.g. during close-to-tray check) */
  setQuitting(quitting: boolean): void {
    this.quitting = quitting
  }
}
