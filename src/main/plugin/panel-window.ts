import { BrowserWindow, screen, WebContentsView } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { InputAttachment, InputPayload, Plugin, WindowOptions } from '../../shared/types/plugin'
import { ThemeManager } from '../services/theme'
import { loggerService } from '../services/logger'
import { appSettingsManager } from '../services/app-settings'
import { installConsoleCaptureForWebContents } from './console-capture'
import { isIgnoringBlur, startIgnoringBlur, stopIgnoringBlur } from '../services/blur-manager'
import { getPluginPreloadPath } from './plugin-preload-wrapper'
import {
    PLUGIN_RENDERER_V8_CACHE_OPTIONS,
    getPluginRendererCapabilities,
    getPluginRendererWebPreferences,
    installPluginWebviewSecurity
} from './plugin-web-preferences'
import { ATTACHED_PANEL_HEIGHT, ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT } from '../constants/panel-window'
import {
    applyWindowsFramelessSurface,
    applyWindowsFramelessSurfaceToWebContents,
    getWindowsFramelessSurfaceInsets,
    getWindowsFramelessSurfaceVisibleBounds,
    getWindowsFramelessSurfaceWindowBounds,
    shouldUseWindowsFramelessSurface
} from '../services/window-surface'
import {
    MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT,
    getMainWindowVisibleBounds,
    getMainWindowWindowSize
} from '../main-window-frame'
import { registerView, unregisterView } from '../services/webcontents-registry'
import { registerPanelWindow, unregisterPanelWindow, registerPluginWindow, unregisterPluginWindow } from '../services/ipc-caller-resolver'
import { resolvePluginWindowIcon } from '../services/window-icon'
import { registerWindowsInputTargetWindow, unregisterWindowsInputTargetWindow } from '../services/windows-input-target-window'
import {
    DETACHED_TITLEBAR_HEIGHT,
    setupTitlebarIPC,
    initTitlebar,
    notifyTitlebarThemeChange,
    layoutPluginView
} from './titlebar-view'
import { formatPayloadTrace } from '../../shared/attachment-trace'
import log from 'electron-log'

const ATTACHED_PANEL_SHADOW_MARGIN = 12
const WINDOWS_PANEL_SHOW_OPACITY_GUARD_MS = 50
const ATTACHED_PANEL_SHADOW_SHOW_DELAY_MS = 600
const ATTACHED_PANEL_SHELL_HTML = `<!doctype html>
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
    }
  </style>
</head>
<body></body>
</html>`
const ATTACHED_PANEL_SHELL_URL = `data:text/html;charset=UTF-8,${encodeURIComponent(ATTACHED_PANEL_SHELL_HTML)}`
const ATTACHED_PANEL_SHADOW_HTML = `<!doctype html>
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
      inset: ${ATTACHED_PANEL_SHADOW_MARGIN}px;
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
const ATTACHED_PANEL_SHADOW_URL = `data:text/html;charset=UTF-8,${encodeURIComponent(ATTACHED_PANEL_SHADOW_HTML)}`

function areBoundsEqual(
    left: { x: number; y: number; width: number; height: number },
    right: { x: number; y: number; width: number; height: number }
): boolean {
    return left.x === right.x
        && left.y === right.y
        && left.width === right.width
        && left.height === right.height
}

function normalizePanelRoute(route?: string | null): string {
    return (route || '')
        .trim()
        .replace(/^#/, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
}

function getPanelRouteHash(route?: string): string | undefined {
    const normalized = normalizePanelRoute(route)
    return normalized ? `/${normalized}` : undefined
}

export interface PromotedPanelWindow {
    window: BrowserWindow
    pluginView?: WebContentsView
}

/**
 * 插件面板窗口管理器
 * 负责创建和管理跟随主窗口的面板式插件窗口
 */
export class PluginPanelWindow {
    private panelWindow: BrowserWindow | null = null
    private pluginView: WebContentsView | null = null
    private shadowWindow: BrowserWindow | null = null
    private mainWindow: BrowserWindow
    private themeManager: ThemeManager | null = null
    private currentPlugin: Plugin | null = null
    private currentFeatureCode: string = ''
    private currentInput: string = ''
    private currentAttachments: InputAttachment[] = []
    private currentRoute: string | undefined

    // 位置同步相关
    private moveHandler: (() => void) | null = null
    private resizeHandler: (() => void) | null = null
    private syncScheduled = false
    private preferredPanelHeight = ATTACHED_PANEL_HEIGHT
    private syncingBounds = false
    private panelWindowHasBeenShown = false
    private opacityRestoreTimer: NodeJS.Timeout | null = null
    private suspendedForResident = false

    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow
    }

    private shouldOpenPluginDevTools(): boolean {
        const developer = appSettingsManager.getSettings().developer
        return developer.enabled && developer.showDevTools === true
    }

    private openPluginDevTools(webContents: Electron.WebContents, pluginId: string): void {
        if (!this.shouldOpenPluginDevTools()) return
        if (webContents.isDestroyed() || webContents.isDevToolsOpened()) return

        try {
            webContents.openDevTools({ mode: 'detach' })
        } catch (err) {
            log.warn(`[PanelWindow] Failed to open DevTools for ${pluginId}:`, err)
        }
    }

    private shouldUseShadowWindow() {
        return process.platform !== 'win32'
    }

    setThemeManager(manager: ThemeManager) {
        this.themeManager = manager
    }

    prewarmShell() {
        if (this.mainWindow.isDestroyed()) return
        if (this.panelWindow && !this.panelWindow.isDestroyed()) return

        const { x, y, width } = this.calculatePanelBounds()
        const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
        const initialBounds = getWindowsFramelessSurfaceWindowBounds({
            x,
            y,
            width,
            height: ATTACHED_PANEL_HEIGHT
        })
        const currentTheme = this.themeManager?.getActualTheme() || 'dark'
        const backgroundColor = useWindowsFramelessSurface ? '#00000000' : (currentTheme === 'dark' ? '#1e293b' : '#ffffff')

        this.ensurePanelShell(initialBounds, backgroundColor, useWindowsFramelessSurface)
        log.info('[PanelShell] prewarm ready')
    }

    private getPluginWebContents(): Electron.WebContents | null {
        if (!this.pluginView || this.pluginView.webContents.isDestroyed()) return null
        return this.pluginView.webContents
    }

    private layoutAttachedPluginView() {
        if (!this.panelWindow || this.panelWindow.isDestroyed()) return
        if (!this.pluginView || this.pluginView.webContents.isDestroyed()) return

        const [contentWidth, contentHeight] = this.panelWindow.getContentSize()
        this.pluginView.setBounds({
            x: 0,
            y: 0,
            width: Math.max(1, contentWidth),
            height: Math.max(1, contentHeight)
        })
    }

    private collapseMainWindowForAttachedPanel() {
        if (this.mainWindow.isDestroyed()) return

        const visibleBounds = getMainWindowVisibleBounds(this.mainWindow.getBounds())
        if (visibleBounds.height === MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT) return

        const minSize = getMainWindowWindowSize(400, MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT)
        const maxSize = getMainWindowWindowSize(9999, MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT)
        const nextSize = getMainWindowWindowSize(visibleBounds.width, MAIN_WINDOW_COLLAPSED_VISIBLE_HEIGHT)

        this.mainWindow.setMinimumSize(minSize.width, minSize.height)
        this.mainWindow.setMaximumSize(maxSize.width, maxSize.height)
        this.mainWindow.setSize(nextSize.width, nextSize.height)

        setImmediate(() => {
            if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed() || !this.mainWindow.isVisible()) return
            this.mainWindow.webContents.invalidate()
        })
    }

    private destroyPluginView() {
        const view = this.pluginView
        if (!view) return

        this.pluginView = null
        unregisterView(view)

        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            try {
                this.panelWindow.contentView.removeChildView(view)
            } catch {
                // The view may already have been detached by Electron during teardown.
            }
        }

        if (!view.webContents.isDestroyed()) {
            view.webContents.close()
        }
    }

    private detachPluginViewForPromotion(): WebContentsView | null {
        const view = this.pluginView
        if (!view || view.webContents.isDestroyed()) return null

        this.pluginView = null
        unregisterView(view)

        if (this.panelWindow) {
            unregisterPanelWindow(this.panelWindow.id)
        }

        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            try {
                this.panelWindow.contentView.removeChildView(view)
            } catch {
                // The view may already be detached if Electron is tearing down the shell.
            }
            this.panelWindow.hide()
        }

        this.clearOpacityRestoreTimer(false)
        this.removePositionSync()
        this.closeShadowWindow()
        this.suspendedForResident = false
        return view
    }

    private resetCurrentPluginState() {
        this.currentPlugin = null
        this.currentFeatureCode = ''
        this.currentInput = ''
        this.currentAttachments = []
        this.currentRoute = undefined
        this.suspendedForResident = false
        this.syncScheduled = false
        this.preferredPanelHeight = ATTACHED_PANEL_HEIGHT
        this.syncingBounds = false
        this.panelWindowHasBeenShown = false
    }

    private clearCurrentPluginSession(resetPluginState = true) {
        this.clearOpacityRestoreTimer(false)
        this.destroyPluginView()

        if (this.panelWindow) {
            unregisterPanelWindow(this.panelWindow.id)
        }

        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            this.panelWindow.hide()
        }

        this.removePositionSync()
        this.closeShadowWindow()
        if (resetPluginState) {
            this.resetCurrentPluginState()
        }
    }

    private ensurePanelShell(
        initialBounds: { x: number; y: number; width: number; height: number },
        backgroundColor: string,
        useWindowsFramelessSurface: boolean
    ): BrowserWindow {
        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            this.panelWindow.setBounds(initialBounds)
            return this.panelWindow
        }

        const panelWindow = new BrowserWindow({
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
            parent: this.mainWindow,
            modal: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            backgroundColor,
            transparent: useWindowsFramelessSurface,
            hasShadow: false,
            roundedCorners: true,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                backgroundThrottling: false,
                v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
            }
        })

        void panelWindow.loadURL(ATTACHED_PANEL_SHELL_URL)

        panelWindow.on('focus', () => {
            // 面板获得焦点是正常的
        })

        panelWindow.on('resize', () => {
            if (this.syncingBounds || !this.panelWindow || this.panelWindow.isDestroyed()) return
            const nextHeight = getWindowsFramelessSurfaceVisibleBounds(this.panelWindow.getBounds()).height
            this.preferredPanelHeight = Math.max(ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT, nextHeight)
            this.layoutAttachedPluginView()
        })

        panelWindow.on('blur', () => {
            if (isIgnoringBlur()) return

            setTimeout(() => {
                if (this.mainWindow.isFocused()) {
                    return
                }
                if (this.panelWindow && !this.panelWindow.isDestroyed() && this.panelWindow.isFocused()) {
                    return
                }
                this.hide()
                this.mainWindow.hide()
            }, 50)
        })

        panelWindow.on('closed', () => {
            if (this.panelWindow === panelWindow) {
                this.cleanup()
            }
        })

        if (this.themeManager) {
            this.themeManager.registerWindow(panelWindow)
        }

        this.panelWindow = panelWindow
        return panelWindow
    }

    /**
     * 创建跟随搜索框的面板窗口
     */
    createPanel(
        plugin: Plugin,
        featureCode: string,
        input?: InputPayload,
        route?: string,
        launchStart?: number,
        onLoadReady?: Promise<unknown>,
        onPanelShown?: () => void
    ): BrowserWindow | null {
        if (!plugin.manifest.ui) return null

        const uiPath = join(plugin.path, plugin.manifest.ui)

        // 清理现有插件 view，但保留可复用 shell BrowserWindow。
        this.clearCurrentPluginSession()
        this.suspendedForResident = false

        // 存储当前插件信息
        this.currentPlugin = plugin
        this.currentFeatureCode = featureCode
        this.currentInput = input?.text || ''
        this.currentAttachments = input?.attachments || []
        this.currentRoute = route

        // 计算初始位置
        const { x, y, width } = this.calculatePanelBounds()
        const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
        const initialBounds = getWindowsFramelessSurfaceWindowBounds({
            x,
            y,
            width,
            height: ATTACHED_PANEL_HEIGHT
        })

        // 根据当前主题设置窗口背景色
        const currentTheme = this.themeManager?.getActualTheme() || 'dark'
        const isDark = currentTheme === 'dark'
        const backgroundColor = useWindowsFramelessSurface ? '#00000000' : (isDark ? '#1e293b' : '#ffffff')

        // 获取插件 preload 路径（支持自定义 preload）
        const basePreloadPath = join(__dirname, '../preload/index.js')
        const preloadPath = getPluginPreloadPath(basePreloadPath, plugin)
        const hasCustomPreload = !!plugin.manifest.preload

        this.preferredPanelHeight = ATTACHED_PANEL_HEIGHT
        const panelWindow = this.ensurePanelShell(initialBounds, backgroundColor, useWindowsFramelessSurface)

        const pluginView = new WebContentsView({
            webPreferences: {
                preload: preloadPath,
                additionalArguments: ['--mulby-plugin-window'],
                contextIsolation: !hasCustomPreload,
                nodeIntegration: hasCustomPreload,
                sandbox: !hasCustomPreload,
                backgroundThrottling: false,
                v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS,
                ...getPluginRendererWebPreferences(plugin)
            }
        })
        pluginView.setBackgroundColor('#00000000')

        this.pluginView = pluginView
        panelWindow.contentView.addChildView(pluginView)
        this.layoutAttachedPluginView()

        // 注册面板窗口到 IPC 调用方来源解析器
        registerPanelWindow(panelWindow.id, plugin.id)
        registerView(pluginView, panelWindow)

        // 设置位置同步监听器
        this.setupPositionSync()

        // 闭包捕获窗口实例和输入，防止 onLoadReady 等待期间新的 createPanel 覆盖状态
        const capturedWin = panelWindow
        const capturedView = pluginView
        const capturedWebContents = pluginView.webContents
        installPluginWebviewSecurity(capturedWebContents, plugin)
        const buildInitPayload = () => ({
            pluginName: plugin.id,
            featureCode: this.currentFeatureCode,
            input: this.currentInput,
            attachments: this.currentAttachments,
            mode: 'panel' as const,
            route: this.currentRoute,
            capabilities: getPluginRendererCapabilities(plugin)
        })

        let readyToShowInitSent = false
        let initialInitSent = false
        let panelShown = false

        const sendPluginInit = (reason: string): boolean => {
            if (capturedWin.isDestroyed() || capturedWebContents.isDestroyed()) return false
            if (this.panelWindow !== capturedWin || this.pluginView !== capturedView) return false
            capturedWebContents.send('plugin:init', { ...buildInitPayload(), nonce: Date.now() })
            readyToShowInitSent = true
            log.info(`[AttachmentTrace][Main] panel plugin:init sent | plugin=${plugin.id} | feature=${this.currentFeatureCode || ''} | route=${this.currentRoute || ''} | reason=${reason} | ${formatPayloadTrace({ text: this.currentInput, attachments: this.currentAttachments })}${launchStart ? ` | +${Date.now() - launchStart}ms` : ''}`)
            return true
        }

        const sendInitialPluginInit = (reason: string): void => {
            if (initialInitSent) return
            if (sendPluginInit(reason)) {
                initialInitSent = true
            }
        }

        const applyAttachedPanelSurface = async () => {
            if (!useWindowsFramelessSurface) return
            if (capturedWin.isDestroyed() || capturedWebContents.isDestroyed()) return
            if (this.panelWindow !== capturedWin || this.pluginView !== capturedView) return
            await applyWindowsFramelessSurface(capturedWin, { resizeMode: 'bottom', contentBackground: 'transparent' })
            if (capturedWin.isDestroyed() || capturedWebContents.isDestroyed()) return
            if (this.panelWindow !== capturedWin || this.pluginView !== capturedView) return
            await applyWindowsFramelessSurfaceToWebContents(capturedWebContents, { resizeMode: 'bottom' })
        }

        const showPanel = async (reason: string) => {
            if (panelShown) return
            panelShown = true
            if (capturedWin.isDestroyed() || capturedWebContents.isDestroyed()) return
            if (this.panelWindow !== capturedWin || this.pluginView !== capturedView) return

            if (useWindowsFramelessSurface) {
                await applyAttachedPanelSurface()
                if (capturedWin.isDestroyed() || this.panelWindow !== capturedWin || this.pluginView !== capturedView) return
            }

            // Suppress blur-hide while showing main + panel together;
            // without this guard the main window's blur handler can race
            // and hide everything before the panel receives focus.
            startIgnoringBlur()

            this.collapseMainWindowForAttachedPanel()
            this.syncPosition()
            this.layoutAttachedPluginView()

            if (!this.mainWindow.isVisible()) {
                this.mainWindow.show()
            }

            capturedWin.show()
            this.panelWindowHasBeenShown = true
            this.openPluginDevTools(capturedWebContents, plugin.id)
            onPanelShown?.()

            stopIgnoringBlur()

            if (onLoadReady) {
                await onLoadReady
                if (capturedWin.isDestroyed() || capturedWebContents.isDestroyed()) return
                if (this.panelWindow !== capturedWin || this.pluginView !== capturedView) return
            }

            sendInitialPluginInit(reason)

            if (this.themeManager && !capturedWebContents.isDestroyed()) {
                capturedWebContents.send('theme:changed', this.themeManager.getActualTheme())
            }
            this.scheduleShadowShow(capturedWin)
        }

        capturedWebContents.once('dom-ready', () => {
            if (capturedWin.isDestroyed() || capturedWebContents.isDestroyed()) return
            if (this.panelWindow !== capturedWin || this.pluginView !== capturedView) return
            sendInitialPluginInit('dom-ready')
            if (this.themeManager && !capturedWebContents.isDestroyed()) {
                capturedWebContents.send('theme:changed', this.themeManager.getActualTheme())
            }
        })

        let panelDidFinishLoadCount = 0
        capturedWebContents.on('did-finish-load', async () => {
            this.openPluginDevTools(capturedWebContents, plugin.id)
            panelDidFinishLoadCount++
            const loadNum = panelDidFinishLoadCount
            if (capturedWin.isDestroyed() || capturedWebContents.isDestroyed() || this.panelWindow !== capturedWin || this.pluginView !== capturedView) {
                return
            }
            if (useWindowsFramelessSurface) {
                await applyAttachedPanelSurface()
            }
            if (loadNum === 1) {
                sendInitialPluginInit('did-finish-load')
            }
            if (this.themeManager && !capturedWebContents.isDestroyed()) {
                capturedWebContents.send('theme:changed', this.themeManager.getActualTheme())
            }
            // 重载时重新发送 plugin:init；首次加载已由 dom-ready/did-finish-load/ready-to-show 先到者发送。
            if (loadNum > 1 && readyToShowInitSent && !capturedWebContents.isDestroyed() && this.panelWindow === capturedWin && this.pluginView === capturedView) {
                sendPluginInit(`reload #${loadNum}`)
            }
            void showPanel('did-finish-load')
        })

        // 安装 console 输出捕获（主进程侧捕获插件 console 输出）
        installConsoleCaptureForWebContents(capturedWebContents, plugin.id)

        // 监听渲染进程崩溃
        capturedWebContents.on('render-process-gone', (_event, details) => {
            // 记录崩溃日志到持久化存储
            loggerService.crash({
                pluginId: this.currentPlugin?.id || 'unknown',
                reason: details.reason,
                exitCode: details.exitCode,
                windowId: capturedWin.id
            })

            log.error('[PanelWindow] Render process gone:', details.reason)
            this.close()
        })

        // 加载插件 UI
        const routeHash = getPanelRouteHash(route)
        if (routeHash) {
            void capturedWebContents.loadFile(uiPath, { hash: routeHash })
        } else {
            void capturedWebContents.loadFile(uiPath)
        }
        return panelWindow
    }

    /**
     * 计算面板窗口的位置和尺寸
     */
    private calculatePanelBounds(): { x: number; y: number; width: number } {
        const mainBounds = getMainWindowVisibleBounds(this.mainWindow.getBounds())

        // 面板位于主窗口正下方，宽度相同
        return {
            x: mainBounds.x,
            y: mainBounds.y + mainBounds.height + 8,
            width: mainBounds.width
        }
    }

    private createShadowWindow() {
        if (!this.shouldUseShadowWindow()) {
            return
        }
        if (this.shadowWindow && !this.shadowWindow.isDestroyed()) {
            return
        }
        if (this.mainWindow.isDestroyed()) {
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
            parent: this.mainWindow,
            modal: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            backgroundColor: '#00000000',
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
            }
        })

        shadowWindow.setIgnoreMouseEvents(true, { forward: true })
        void shadowWindow.loadURL(ATTACHED_PANEL_SHADOW_URL)

        shadowWindow.on('closed', () => {
            if (this.shadowWindow && this.shadowWindow.id === shadowWindow.id) {
                this.shadowWindow = null
            }
        })

        this.shadowWindow = shadowWindow
    }

    private prepareShadowWindow() {
        if (!this.shouldUseShadowWindow()) return
        if (!this.shadowWindow || this.shadowWindow.isDestroyed()) {
            this.createShadowWindow()
        }
        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            const bounds = getWindowsFramelessSurfaceVisibleBounds(this.panelWindow.getBounds())
            this.setShadowBounds(bounds.x, bounds.y, bounds.width, bounds.height)
        }
    }

    private scheduleShadowShow(panelWin: BrowserWindow) {
        if (!this.shouldUseShadowWindow()) return
        const timer = setTimeout(() => {
            if (panelWin.isDestroyed() || this.panelWindow !== panelWin) return
            this.showShadow()
        }, ATTACHED_PANEL_SHADOW_SHOW_DELAY_MS)
        timer.unref?.()
    }

    private setShadowBounds(x: number, y: number, width: number, height: number) {
        if (!this.shouldUseShadowWindow()) return
        if (!this.shadowWindow || this.shadowWindow.isDestroyed()) return
        const margin = ATTACHED_PANEL_SHADOW_MARGIN
        this.shadowWindow.setBounds({
            x: x - margin,
            y: y - margin,
            width: Math.max(1, width + margin * 2),
            height: Math.max(1, height + margin * 2)
        })
    }

    private showShadow() {
        if (!this.shouldUseShadowWindow()) return
        this.prepareShadowWindow()
        if (this.shadowWindow && !this.shadowWindow.isDestroyed()) {
            this.shadowWindow.showInactive()
        }
    }

    private hideShadow() {
        if (!this.shouldUseShadowWindow()) return
        if (this.shadowWindow && !this.shadowWindow.isDestroyed()) {
            this.shadowWindow.hide()
        }
    }

    private closeShadowWindow() {
        if (!this.shouldUseShadowWindow()) {
            this.shadowWindow = null
            return
        }
        if (this.shadowWindow && !this.shadowWindow.isDestroyed()) {
            this.shadowWindow.close()
        }
        this.shadowWindow = null
    }

    /**
     * 设置位置同步监听器
     * 使用 requestAnimationFrame 级别的同步以避免割裂感
     */
    private setupPositionSync() {
        // 移除旧的监听器
        this.removePositionSync()

        // 使用节流的位置同步
        this.moveHandler = () => this.scheduleSync()
        this.resizeHandler = () => this.scheduleSync()

        this.mainWindow.on('move', this.moveHandler)
        this.mainWindow.on('resize', this.resizeHandler)
        this.mainWindow.on('moved', this.moveHandler) // Windows 上移动结束时触发

        // macOS 上使用 will-move 获得更早的响应
        if (process.platform === 'darwin') {
            const willMoveEvent = 'will-move' as Parameters<BrowserWindow['on']>[0]
            this.mainWindow.on(willMoveEvent, this.moveHandler)
        }
    }

    /**
     * 调度位置同步（防止高频更新）
     */
    private scheduleSync() {
        if (this.syncScheduled) return
        this.syncScheduled = true

        // 使用 setImmediate 获得最快响应
        setImmediate(() => {
            this.syncPosition()
            this.syncScheduled = false
        })
    }

    /**
     * 同步面板位置到主窗口下方
     */
    private syncPosition() {
        if (!this.panelWindow || this.panelWindow.isDestroyed()) return
        if (this.mainWindow.isDestroyed()) return

        const { x, y, width } = this.calculatePanelBounds()

        // 检查是否超出屏幕边界
        const display = screen.getDisplayNearestPoint({ x, y })
        const { workArea } = display

        const adjustedY = y
        let adjustedHeight = this.preferredPanelHeight

        // 如果面板超出屏幕底部，调整高度
        if (y + adjustedHeight > workArea.y + workArea.height) {
            adjustedHeight = Math.max(ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT, workArea.y + workArea.height - y)
        }

        // 批量设置位置和大小以减少闪烁
        this.syncingBounds = true
        try {
            const nextBounds = getWindowsFramelessSurfaceWindowBounds({
                x,
                y: adjustedY,
                width,
                height: adjustedHeight
            })
            if (!areBoundsEqual(this.panelWindow.getBounds(), nextBounds)) {
                this.panelWindow.setBounds(nextBounds)
            }
            this.layoutAttachedPluginView()
            this.setShadowBounds(x, adjustedY, width, adjustedHeight)
        } finally {
            this.syncingBounds = false
        }
    }

    /**
     * 移除位置同步监听器
     */
    private removePositionSync() {
        if (this.moveHandler) {
            this.mainWindow.removeListener('move', this.moveHandler)
            this.mainWindow.removeListener('moved', this.moveHandler)
            if (process.platform === 'darwin') {
                const willMoveEvent = 'will-move' as Parameters<BrowserWindow['on']>[0]
                this.mainWindow.removeListener(willMoveEvent, this.moveHandler)
            }
        }
        if (this.resizeHandler) {
            this.mainWindow.removeListener('resize', this.resizeHandler)
        }
    }

    /**
     * 将面板升级为独立窗口
     * 用户点击"弹出"按钮时调用
     */
    promoteToWindow(): PromotedPanelWindow | null {
        if (!this.panelWindow || this.panelWindow.isDestroyed()) return null
        if (!this.currentPlugin) return null
        const promotedPluginView = this.detachPluginViewForPromotion()
        if (!promotedPluginView) return null

        // 保存当前状态
        const bounds = getWindowsFramelessSurfaceVisibleBounds(this.panelWindow.getBounds())
        const plugin = this.currentPlugin
        const featureCode = this.currentFeatureCode
        const input = this.currentInput
        const attachments = this.currentAttachments
        const route = this.currentRoute

        // 创建独立窗口
        const currentTheme = this.themeManager?.getActualTheme() || 'dark'
        const isDark = currentTheme === 'dark'
        const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
        const windowInsets = getWindowsFramelessSurfaceInsets()
        const toWindowWidth = (value: number | undefined) => value == null ? undefined : value + windowInsets.left + windowInsets.right
        const toWindowHeight = (value: number | undefined) => value == null ? undefined : value + windowInsets.top + windowInsets.bottom
        const backgroundColor = useWindowsFramelessSurface ? '#00000000' : (isDark ? '#1e293b' : '#ffffff')

        // 从 manifest.window 读取窗口配置
        const windowConfig = plugin.manifest.window || {}
        const showTitleBar = shouldShowTitleBarForPanel(windowConfig)
        const backgroundThrottling = windowConfig.backgroundThrottling ?? true

        // 标题栏 preload 路径
        const titlebarPreloadPath = join(__dirname, '../preload/titlebar.js')

        const detachedBounds = getWindowsFramelessSurfaceWindowBounds({
            x: bounds.x,
            y: bounds.y,
            width: Math.max(bounds.width, windowConfig.width ?? 500),
            height: Math.max(bounds.height, windowConfig.height ?? 400) + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0)
        })

        const independentWindow = new BrowserWindow({
            width: detachedBounds.width,
            height: detachedBounds.height,
            x: detachedBounds.x,
            y: detachedBounds.y,
            minWidth: toWindowWidth(windowConfig.minWidth ?? 300)!,
            minHeight: toWindowHeight((windowConfig.minHeight ?? 200) + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!,
            maxWidth: toWindowWidth(windowConfig.maxWidth),
            maxHeight: toWindowHeight(windowConfig.maxHeight != null ? windowConfig.maxHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0) : undefined),
            frame: false,
            show: false,
            resizable: true,
            movable: true,
            thickFrame: !useWindowsFramelessSurface,
            backgroundColor,
            transparent: useWindowsFramelessSurface,
            hasShadow: !useWindowsFramelessSurface,
            title: plugin.manifest.displayName,
            icon: resolvePluginWindowIcon(plugin),
            webPreferences: showTitleBar ? {
                preload: titlebarPreloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
            } : {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
            }
        })

        // 注册插件分离独立窗口（必须注册以保证安全的 IPC）
        registerPluginWindow(independentWindow.id, plugin.id)
        registerWindowsInputTargetWindow(independentWindow.id, independentWindow.getNativeWindowHandle())

        const pluginView = promotedPluginView

        if (showTitleBar) {
            // BrowserWindow 加载标题栏页面
            const titlebarPath = join(__dirname, '../renderer/detached-titlebar.html')
            if (existsSync(titlebarPath)) {
                independentWindow.loadFile(titlebarPath)
            } else {
                const devTitlebarPath = join(__dirname, '../../public/detached-titlebar.html')
                if (existsSync(devTitlebarPath)) {
                    independentWindow.loadFile(devTitlebarPath)
                }
            }

            // 设置标题栏 IPC
            setupTitlebarIPC(independentWindow, pluginView, this.themeManager)
        } else {
            // 无标题栏独立窗口也使用安全 shell 承载插件 view，避免 reload 当前 Renderer。
            void independentWindow.loadURL(ATTACHED_PANEL_SHELL_URL)

            // 窗口状态事件
            independentWindow.on('maximize', () => {
                if (!pluginView.webContents.isDestroyed()) {
                    pluginView.webContents.send('window:stateChanged', { isMaximized: true })
                }
            })
            independentWindow.on('unmaximize', () => {
                if (!pluginView.webContents.isDestroyed()) {
                    pluginView.webContents.send('window:stateChanged', { isMaximized: false })
                }
            })
        }

        independentWindow.contentView.addChildView(pluginView)
        layoutPluginView(independentWindow, pluginView, showTitleBar)
        registerView(pluginView, independentWindow)

        // 窗口 resize 时更新插件视图布局
        independentWindow.on('resize', () => {
            if (!independentWindow.isDestroyed() && !pluginView.webContents.isDestroyed()) {
                layoutPluginView(independentWindow, pluginView, showTitleBar)
            }
        })

        // 目标 webContents（插件内容）
        const pluginWebContents = pluginView.webContents
        pluginWebContents.setBackgroundThrottling(backgroundThrottling)
        const sendDetachedInit = () => {
            if (independentWindow.isDestroyed() || pluginWebContents.isDestroyed()) return
            pluginWebContents.send('plugin:init', {
                pluginName: plugin.id,
                featureCode,
                input,
                attachments,
                mode: 'detached',
                windowType: windowConfig.type || 'default',
                route,
                capabilities: getPluginRendererCapabilities(plugin),
                nonce: Date.now()
            })
            if (this.themeManager) {
                pluginWebContents.send('theme:changed', this.themeManager.getActualTheme())
                if (showTitleBar) {
                    notifyTitlebarThemeChange(independentWindow, this.themeManager.getActualTheme())
                }
            }
        }

        independentWindow.once('ready-to-show', async () => {
            if (showTitleBar) {
                initTitlebar(independentWindow, plugin.manifest.displayName, currentTheme)
            }
            if (useWindowsFramelessSurface) {
                await applyWindowsFramelessSurface(independentWindow, { includeTitleBar: false, resizeMode: 'all' })
                if (independentWindow.isDestroyed()) return
            }
            layoutPluginView(independentWindow, pluginView, showTitleBar)
            independentWindow.show()
            this.openPluginDevTools(pluginWebContents, plugin.id)
            sendDetachedInit()
        })

        // 等待插件内容加载完成后再发送初始化数据和主题
        // ready-to-show 是标题栏触发的，此时插件 WebContentsView 可能还在加载
        pluginWebContents.on('did-finish-load', async () => {
            this.openPluginDevTools(pluginWebContents, plugin.id)
            if (useWindowsFramelessSurface && !independentWindow.isDestroyed()) {
                await applyWindowsFramelessSurface(independentWindow, { includeTitleBar: false, resizeMode: 'all' })
            }
            // 延迟确保 React useEffect 已注册 IPC 回调
            setTimeout(() => {
                sendDetachedInit()
            }, 100)
        })

        // 注册到主题管理器
        if (this.themeManager) {
            this.themeManager.registerWindow(independentWindow)
        }

        // 安装 console 输出捕获（主进程侧捕获插件 console 输出）
        installConsoleCaptureForWebContents(pluginWebContents, plugin.id)

        // 窗口关闭时清理 WebContentsView
        independentWindow.once('closed', () => {
            unregisterPluginWindow(independentWindow.id)
            unregisterWindowsInputTargetWindow(independentWindow.id)
            if (pluginView && !pluginView.webContents.isDestroyed()) {
                unregisterView(pluginView)
                pluginView.webContents.close()
            }
        })

        // 清理当前状态
        this.currentPlugin = null
        this.currentFeatureCode = ''
        this.currentInput = ''
        this.currentAttachments = []
        this.currentRoute = undefined

        return { window: independentWindow, pluginView }
    }

    /**
     * 挂起面板：隐藏窗口但保留 Renderer 上下文和插件信息。
     * 返回 true 表示成功挂起，false 表示无可挂起的面板。
     */
    suspend(): boolean {
        if (!this.panelWindow || this.panelWindow.isDestroyed() || !this.currentPlugin) {
            return false
        }
        this.hide()
        this.suspendedForResident = true
        log.info(`[ResidentUI] suspend | plugin=${this.currentPlugin.id}`)
        return true
    }

    /**
     * 恢复挂起的面板：显示已缓存的窗口并补发 plugin:init。
     * 返回 true 表示成功恢复。
     */
    restore(featureCode: string, input?: InputPayload, route?: string): boolean {
        if (!this.panelWindow || this.panelWindow.isDestroyed() || !this.currentPlugin) {
            return false
        }
        const pluginWebContents = this.getPluginWebContents()
        if (!pluginWebContents) {
            return false
        }
        this.currentFeatureCode = featureCode
        this.currentInput = input?.text || ''
        this.currentAttachments = input?.attachments || []
        this.currentRoute = route

        this.suspendedForResident = false
        const restoredPlugin = this.currentPlugin
        const restoredView = this.pluginView
        const sendRestoreInit = (reason: string) => {
            if (!this.panelWindow || this.panelWindow.isDestroyed() || pluginWebContents.isDestroyed()) return
            if (this.currentPlugin !== restoredPlugin || this.pluginView !== restoredView) return
            const nonce = Date.now()
            pluginWebContents.send('plugin:init', {
                pluginName: restoredPlugin.id,
                featureCode,
                input: this.currentInput,
                attachments: this.currentAttachments,
                mode: 'panel' as const,
                route: this.currentRoute,
                capabilities: getPluginRendererCapabilities(restoredPlugin),
                nonce
            })
            log.info(`[AttachmentTrace][Main] resident plugin:init sent | plugin=${restoredPlugin.id} | feature=${featureCode} | route=${this.currentRoute || ''} | reason=${reason} | nonce=${nonce} | ${formatPayloadTrace({ text: this.currentInput, attachments: this.currentAttachments })}`)

            if (this.themeManager && !pluginWebContents.isDestroyed()) {
                pluginWebContents.send('theme:changed', this.themeManager.getActualTheme())
            }
        }

        const currentRoute = (() => {
            try {
                return normalizePanelRoute(new URL(pluginWebContents.getURL()).hash)
            } catch {
                return ''
            }
        })()
        const nextRoute = normalizePanelRoute(route)

        if (currentRoute !== nextRoute && restoredPlugin.manifest.ui) {
            this.hide()
            let completed = false
            let fallbackTimer: NodeJS.Timeout | null = null
            const completeRestore = (reason: string) => {
                if (completed) return
                completed = true
                pluginWebContents.removeListener('did-finish-load', onFinishLoad)
                pluginWebContents.removeListener('did-fail-load', onFailLoad)
                if (fallbackTimer) {
                    clearTimeout(fallbackTimer)
                    fallbackTimer = null
                }
                this.show({ activate: true })
                this.openPluginDevTools(pluginWebContents, restoredPlugin.id)
                sendRestoreInit(reason)
            }
            const onFinishLoad = () => completeRestore('did-finish-load')
            const onFailLoad = () => completeRestore('did-fail-load')
            pluginWebContents.once('did-finish-load', onFinishLoad)
            pluginWebContents.once('did-fail-load', onFailLoad)
            fallbackTimer = setTimeout(() => {
                log.warn(`[ResidentUI] restore load fallback | plugin=${restoredPlugin.id} | currentRoute=${currentRoute} | nextRoute=${nextRoute}`)
                completeRestore('load-fallback')
            }, 150)
            fallbackTimer.unref?.()
            const uiPath = join(restoredPlugin.path, restoredPlugin.manifest.ui)
            const routeHash = getPanelRouteHash(route)
            if (routeHash) {
                void pluginWebContents.loadFile(uiPath, { hash: routeHash }).catch((err) => {
                    log.warn(`[ResidentUI] restore load failed | plugin=${restoredPlugin.id}:`, err)
                    completeRestore('load-error')
                })
            } else {
                void pluginWebContents.loadFile(uiPath).catch((err) => {
                    log.warn(`[ResidentUI] restore load failed | plugin=${restoredPlugin.id}:`, err)
                    completeRestore('load-error')
                })
            }
        } else {
            this.show({ activate: true })
            this.openPluginDevTools(pluginWebContents, restoredPlugin.id)
            sendRestoreInit('same-route')
        }

        log.info(`[ResidentUI] restore | plugin=${restoredPlugin.id}`)
        return true
    }

    /**
     * 获取当前缓存的插件 ID（用于 resident session 匹配）
     */
    getCachedPluginId(): string | null {
        if (!this.panelWindow || this.panelWindow.isDestroyed() || !this.currentPlugin || !this.getPluginWebContents()) {
            return null
        }
        return this.currentPlugin.id
    }

    isSuspendedForResident(): boolean {
        return this.suspendedForResident
    }

    /**
     * 关闭面板窗口
     */
    close() {
        this.clearCurrentPluginSession()
    }

    /**
     * 清理资源
     */
    private cleanup() {
        this.clearCurrentPluginSession()
        this.panelWindow = null
    }

    /**
     * 检查面板是否打开
     */
    isOpen(): boolean {
        return Boolean(
            this.currentPlugin
            && this.panelWindow
            && !this.panelWindow.isDestroyed()
            && this.getPluginWebContents()
        )
    }

    /**
     * 获取当前面板窗口
     */
    getWindow(): BrowserWindow | null {
        if (!this.panelWindow || this.panelWindow.isDestroyed()) return null
        return this.panelWindow
    }

    /**
     * 获取当前加载的插件
     */
    getCurrentPlugin(): Plugin | null {
        if (this.suspendedForResident) return null
        return this.currentPlugin
    }

    /**
     * 隐藏面板（但不关闭）
     */
    hide() {
        this.clearOpacityRestoreTimer(true)
        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            this.panelWindow.hide()
        }
        this.hideShadow()
    }

    /**
     * 显示面板
     */
    show(options: { activate?: boolean } = {}) {
        if (this.suspendedForResident || !this.currentPlugin) return
        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            startIgnoringBlur()
            this.collapseMainWindowForAttachedPanel()
            this.syncPosition()
            this.layoutAttachedPluginView()
            if (!this.mainWindow.isDestroyed()) {
                if (this.mainWindow.isMinimized()) {
                    this.mainWindow.restore()
                }
                if (!this.mainWindow.isVisible()) {
                    this.mainWindow.show()
                }
            }
            const needsOpacityGuard = process.platform === 'win32'
                && this.panelWindowHasBeenShown
                && !this.panelWindow.isVisible()
            this.clearOpacityRestoreTimer(false)
            if (needsOpacityGuard) {
                this.panelWindow.setOpacity(0)
            } else {
                this.panelWindow.setOpacity(1)
            }
            this.showShadow()
            if (options.activate) {
                this.panelWindow.show()
            } else {
                this.panelWindow.showInactive()
            }
            this.panelWindowHasBeenShown = true
            stopIgnoringBlur()
            if (needsOpacityGuard) {
                this.getPluginWebContents()?.invalidate()
                this.opacityRestoreTimer = setTimeout(() => {
                    this.opacityRestoreTimer = null
                    if (!this.panelWindow || this.panelWindow.isDestroyed() || !this.panelWindow.isVisible()) {
                        return
                    }
                    this.panelWindow.setOpacity(1)
                }, WINDOWS_PANEL_SHOW_OPACITY_GUARD_MS)
            }
        }
    }

    // Clean up the deferred opacity restore used by the Windows show guard.
    private clearOpacityRestoreTimer(resetOpacity: boolean) {
        if (this.opacityRestoreTimer) {
            clearTimeout(this.opacityRestoreTimer)
            this.opacityRestoreTimer = null
        }
        if (!resetOpacity) return
        if (process.platform !== 'win32') return
        if (!this.panelWindow || this.panelWindow.isDestroyed()) return
        this.panelWindow.setOpacity(1)
    }

    /**
     * 发送消息到面板插件 view
     */
    send(channel: string, ...args: unknown[]) {
        const pluginWebContents = this.getPluginWebContents()
        if (pluginWebContents && !pluginWebContents.isDestroyed()) {
            pluginWebContents.send(channel, ...args)
        }
    }
}

/**
 * 判断窗口是否应该显示 Mulby 标题栏
 * - default 类型：默认显示（除非 titleBar 显式设为 false）
 * - borderless / fullscreen 类型：默认不显示（除非 titleBar 显式设为 true）
 */
function shouldShowTitleBarForPanel(windowConfig: WindowOptions): boolean {
    const windowType = windowConfig.type || 'default'
    if (windowConfig.titleBar !== undefined) {
        return windowConfig.titleBar
    }
    return windowType === 'default'
}
