import { BrowserWindow, screen } from 'electron'
import http from 'http'
import https from 'https'
import { join } from 'path'
import { InputAttachment, InputPayload, Plugin } from '../../shared/types/plugin'
import { ThemeManager } from '../services/theme'
import { loggerService } from '../services/logger'
import { injectCustomTitleBar } from './titlebar'
import { isIgnoringBlur } from '../services/blur-manager'
import { getPluginPreloadPath } from './plugin-preload-wrapper'
import { ATTACHED_PANEL_HEIGHT, ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT } from '../constants/panel-window'

function canReachUrl(url: string, timeoutMs = 800): Promise<boolean> {
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

/**
 * 插件面板窗口管理器
 * 负责创建和管理跟随主窗口的面板式插件窗口
 */
export class PluginPanelWindow {
    private panelWindow: BrowserWindow | null = null
    private mainWindow: BrowserWindow
    private themeManager: ThemeManager | null = null
    private currentPlugin: Plugin | null = null
    private currentFeatureCode: string = ''
    private currentInput: string = ''
    private currentAttachments: InputAttachment[] = []

    // 位置同步相关
    private moveHandler: (() => void) | null = null
    private resizeHandler: (() => void) | null = null
    private syncScheduled = false

    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow
    }

    setThemeManager(manager: ThemeManager) {
        this.themeManager = manager
    }

    /**
     * 创建跟随搜索框的面板窗口
     */
    createPanel(
        plugin: Plugin,
        featureCode: string,
        input?: InputPayload,
        route?: string
    ): BrowserWindow | null {
        if (!plugin.manifest.ui) return null

        const uiPath = join(plugin.path, plugin.manifest.ui)

        // 关闭现有面板
        this.close()

        // 存储当前插件信息
        this.currentPlugin = plugin
        this.currentFeatureCode = featureCode
        this.currentInput = input?.text || ''
        this.currentAttachments = input?.attachments || []

        // 计算初始位置
        const { x, y, width } = this.calculatePanelBounds()

        // 根据当前主题设置窗口背景色
        const currentTheme = this.themeManager?.getActualTheme() || 'dark'
        const isDark = currentTheme === 'dark'
        const backgroundColor = isDark ? '#1e293b' : '#ffffff'

        // 获取插件 preload 路径（支持自定义 preload）
        const basePreloadPath = join(__dirname, '../preload/index.js')
        const preloadPath = getPluginPreloadPath(basePreloadPath, plugin)
        const hasCustomPreload = !!plugin.manifest.preload

        this.panelWindow = new BrowserWindow({
            width,
            height: ATTACHED_PANEL_HEIGHT,
            x,
            y,
            frame: false,
            show: false,
            resizable: true,
            movable: false, // 禁止直接拖动，跟随父窗口
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            parent: this.mainWindow, // 关键：设置父窗口（macOS 自动跟随）
            modal: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            backgroundColor,
            hasShadow: true,
            roundedCorners: true,
            webPreferences: {
                preload: preloadPath,
                contextIsolation: !hasCustomPreload,
                nodeIntegration: hasCustomPreload,
                sandbox: !hasCustomPreload // 如果有自定义 preload，禁用沙箱以允许 Node.js 访问
            }
        })

        // 加载插件 UI
        if (route) {
            void this.panelWindow.loadFile(uiPath, { hash: route })
        } else {
            void this.panelWindow.loadFile(uiPath)
        }

        // 设置位置同步监听器
        this.setupPositionSync()

        // 面板加载完成后处理
        this.panelWindow.once('ready-to-show', async () => {
            if (!this.panelWindow) return

            // 同步位置确保正确
            this.syncPosition()

            // 确保主窗口是显示的
            if (!this.mainWindow.isVisible()) {
                this.mainWindow.show()
            }

            // 显示窗口 (使用 show() 抢夺焦点，确保显示)
            this.panelWindow.show()

            // 发送初始化数据
            this.panelWindow.webContents.send('plugin:init', {
                pluginName: plugin.id,
                featureCode,
                input: this.currentInput,
                attachments: this.currentAttachments,
                mode: 'panel',
                route
            })

            // 发送主题
            if (this.themeManager) {
                this.panelWindow.webContents.send('theme:changed', this.themeManager.getActualTheme())
            }
        })

        // 监听焦点变化 - 点击面板时获取焦点
        this.panelWindow.on('focus', () => {
            // 面板获得焦点是正常的
        })

        // 面板失焦时检查焦点去向
        this.panelWindow.on('blur', () => {
            // 如果正在使用系统对话框，忽略 blur 事件
            if (isIgnoringBlur()) return

            setTimeout(() => {
                // 如果焦点回到了主窗口，不隐藏
                if (this.mainWindow.isFocused()) {
                    return
                }
                // 如果面板仍然有焦点（误触发），不隐藏
                if (this.panelWindow && !this.panelWindow.isDestroyed() && this.panelWindow.isFocused()) {
                    return
                }
                // 焦点转移到其他地方，隐藏所有
                this.hide()
                this.mainWindow.hide()
            }, 50)
        })

        // 监听渲染进程崩溃
        this.panelWindow.webContents.on('render-process-gone', (_event, details) => {
            // 记录崩溃日志到持久化存储
            loggerService.crash({
                pluginId: this.currentPlugin?.id || 'unknown',
                reason: details.reason,
                exitCode: details.exitCode,
                windowId: this.panelWindow?.id
            })

            console.error('[PanelWindow] Render process gone:', details.reason)
            this.close()
        })

        // 监听窗口关闭
        // 关键修复：使用闭包捕获当前窗口实例，防止旧窗口关闭事件清理了新窗口的引用
        const currentWin = this.panelWindow
        this.panelWindow.on('closed', () => {
            if (this.panelWindow === currentWin) {
                this.cleanup()
            }
        })

        // 注册到主题管理器
        if (this.themeManager) {
            this.themeManager.registerWindow(this.panelWindow)
        }

        return this.panelWindow
    }

    /**
     * 计算面板窗口的位置和尺寸
     */
    private calculatePanelBounds(): { x: number; y: number; width: number } {
        const mainBounds = this.mainWindow.getBounds()

        // 面板位于主窗口正下方，宽度相同
        return {
            x: mainBounds.x,
            y: mainBounds.y + mainBounds.height + 8,
            width: mainBounds.width
        }
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
        const panelBounds = this.panelWindow.getBounds()

        // 检查是否超出屏幕边界
        const display = screen.getDisplayNearestPoint({ x, y })
        const { workArea } = display

        const adjustedY = y
        let adjustedHeight = panelBounds.height

        // 如果面板超出屏幕底部，调整高度
        if (y + panelBounds.height > workArea.y + workArea.height) {
            adjustedHeight = Math.max(ATTACHED_PANEL_MIN_OVERFLOW_HEIGHT, workArea.y + workArea.height - y)
        }

        // 批量设置位置和大小以减少闪烁
        this.panelWindow.setBounds({
            x,
            y: adjustedY,
            width,
            height: adjustedHeight
        })
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
    promoteToWindow(): BrowserWindow | null {
        if (!this.panelWindow || this.panelWindow.isDestroyed()) return null
        if (!this.currentPlugin) return null

        // 保存当前状态
        const bounds = this.panelWindow.getBounds()
        const url = this.panelWindow.webContents.getURL()
        const plugin = this.currentPlugin
        const uiPath = join(plugin.path, plugin.manifest.ui!)
        const featureCode = this.currentFeatureCode
        const input = this.currentInput
        const attachments = this.currentAttachments

        // 关闭面板（但不清理插件信息，因为我们要转移到新窗口）
        this.panelWindow.close()
        this.panelWindow = null
        this.removePositionSync()

        // 创建独立窗口
        const currentTheme = this.themeManager?.getActualTheme() || 'dark'
        const isDark = currentTheme === 'dark'
        const backgroundColor = isDark ? '#1e293b' : '#ffffff'

        // 从 manifest.window 读取窗口配置
        const windowConfig = plugin.manifest.window || {}

        // 获取插件 preload 路径（支持自定义 preload）
        const basePreloadPath = join(__dirname, '../preload/index.js')
        const preloadPath = getPluginPreloadPath(basePreloadPath, plugin)
        const hasCustomPreload = !!plugin.manifest.preload

        const independentWindow = new BrowserWindow({
            width: Math.max(bounds.width, windowConfig.width ?? 500),
            height: Math.max(bounds.height, windowConfig.height ?? 400),
            x: bounds.x,
            y: bounds.y,
            minWidth: windowConfig.minWidth ?? 300,
            minHeight: windowConfig.minHeight ?? 200,
            maxWidth: windowConfig.maxWidth,
            maxHeight: windowConfig.maxHeight,
            frame: false, // 使用自定义标题栏
            show: false,
            resizable: true,
            movable: true,
            backgroundColor,
            title: plugin.manifest.displayName,
            webPreferences: {
                preload: preloadPath,
                contextIsolation: !hasCustomPreload,
                nodeIntegration: hasCustomPreload
            }
        })

        // 加载相同的 URL（若 dev server 不可达则回退到本地文件）
        if (url.startsWith('http://') || url.startsWith('https://')) {
            void canReachUrl(url).then((reachable) => {
                if (reachable) {
                    void independentWindow.loadURL(url)
                } else {
                    console.warn(`[PluginPanelWindow] Dev server not reachable at ${url}, falling back to local file.`)
                    void independentWindow.loadFile(uiPath)
                }
            })
        } else {
            void independentWindow.loadURL(url)
        }

        independentWindow.once('ready-to-show', async () => {
            // 注入自定义标题栏
            await injectCustomTitleBar(independentWindow, plugin.manifest.displayName, currentTheme)
            independentWindow.show()

            // 发送初始化数据（模式变更为 detached）
            independentWindow.webContents.send('plugin:init', {
                pluginName: plugin.id,
                featureCode,
                input,
                attachments,
                mode: 'detached'
            })

            // 发送主题
            if (this.themeManager) {
                independentWindow.webContents.send('theme:changed', this.themeManager.getActualTheme())
            }
        })

        // 监听窗口状态变化
        independentWindow.on('maximize', () => {
            independentWindow.webContents.send('window:stateChanged', { isMaximized: true })
        })
        independentWindow.on('unmaximize', () => {
            independentWindow.webContents.send('window:stateChanged', { isMaximized: false })
        })

        // 页面重载时重新注入标题栏
        independentWindow.webContents.on('did-finish-load', async () => {
            const hasTitleBar = await independentWindow.webContents.executeJavaScript(
                'document.getElementById("mulby-titlebar") !== null'
            )
            if (!hasTitleBar) {
                const theme = this.themeManager?.getActualTheme() || 'dark'
                await injectCustomTitleBar(independentWindow, plugin.manifest.displayName, theme)
            }
        })

        // 注册到主题管理器
        if (this.themeManager) {
            this.themeManager.registerWindow(independentWindow)
        }

        // 清理当前状态
        this.currentPlugin = null
        this.currentFeatureCode = ''
        this.currentInput = ''
        this.currentAttachments = []

        return independentWindow
    }

    /**
     * 关闭面板窗口
     */
    close() {
        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            this.panelWindow.close()
        }
        this.cleanup()
    }

    /**
     * 清理资源
     */
    private cleanup() {
        this.removePositionSync()
        this.panelWindow = null
        this.currentPlugin = null
        this.currentFeatureCode = ''
        this.currentInput = ''
        this.currentAttachments = []
        this.syncScheduled = false
    }

    /**
     * 检查面板是否打开
     */
    isOpen(): boolean {
        return this.panelWindow !== null && !this.panelWindow.isDestroyed()
    }

    /**
     * 获取当前面板窗口
     */
    getWindow(): BrowserWindow | null {
        return this.panelWindow
    }

    /**
     * 获取当前加载的插件
     */
    getCurrentPlugin(): Plugin | null {
        return this.currentPlugin
    }

    /**
     * 隐藏面板（但不关闭）
     */
    hide() {
        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            this.panelWindow.hide()
        }
    }

    /**
     * 显示面板
     */
    show() {
        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            this.syncPosition() // 确保位置正确
            this.panelWindow.showInactive()
        }
    }

    /**
     * 发送消息到面板窗口
     */
    send(channel: string, ...args: unknown[]) {
        if (this.panelWindow && !this.panelWindow.isDestroyed()) {
            this.panelWindow.webContents.send(channel, ...args)
        }
    }
}
