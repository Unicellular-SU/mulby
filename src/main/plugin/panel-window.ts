import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { Plugin } from '../../shared/types/plugin'
import { ThemeManager } from '../theme'
import { injectCustomTitleBar } from './titlebar'

/**
 * 生成面板工具栏的 CSS
 */
function getPanelToolbarCSS(theme: 'light' | 'dark'): string {
    const isDark = theme === 'dark'
    return `
        #intools-panel-toolbar {
            position: fixed;
            top: 8px;
            right: 8px;
            z-index: 99999;
            display: flex;
            gap: 4px;
            padding: 4px;
            background: ${isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)'};
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(8px);
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        #intools-panel-toolbar:hover,
        #intools-panel-toolbar.visible {
            opacity: 1;
        }
        .intools-panel-btn {
            width: 28px;
            height: 28px;
            border: none;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: ${isDark ? '#94a3b8' : '#64748b'};
            transition: all 0.15s ease;
        }
        .intools-panel-btn:hover {
            background: ${isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.1)'};
            color: ${isDark ? '#e2e8f0' : '#334155'};
        }
        .intools-panel-btn svg {
            width: 16px;
            height: 16px;
        }
    `
}

/**
 * 生成面板工具栏的 HTML
 */
function getPanelToolbarHTML(): string {
    return `
        <div id="intools-panel-toolbar">
            <button class="intools-panel-btn" id="intools-detach-btn" title="弹出为独立窗口">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
            </button>
            <button class="intools-panel-btn" id="intools-close-btn" title="关闭">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
    `
}

/**
 * 生成面板工具栏的 JavaScript
 */
function getPanelToolbarJS(): string {
    return `
        (function() {
            const toolbar = document.getElementById('intools-panel-toolbar');
            if (!toolbar) return;
            
            // 鼠标进入窗口时显示工具栏
            let hideTimeout = null;
            document.addEventListener('mouseenter', () => {
                toolbar.classList.add('visible');
                if (hideTimeout) clearTimeout(hideTimeout);
            });
            document.addEventListener('mouseleave', () => {
                hideTimeout = setTimeout(() => {
                    toolbar.classList.remove('visible');
                }, 1000);
            });
            
            // 初始显示3秒后隐藏
            toolbar.classList.add('visible');
            setTimeout(() => {
                toolbar.classList.remove('visible');
            }, 3000);
            
            // 弹出按钮
            document.getElementById('intools-detach-btn')?.addEventListener('click', () => {
                window.intools?.window?.detach?.();
            });
            
            // 关闭按钮
            document.getElementById('intools-close-btn')?.addEventListener('click', () => {
                window.intools?.window?.close?.();
            });
        })();
    `
}

/**
 * 注入面板工具栏到窗口
 */
async function injectPanelToolbar(win: BrowserWindow, theme: 'light' | 'dark'): Promise<void> {
    const css = getPanelToolbarCSS(theme)
    const html = getPanelToolbarHTML()
    const js = getPanelToolbarJS()

    await win.webContents.executeJavaScript(`
        (function() {
            // 如果已存在则移除
            document.getElementById('intools-panel-toolbar')?.remove();
            document.getElementById('intools-panel-toolbar-style')?.remove();
            
            // 注入 CSS
            const style = document.createElement('style');
            style.id = 'intools-panel-toolbar-style';
            style.textContent = ${JSON.stringify(css)};
            document.head.appendChild(style);
            
            // 注入 HTML
            const container = document.createElement('div');
            container.innerHTML = ${JSON.stringify(html)};
            document.body.appendChild(container.firstElementChild);
            
            // 执行 JS
            ${js}
        })();
    `)
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

    // 位置同步相关
    private moveHandler: (() => void) | null = null
    private resizeHandler: (() => void) | null = null
    private syncScheduled = false

    // 配置
    private readonly PANEL_HEIGHT = 550

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
        input: string = ''
    ): BrowserWindow | null {
        if (!plugin.manifest.ui) return null

        const uiPath = join(plugin.path, plugin.manifest.ui)

        // 关闭现有面板
        this.close()

        // 存储当前插件信息
        this.currentPlugin = plugin
        this.currentFeatureCode = featureCode
        this.currentInput = input

        // 计算初始位置
        const { x, y, width } = this.calculatePanelBounds()

        // 根据当前主题设置窗口背景色
        const currentTheme = this.themeManager?.getActualTheme() || 'dark'
        const isDark = currentTheme === 'dark'
        const backgroundColor = isDark ? '#1e293b' : '#ffffff'

        this.panelWindow = new BrowserWindow({
            width,
            height: this.PANEL_HEIGHT,
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
                preload: join(__dirname, '../preload/index.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true // 启用沙箱增强安全性
            }
        })

        // 加载插件 UI
        this.panelWindow.loadFile(uiPath)

        // 设置位置同步监听器
        this.setupPositionSync()

        // 面板加载完成后处理
        this.panelWindow.once('ready-to-show', async () => {
            if (!this.panelWindow) return

            // 同步位置确保正确
            this.syncPosition()

            // 显示窗口
            this.panelWindow.showInactive() // 不抢夺焦点

            // 注入面板工具栏（关闭/弹出按钮）
            const theme = this.themeManager?.getActualTheme() || 'dark'
            await injectPanelToolbar(this.panelWindow, theme)

            // 发送初始化数据
            this.panelWindow.webContents.send('plugin:init', {
                pluginName: plugin.manifest.name,
                featureCode,
                input,
                mode: 'panel'
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

        // 监听渲染进程崩溃
        this.panelWindow.webContents.on('render-process-gone', (_event, details) => {
            console.error('[PanelWindow] Render process gone:', details.reason)
            this.close()
            // TODO: 可以通知用户插件崩溃
        })

        // 监听窗口关闭
        this.panelWindow.on('closed', () => {
            this.cleanup()
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
            y: mainBounds.y + mainBounds.height,
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
            this.mainWindow.on('will-move' as any, this.moveHandler)
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

        let adjustedY = y
        let adjustedHeight = panelBounds.height

        // 如果面板超出屏幕底部，调整高度
        if (y + panelBounds.height > workArea.y + workArea.height) {
            adjustedHeight = Math.max(200, workArea.y + workArea.height - y)
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
                this.mainWindow.removeListener('will-move' as any, this.moveHandler)
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
        const featureCode = this.currentFeatureCode
        const input = this.currentInput

        // 关闭面板（但不清理插件信息，因为我们要转移到新窗口）
        this.panelWindow.close()
        this.panelWindow = null
        this.removePositionSync()

        // 创建独立窗口
        const currentTheme = this.themeManager?.getActualTheme() || 'dark'
        const isDark = currentTheme === 'dark'
        const backgroundColor = isDark ? '#1e293b' : '#ffffff'

        const independentWindow = new BrowserWindow({
            width: Math.max(bounds.width, 500),
            height: Math.max(bounds.height, 400),
            x: bounds.x,
            y: bounds.y,
            minWidth: 300,
            minHeight: 200,
            frame: false, // 使用自定义标题栏
            show: false,
            resizable: true,
            movable: true,
            backgroundColor,
            title: plugin.manifest.displayName,
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        })

        // 加载相同的 URL
        independentWindow.loadURL(url)

        independentWindow.once('ready-to-show', async () => {
            // 注入自定义标题栏
            await injectCustomTitleBar(independentWindow, plugin.manifest.displayName, currentTheme)
            independentWindow.show()

            // 发送初始化数据（模式变更为 detached）
            independentWindow.webContents.send('plugin:init', {
                pluginName: plugin.manifest.name,
                featureCode,
                input,
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
                'document.getElementById("intools-titlebar") !== null'
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
