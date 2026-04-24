import { BrowserWindow, app, screen, type Rectangle } from 'electron'
import http from 'http'
import https from 'https'
import { join } from 'path'
import log from 'electron-log'
import { appSettingsManager } from './services/app-settings'
import { isIgnoringBlur, startIgnoringBlur, stopIgnoringBlur } from './services/blur-manager'
import { attachShortcutRecordingGuard } from './services/shortcut-recording-guard'
import { refreshActiveWindowCache } from './services/active-window'
import { registerAppWindow } from './services/ipc-caller-resolver'
import {
  getMainWindowVisibleBounds,
  getMainWindowWindowBounds,
  getMainWindowWindowSize
} from './main-window-frame'

// ── Constants (L5: extracted magic numbers) ────────────────────────────
export const MW_SHADOW_MARGIN = 12
export const MW_TOGGLE_DEBOUNCE_MS = 180
export const MW_SHOW_BLUR_GUARD_MS = 260
export const MW_STATE_SAVE_DEBOUNCE_MS = 500
export const MW_BLUR_HIDE_DELAY_MS = 50
export const MW_MIN_COLLAPSED_WIDTH = 400
export const MW_MIN_COLLAPSED_HEIGHT = 62
export const MW_DEFAULT_WIDTH = 800
export const MW_EXPANDED_HEIGHT_THRESHOLD = 100
export const MW_DEFAULT_Y_RATIO = 1 / 5
export const MW_OPACITY_RESTORE_DELAY_MS = 50

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
        0 2px 10px rgba(15, 23, 42, 0.12),
        0 1px 2px rgba(15, 23, 42, 0.08);
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
  private stateSaveTimer: NodeJS.Timeout | null = null
  private suppressBlurHideUntil = 0
  private lastToggleAt = 0
  private hasBeenShown = false
  private deferShadowShow = false
  private deps: MainWindowDeps | null = null

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

  private getDefaultVisiblePosition(visibleBounds: Rectangle): { x: number; y: number } {
    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const { width: screenWidth, height: screenHeight } = display.workAreaSize
    const { x: screenX, y: screenY } = display.workArea
    return {
      x: screenX + Math.round((screenWidth - visibleBounds.width) / 2),
      y: screenY + Math.round(screenHeight * MW_DEFAULT_Y_RATIO)
    }
  }

  private resolveVisibleBounds(currentVisibleBounds: Rectangle): Rectangle {
    const settings = appSettingsManager.getSettings()
    if (settings.window?.x !== undefined && settings.window?.y !== undefined) {
      return { ...currentVisibleBounds, x: settings.window.x, y: settings.window.y }
    }
    return { ...currentVisibleBounds, ...this.getDefaultVisiblePosition(currentVisibleBounds) }
  }

  // ── Shadow window ──────────────────────────────────────────────

  private shouldUseShadow(): boolean {
    return process.platform !== 'win32'
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
        webviewTag: true
      }
    })

    this.window = win
    registerAppWindow(win.id)

    if (process.platform === 'darwin') {
      win.setFullScreenable(false)
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setAlwaysOnTop(true, 'floating')
    } else {
      win.setAlwaysOnTop(true)
    }

    if (this.shouldUseShadow()) this.createShadow()

    this.suppressSystemContextMenu(win)
    attachShortcutRecordingGuard(win)

    win.on('closed', () => {
      this.clearBlurHideTimer()
      this.clearStateSaveTimer()
      this.closeShadow()
      this.window = null
    })

    win.on('close', (event) => {
      this.flushStateSave()
      const closeToTray = appSettingsManager.getSettings().tray.closeToTray
      if (!closeToTray) return
      event.preventDefault()
      this.hide()
    })

    win.on('blur', () => {
      if (isIgnoringBlur() || this.shouldSuppressBlurHide()) return
      this.clearBlurHideTimer()
      this.blurHideTimer = setTimeout(() => {
        this.blurHideTimer = null
        if (isIgnoringBlur() || this.shouldSuppressBlurHide()) return
        const panelWin = this.deps?.pluginWindowManager.getPanelWindow()?.getWindow()
        if (panelWin && panelWin.isFocused()) return
        const systemPageAttached = this.deps?.systemPageWindowManager.getAttachedWindow()
        if (systemPageAttached && systemPageAttached.isFocused()) return
        this.hide()
      }, MW_BLUR_HIDE_DELAY_MS)
    })

    // State save on resize/move (L2: unified timer)
    const saveOnResize = () => { this.scheduleStateSave() }
    win.on('resize', saveOnResize)
    win.on('move', () => this.scheduleStateSave())
    win.on('resize', () => this.syncShadowBounds())
    win.on('show', () => this.showShadow())
    win.on('hide', () => {
      this.flushStateSave()
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
    this.deps?.getTrayMenuManager()?.hide()

    if (process.platform === 'darwin') {
      try { app.show() } catch (error) {
        log.warn('[MainWindow] app.show() failed:', error)
      }
    }

    if (process.platform === 'darwin') {
      try {
        this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        this.window.setAlwaysOnTop(true, 'floating')
        const hasDetached = (this.deps?.pluginWindowManager.getAllDetachedWindows().length ?? 0) > 0
          || Boolean(this.deps?.systemPageWindowManager.getDetachedWindow())
        if (hasDetached && app.dock) {
          void app.dock.show()
        }
      } catch (e) {
        log.error('[MainWindow] Error setting window properties:', e)
      }
    } else {
      this.window.setAlwaysOnTop(true)
    }

    try {
      const visibleBounds = getMainWindowVisibleBounds(this.window.getBounds())
      const targetVisibleBounds = this.resolveVisibleBounds(visibleBounds)
      const windowBounds = getMainWindowWindowBounds(targetVisibleBounds)
      this.window.setPosition(windowBounds.x, windowBounds.y)

      startIgnoringBlur()
      this.extendBlurHideSuppression(MW_SHOW_BLUR_GUARD_MS)

      const needsOpacityGuard = process.platform === 'win32' && this.hasBeenShown
      if (needsOpacityGuard) {
        this.deferShadowShow = true
        this.window.setOpacity(0)
      }

      this.window.show()
      this.window.focus()
      this.hasBeenShown = true

      if (process.platform === 'darwin') {
        try { app.focus({ steal: true }) } catch (error) {
          log.warn('[MainWindow] app.focus({ steal: true }) failed:', error)
        }
      }

      refreshActiveWindowCache()

      if (needsOpacityGuard) {
        this.window.webContents.invalidate()
        setTimeout(() => {
          this.deferShadowShow = false
          if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
            this.window.setOpacity(1)
            this.showShadow()
          }
        }, MW_OPACITY_RESTORE_DELAY_MS)
      }

      this.deps?.pluginWindowManager.showPanelWindow()
      this.deps?.systemPageWindowManager.showAttached()

      const skipAutoPaste = options?.skipAutoPaste
        || (Date.now() - (this.deps?.getLastDeepLinkTime() ?? 0) < 1000)
      if (!skipAutoPaste) {
        const appSettings = appSettingsManager.getSettings()
        if (appSettings.input.autoPasteOnShow
            && this.deps?.clipboardWatcher.isRecentlyChanged(appSettings.input.autoPasteMaxAge)) {
          this.window.webContents.send('clipboard:autoPaste')
        }
      }

      stopIgnoringBlur()

      if (process.platform === 'darwin' && app.dock) {
        const hasDetached = (this.deps?.pluginWindowManager.getAllDetachedWindows().length ?? 0) > 0
          || Boolean(this.deps?.systemPageWindowManager.getDetachedWindow())
        if (hasDetached) {
          setImmediate(() => { if (app.dock) void app.dock.show() })
        }
      }
    } catch (e) {
      stopIgnoringBlur()
      log.error('[MainWindow] Error in show sequence:', e)
    }
  }

  hide(): void {
    if (!isWindowAvailable(this.window)) {
      this.clearBlurHideTimer()
      this.closeShadow()
      this.window = null
      return
    }

    this.clearBlurHideTimer()
    this.deps?.getTrayMenuManager()?.hide()
    this.deps?.pluginWindowManager.hidePanelWindow()
    this.deps?.systemPageWindowManager.hideAttached()
    this.window.hide()
    this.shadowWindow?.hide()

    if (process.platform === 'darwin' && app.dock) {
      const hasDetached = (this.deps?.pluginWindowManager.getAllDetachedWindows().length ?? 0) > 0
        || Boolean(this.deps?.systemPageWindowManager.getDetachedWindow())
      if (hasDetached) {
        void app.dock.show()
      }
    }
  }

  toggle(): void {
    if (!isWindowAvailable(this.window)) return
    const now = Date.now()
    if (now - this.lastToggleAt < MW_TOGGLE_DEBOUNCE_MS) return
    this.lastToggleAt = now
    if (this.window.isVisible()) {
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
    if (quitting) {
      // Disable the close-event prevention when actually quitting
      this.window?.removeAllListeners('close')
    }
  }
}
