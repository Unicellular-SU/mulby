import { BrowserWindow, app, Menu, screen, WebContentsView } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { InputAttachment, InputPayload, Plugin, WindowOptions } from '../../shared/types/plugin'
import { ThemeManager } from '../services/theme'
import { loggerService } from '../services/logger'
import { installConsoleCapture } from './console-capture'
import { appSettingsManager } from '../services/app-settings'
import { PluginPanelWindow } from './panel-window'
import { clearSubInputState } from '../services/subinput-state'
import { getPluginPreloadPath } from './plugin-preload-wrapper'
import { PLUGIN_RENDERER_V8_CACHE_OPTIONS } from './plugin-web-preferences'
import {
  applyWindowsFramelessSurface,
  getWindowsFramelessSurfaceInsets,
  shouldUseWindowsFramelessSurface
} from '../services/window-surface'
import { registerView } from '../services/webcontents-registry'
import { registerPluginWindow, unregisterPluginWindow } from '../services/ipc-caller-resolver'
import { registerProtectedWindow, unregisterProtectedWindow } from './input'
import {
  DETACHED_TITLEBAR_HEIGHT,
  setupTitlebarIPC,
  initTitlebar,
  notifyTitlebarThemeChange,
  layoutPluginView
} from './titlebar-view'
import log from 'electron-log'

interface AttachedPlugin {
  plugin: Plugin
  featureCode: string
  route?: string
  input: string
  attachments?: InputAttachment[]
  startedAt: number
}

interface DetachedWindowInfo {
  window: BrowserWindow
  pluginView?: WebContentsView  // 插件内容视图（WebContentsView 架构时存在）
  plugin: Plugin
  featureCode: string
  input: string
  attachments?: InputAttachment[]
  startedAt: number
  creatorId?: number  // 创建此窗口的父窗口 ID
}

// 子窗口创建选项
interface AuxiliaryWindowOptions {
  width?: number
  height?: number
  title?: string
  // 窗口类型，覆盖 manifest.window.type
  type?: 'default' | 'borderless' | 'fullscreen'
  // 是否显示标题栏，覆盖 manifest.window.titleBar
  titleBar?: boolean
  // Electron 原生选项
  fullscreen?: boolean
  alwaysOnTop?: boolean
  resizable?: boolean
  x?: number
  y?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  // 透明度相关
  opacity?: number     // 初始透明度（0.0 ~ 1.0，运行时可调）
  transparent?: boolean // 窗口背景透明（配合 CSS 实现穿透效果，仅创建时生效）
}

export class PluginWindowManager {
  private mainWindow: BrowserWindow | null = null
  private themeManager: ThemeManager | null = null
  private attachedPlugin: AttachedPlugin | null = null
  private detachedWindows: Map<number, DetachedWindowInfo> = new Map()
  private dockVisible = false
  private onWindowClosedCallback?: (pluginId: string) => Promise<void>
  /**
   * 回调：attached panel 即将关闭时，由 PluginManager 决定是否挂起为 resident-ui。
   * 返回 true 表示已挂起（不走 close 路径），返回 false 表示正常关闭。
   */
  private shouldSuspendOnCloseCallback?: (pluginId: string, featureCode: string, route?: string) => boolean

  // 面板窗口管理器（跟随搜索框的插件窗口）
  private panelWindow: PluginPanelWindow | null = null

  private shouldOpenPluginDevTools(): boolean {
    const developer = appSettingsManager.getSettings().developer
    return developer.enabled && developer.showDevTools === true
  }

  private getDetachedTitlebarPath(): string | null {
    const candidates = app.isPackaged
      ? [join(__dirname, '../renderer/detached-titlebar.html')]
      : [
          // 开发态优先读源文件，避免 dist/renderer 中的旧 HTML 掩盖标题栏改动。
          join(process.cwd(), 'public/detached-titlebar.html'),
          join(__dirname, '../../public/detached-titlebar.html'),
          join(__dirname, '../renderer/detached-titlebar.html')
        ]

    return candidates.find((candidate) => existsSync(candidate)) ?? null
  }

  // 更新 macOS Dock 图标显示状态
  private async updateDockVisibility(): Promise<void> {
    if (process.platform !== 'darwin' || !app.dock) return

    const shouldShow = this.detachedWindows.size > 0

    if (shouldShow && !this.dockVisible) {
      this.dockVisible = true
      await app.dock.show()
      this.updateDockMenu()
    } else if (shouldShow && this.dockVisible) {
      this.updateDockMenu()
    } else if (!shouldShow && this.dockVisible) {
      this.dockVisible = false
      app.dock.setMenu(Menu.buildFromTemplate([]))
      app.dock.hide()
    }
  }

  // 更新 Dock 右键菜单
  private updateDockMenu(): void {
    if (process.platform !== 'darwin' || !app.dock) return

    const menuItems = Array.from(this.detachedWindows.values())
      .filter(info => !info.window.isDestroyed())
      .map(info => ({
        label: info.plugin.manifest.displayName,
        click: () => {
          if (!info.window.isDestroyed()) {
            info.window.show()
            info.window.focus()
          }
        }
      }))

    const menu = Menu.buildFromTemplate(menuItems)
    app.dock.setMenu(menu)
  }

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win
    // 初始化面板窗口管理器
    this.panelWindow = new PluginPanelWindow(win)
  }

  setThemeManager(manager: ThemeManager) {
    this.themeManager = manager
    // 同时设置到面板窗口管理器
    this.panelWindow?.setThemeManager(manager)
  }

  prewarmAttachedShell(delayMs = 300): void {
    const timer = setTimeout(() => {
      this.panelWindow?.prewarmShell()
    }, delayMs)
    timer.unref?.()
  }

  // 设置窗口关闭回调（用于处理后台运行）
  setOnWindowClosedCallback(callback: (pluginId: string) => Promise<void>) {
    this.onWindowClosedCallback = callback
  }

  // 设置挂起决策回调（PluginManager 注入）
  setShouldSuspendOnCloseCallback(callback: (pluginId: string, featureCode: string, route?: string) => boolean) {
    this.shouldSuspendOnCloseCallback = callback
  }

  // 获取附着的插件信息
  getAttachedPlugin(): AttachedPlugin | null {
    return this.attachedPlugin
  }

  // 是否有附着的插件
  hasAttachedPlugin(): boolean {
    return Boolean(this.panelWindow?.isOpen() && !this.panelWindow.isSuspendedForResident())
  }

  // 附着插件（使用 Panel 模式）
  attachPlugin(plugin: Plugin, featureCode: string, input?: InputPayload, route?: string, launchStart?: number, onLoadReady?: Promise<unknown>): boolean {
    if (!plugin.manifest.ui) return false

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) {
      log.error(`Plugin UI not found: ${uiPath}`)
      return false
    }

    if (launchStart) log.info(`[LaunchTrace] attachPlugin entered | +${Date.now() - launchStart}ms`)

    // 单例模式检查：如果 pluginSetting.single 为 true（默认），检查是否已有该插件的独立窗口
    const isSingleMode = plugin.manifest.pluginSetting?.single !== false
    if (isSingleMode) {
      // 查找已存在的该插件的独立窗口
      for (const info of this.detachedWindows.values()) {
        if (info.plugin.id === plugin.id) {
          const existingWindow = info.window
          if (existingWindow && !existingWindow.isDestroyed()) {
            // 已有独立窗口，显示并聚焦
            if (!existingWindow.isVisible()) {
              existingWindow.show()
            }
            if (existingWindow.isMinimized()) {
              existingWindow.restore()
            }
            existingWindow.focus()
            existingWindow.webContents.send('plugin:init', {
              pluginName: plugin.id,
              featureCode,
              input: input?.text || '',
              attachments: input?.attachments || [],
              mode: 'detached',
              route,
              nonce: Date.now()
            })
            return true
          }
        }
      }
    }

    // 关闭之前附着的插件（强制关闭，不走 resident 挂起；PluginManager.run() 已单独处理 resident）
    if (launchStart) log.info(`[LaunchTrace] closeAttached (prev plugin) start | +${Date.now() - launchStart}ms`)
    this.closeAttached(true)
    if (launchStart) log.info(`[LaunchTrace] closeAttached done | +${Date.now() - launchStart}ms`)

    this.attachedPlugin = {
      plugin,
      featureCode,
      route,
      input: input?.text || '',
      attachments: input?.attachments,
      startedAt: Date.now()
    }

    // 使用 Panel 模式（独立窗口跟随）
    if (!this.panelWindow) {
      log.error('[PluginWindowManager] Panel window not initialized')
      return false
    }

    if (launchStart) log.info(`[LaunchTrace] createPanel start | +${Date.now() - launchStart}ms`)
    const panelWin = this.panelWindow.createPanel(plugin, featureCode, input, route, launchStart, onLoadReady)
    if (!panelWin) {
      log.error('[PluginWindowManager] Failed to create panel window')
      this.attachedPlugin = null
      return false
    }
    if (launchStart) log.info(`[LaunchTrace] createPanel done | +${Date.now() - launchStart}ms`)

    // 通知渲染进程插件已打开（用于隐藏列表和调整窗口高度）
    this.mainWindow?.webContents.send('plugin:attach', {
      pluginName: plugin.id,
      displayName: plugin.manifest.displayName,
      featureCode,
      input: input?.text || '',
      attachments: input?.attachments,
      mode: 'panel'
    })
    if (launchStart) log.info(`[LaunchTrace] plugin:attach sent to renderer | +${Date.now() - launchStart}ms`)

    return true
  }

  /**
   * 挂起附着的插件面板（进入 resident-ui 状态）。
   * 隐藏窗口但保留 Renderer 上下文，不触发 handleWindowClosed 回调。
   * 返回被挂起的 pluginId，null 表示无可挂起的面板。
   */
  suspendAttached(): string | null {
    if (!this.attachedPlugin || !this.panelWindow?.isOpen()) {
      return null
    }

    const pluginId = this.attachedPlugin.plugin.id
    // Match the old closeAttached() focus handoff before hiding the focused
    // panel. Otherwise PluginPanelWindow's blur guard can hide the main window.
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus()
    }
    const suspended = this.panelWindow.suspend()
    if (!suspended) return null

    // 保留 attachedPlugin 元数据供 restore 使用
    // 清理主窗口 UI 状态（列表恢复、SubInput 关闭），但不触发 notifyPluginWindowClosed
    clearSubInputState()

    if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('subInput:disabled')
        this.mainWindow.webContents.send('plugin:detached')
      } catch {
        // Render frame may have been disposed
      }
    }

    return pluginId
  }

  /**
   * 尝试恢复 resident-ui 状态的面板。
   * 如果缓存的面板匹配 pluginId，直接 restore 并返回 true。
   */
  restoreAttachedIfResident(
    pluginId: string,
    featureCode: string,
    input?: InputPayload,
    route?: string
  ): boolean {
    const cachedId = this.panelWindow?.getCachedPluginId()
    if (!cachedId || cachedId !== pluginId) return false

    const restored = this.panelWindow!.restore(featureCode, input, route)
    if (!restored) return false

    // 重新通知渲染进程插件已附着
    const plugin = this.attachedPlugin?.plugin
    if (plugin && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('plugin:attach', {
        pluginName: plugin.id,
        displayName: plugin.manifest.displayName,
        featureCode,
        input: input?.text || '',
        attachments: input?.attachments,
        mode: 'panel'
      })
    }

    return true
  }

  /**
   * 强制驱逐 resident-ui 缓存（真正销毁面板窗口和上下文）。
   * 返回被驱逐的 pluginId，null 表示无缓存可驱逐。
   */
  evictResident(): string | null {
    const cachedId = this.panelWindow?.getCachedPluginId()
    if (!cachedId) return null

    log.info(`[ResidentUI] evict | plugin=${cachedId}`)
    this.attachedPlugin = null
    if (this.panelWindow?.isOpen()) {
      this.panelWindow.close()
    }
    clearSubInputState()
    return cachedId
  }

  /**
   * 关闭附着的插件。
   * @param force 强制关闭，跳过 resident-ui 挂起检查。
   *              由 disable/uninstall/reload/closePluginWindows 调用时传 true。
   */
  closeAttached(force = false): void {
    if (this.attachedPlugin || this.panelWindow?.isOpen()) {
      const pluginId = this.attachedPlugin?.plugin.id
      const featureCode = this.attachedPlugin?.featureCode || ''
      const route = this.attachedPlugin?.route

      // 拦截点：非强制关闭时，询问 PluginManager 是否应挂起为 resident-ui
      if (!force && pluginId && this.shouldSuspendOnCloseCallback?.(pluginId, featureCode, route)) {
        // 已由回调执行 suspendAttached()，不走 close 路径
        return
      }

      this.attachedPlugin = null

      if (this.panelWindow?.isOpen()) {
        this.panelWindow.close()
      }

      clearSubInputState()

      if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
        try {
          this.mainWindow.webContents.send('subInput:disabled')
          this.mainWindow.webContents.send('plugin:detached')
        } catch {
          // Render frame may have been disposed
        }
      }

      this.mainWindow?.focus()

      if (pluginId) {
        this.notifyPluginWindowClosed(pluginId)
      }
    }
  }

  // 分离当前附着的插件为独立窗口
  detachCurrent(): BrowserWindow | null {
    if (!this.attachedPlugin) return null

    const { plugin, featureCode, input, attachments, startedAt } = this.attachedPlugin
    this.attachedPlugin = null

    // 清理主进程中的 SubInput 状态
    clearSubInputState()

    // 通知渲染进程禁用 SubInput + 分离插件
    this.mainWindow?.webContents.send('subInput:disabled')
    this.mainWindow?.webContents.send('plugin:detached')

    // 使用 promoteToWindow 将面板升级为独立窗口
    if (this.panelWindow?.isOpen()) {
      const promoted = this.panelWindow.promoteToWindow()
      if (promoted) {
        const win = promoted.window
        const windowId = win.id
        this.detachedWindows.set(windowId, {
          window: win,
          pluginView: promoted.pluginView,
          plugin,
          featureCode,
          input,
          attachments,
          startedAt
        })
        registerProtectedWindow(windowId)
        this.updateDockVisibility()

        win.on('closed', () => {
          this.detachedWindows.delete(windowId)
          unregisterProtectedWindow(windowId)
          this.updateDockVisibility()
          this.notifyPluginWindowClosed(plugin.id)
        })

        return win
      }
    }

    // 如果 promoteToWindow 失败，创建新的独立窗口
    return this.createDetachedWindow(plugin, featureCode, { text: input, attachments: attachments || [] })
  }

  // 创建独立窗口
  createDetachedWindow(
    plugin: Plugin,
    featureCode: string,
    input?: InputPayload,
    route?: string
  ): BrowserWindow | null {
    if (!plugin.manifest.ui) return null

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) return null

    // 单例模式检查：如果 pluginSetting.single 为 true（默认），检查是否已有该插件的窗口
    const isSingleMode = plugin.manifest.pluginSetting?.single !== false
    if (isSingleMode) {
      // 查找已存在的该插件窗口
      for (const info of this.detachedWindows.values()) {
        if (info.plugin.id === plugin.id) {
          // 已有窗口，显示并聚焦
          const existingWindow = info.window
          if (existingWindow && !existingWindow.isDestroyed()) {
            if (!existingWindow.isVisible()) {
              existingWindow.show()
            }
            if (existingWindow.isMinimized()) {
              existingWindow.restore()
            }
            existingWindow.focus()
            // 发送新的输入和 feature 信息到插件视图
            const target = info.pluginView?.webContents ?? existingWindow.webContents
            if (!target.isDestroyed()) {
              target.send('plugin:init', {
                pluginName: plugin.id,
                featureCode,
                input: input?.text || '',
                attachments: input?.attachments || [],
                mode: 'detached',
                route,
                nonce: Date.now()
              })
            }
            return existingWindow
          }
        }
      }
    }

    // 根据当前主题设置窗口背景色，避免重载时闪白
    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const isDark = currentTheme === 'dark'
    const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
    const windowInsets = getWindowsFramelessSurfaceInsets()
    const toWindowWidth = (value: number | undefined) => value == null ? undefined : value + windowInsets.left + windowInsets.right
    const toWindowHeight = (value: number | undefined) => value == null ? undefined : value + windowInsets.top + windowInsets.bottom
    const backgroundColor = useWindowsFramelessSurface ? '#00000000' : (isDark ? '#1e293b' : '#ffffff')

    // 从 manifest.window 读取窗口配置
    const windowConfig = plugin.manifest.window || {}
    const windowType = windowConfig.type || 'default'
    const showTitleBar = shouldShowTitleBar(windowConfig)
    const isFullscreen = windowType === 'fullscreen'

    // 获取插件 preload 路径（支持自定义 preload）
    const basePreloadPath = join(__dirname, '../preload/index.js')
    const preloadPath = getPluginPreloadPath(basePreloadPath, plugin)
    const hasCustomPreload = !!plugin.manifest.preload

    // 全屏模式：获取主屏幕工作区大小
    const fullscreenBounds = isFullscreen ? screen.getPrimaryDisplay().workArea : null

    // 标题栏 preload 路径
    const titlebarPreloadPath = join(__dirname, '../preload/titlebar.js')

    // ===== WebContentsView 架构：BrowserWindow 加载标题栏，插件作为子视图 =====
    const windowWidth = isFullscreen ? fullscreenBounds!.width : toWindowWidth(windowConfig.width ?? 500)!
    const windowHeight = isFullscreen ? fullscreenBounds!.height : toWindowHeight((windowConfig.height ?? 400) + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!

    const win = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: isFullscreen ? fullscreenBounds!.x : undefined,
      y: isFullscreen ? fullscreenBounds!.y : undefined,
      minWidth: isFullscreen ? undefined : toWindowWidth(windowConfig.minWidth ?? 300)!,
      minHeight: isFullscreen ? undefined : toWindowHeight((windowConfig.minHeight ?? 200) + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!,
      maxWidth: isFullscreen ? undefined : toWindowWidth(windowConfig.maxWidth),
      maxHeight: isFullscreen ? undefined : toWindowHeight(windowConfig.maxHeight != null ? windowConfig.maxHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0) : undefined),
      show: false,
      frame: false,
      fullscreen: isFullscreen,
      fullscreenable: isFullscreen,
      thickFrame: !useWindowsFramelessSurface,
      backgroundColor: (windowConfig.transparent || useWindowsFramelessSurface) ? '#00000000' : backgroundColor,
      transparent: windowConfig.transparent || useWindowsFramelessSurface,
      hasShadow: windowConfig.transparent ? false : !useWindowsFramelessSurface,
      title: plugin.manifest.displayName,
      webPreferences: showTitleBar ? {
        preload: titlebarPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
      } : {
        // 无标题栏时，BrowserWindow 直接加载插件
        preload: preloadPath,
        additionalArguments: ['--mulby-plugin-window'],
        contextIsolation: !hasCustomPreload,
        nodeIntegration: hasCustomPreload,
        sandbox: !hasCustomPreload,
        v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
      }
    })

    // 创建插件 WebContentsView（仅在需要标题栏时）
    let pluginView: WebContentsView | null = null

    if (showTitleBar) {
      // BrowserWindow 加载标题栏页面
      const titlebarPath = this.getDetachedTitlebarPath()
      if (titlebarPath) {
        win.loadFile(titlebarPath)
      }

      // 创建插件内容 WebContentsView
      pluginView = new WebContentsView({
        webPreferences: {
          preload: preloadPath,
          additionalArguments: ['--mulby-plugin-window'],
          contextIsolation: !hasCustomPreload,
          nodeIntegration: hasCustomPreload,
          sandbox: !hasCustomPreload,
          v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
        }
      })

      // 添加子视图并布局
      win.contentView.addChildView(pluginView)
      layoutPluginView(win, pluginView, true)

      // 注册 WebContentsView → BrowserWindow 映射
      registerView(pluginView, win)

      // 加载插件 UI
      if (route) {
        void pluginView.webContents.loadFile(uiPath, { hash: route })
      } else {
        void pluginView.webContents.loadFile(uiPath)
      }

      // 设置标题栏 IPC
      setupTitlebarIPC(win, pluginView, this.themeManager)

      // 窗口 resize 时更新插件视图布局
      win.on('resize', () => {
        if (!win.isDestroyed() && pluginView && !pluginView.webContents.isDestroyed()) {
          layoutPluginView(win, pluginView, true)
        }
      })
    } else {
      // 无标题栏：BrowserWindow 直接加载插件
      if (route) {
        void win.loadFile(uiPath, { hash: route })
      } else {
        win.loadFile(uiPath)
      }

      // 监听窗口状态变化，通知渲染进程
      win.on('maximize', () => {
        win.webContents.send('window:stateChanged', { isMaximized: true })
      })
      win.on('unmaximize', () => {
        win.webContents.send('window:stateChanged', { isMaximized: false })
      })
    }

    // 目标 webContents（插件内容）
    const pluginWebContents = pluginView?.webContents ?? win.webContents

    win.once('ready-to-show', async () => {
      if (showTitleBar) {
        // WebContentsView 架构：初始化标题栏
        initTitlebar(win, plugin.manifest.displayName, currentTheme)
      }
      if (useWindowsFramelessSurface) {
        // 标题栏已独立，不需要 surface 注入 padding-top
        await applyWindowsFramelessSurface(win, { includeTitleBar: false })
        if (win.isDestroyed()) return
      }
      // 应用 manifest.window.opacity 初始透明度
      if (windowConfig.opacity !== undefined) {
        win.setOpacity(Math.max(0, Math.min(1, windowConfig.opacity)))
      }
      win.show()
      if (this.shouldOpenPluginDevTools()) {
        pluginWebContents.openDevTools({ mode: 'detach' })
      }
    })

    // 等待插件内容加载完成后，发送 plugin:init 和 theme 信息
    pluginWebContents.on('did-finish-load', async () => {
      if (useWindowsFramelessSurface && !win.isDestroyed()) {
        await applyWindowsFramelessSurface(win, { includeTitleBar: false })
      }
      // 延迟确保 React useEffect 已注册 IPC 回调
      setTimeout(() => {
        if (win.isDestroyed() || pluginWebContents.isDestroyed()) return
        pluginWebContents.send('plugin:init', {
          pluginName: plugin.id,
          featureCode,
          input: input?.text || '',
          attachments: input?.attachments,
          mode: 'detached',
          windowType,
          route,
          nonce: Date.now()
        })
        if (this.themeManager) {
          pluginWebContents.send('theme:changed', this.themeManager.getActualTheme())
          if (showTitleBar) {
            notifyTitlebarThemeChange(win, this.themeManager.getActualTheme())
          }
        }
      }, 100)
    })

    // 注册窗口到主题管理器
    if (this.themeManager) {
      this.themeManager.registerWindow(win)
    }

    const windowId = win.id
    this.detachedWindows.set(windowId, {
      window: win,
      pluginView: pluginView ?? undefined,
      plugin,
      featureCode,
      input: input?.text || '',
      attachments: input?.attachments,
      startedAt: Date.now()
    })

    registerPluginWindow(windowId, plugin.id)
    registerProtectedWindow(windowId)

    void this.updateDockVisibility()

    installConsoleCapture(win, plugin.id)

    pluginWebContents.on('render-process-gone', (_event, details) => {
      loggerService.crash({
        pluginId: plugin.id,
        reason: details.reason,
        exitCode: details.exitCode,
        windowId: win.id
      })
      log.error('[PluginWindowManager] Render process gone:', plugin.id, details.reason)
    })

    win.on('closed', () => {
      this.detachedWindows.delete(windowId)
      unregisterPluginWindow(windowId)
      unregisterProtectedWindow(windowId)
      if (pluginView && !pluginView.webContents.isDestroyed()) {
        pluginView.webContents.close()
      }
      this.updateDockVisibility()
      this.notifyPluginWindowClosed(plugin.id)
    })

    return win
  }

  // 创建辅助窗口（同插件的子窗口）
  createAuxiliaryWindow(
    plugin: Plugin,
    path: string, // 路由路径，如 /img-editor
    options?: AuxiliaryWindowOptions,
    creatorId?: number  // 创建此窗口的父窗口 ID
  ): BrowserWindow | null {
    if (!plugin.manifest.ui) return null

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) return null

    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const isDark = currentTheme === 'dark'
    const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
    const windowInsets = getWindowsFramelessSurfaceInsets()
    const toWindowWidth = (value: number | undefined) => value == null ? undefined : value + windowInsets.left + windowInsets.right
    const toWindowHeight = (value: number | undefined) => value == null ? undefined : value + windowInsets.top + windowInsets.bottom
    const backgroundColor = useWindowsFramelessSurface ? '#00000000' : (isDark ? '#1e293b' : '#ffffff')

    // 从 manifest.window 读取窗口配置（辅助窗口优先使用传入的 options）
    const windowConfig = plugin.manifest.window || {}
    // 子窗口的 type/titleBar 优先使用 options 传入值，否则回退到 manifest
    const resolvedWindowConfig: WindowOptions = {
      ...windowConfig,
      type: options?.type ?? windowConfig.type ?? 'default',
      titleBar: options?.titleBar ?? windowConfig.titleBar,
    }
    const showTitleBar = shouldShowTitleBar(resolvedWindowConfig)
    const windowType = resolvedWindowConfig.type || 'default'
    const isFullscreen = options?.fullscreen === true || windowType === 'fullscreen'
    // 透明度相关：options 优先于 manifest
    const resolvedTransparent = options?.transparent ?? windowConfig.transparent ?? false
    const resolvedOpacity = options?.opacity ?? windowConfig.opacity

    // 获取插件 preload 路径（支持自定义 preload）
    const basePreloadPath = join(__dirname, '../preload/index.js')
    const preloadPath = getPluginPreloadPath(basePreloadPath, plugin)
    const hasCustomPreload = !!plugin.manifest.preload

    // 全屏模式：获取主屏幕工作区大小
    const fullscreenBounds = isFullscreen ? screen.getPrimaryDisplay().workArea : null

    // 标题栏 preload 路径
    const titlebarPreloadPath = join(__dirname, '../preload/titlebar.js')

    const baseWidth = options?.width || windowConfig.width || 800
    const baseHeight = options?.height || windowConfig.height || 600

    const win = new BrowserWindow({
      width: isFullscreen ? fullscreenBounds!.width : toWindowWidth(baseWidth)!,
      height: isFullscreen ? fullscreenBounds!.height : toWindowHeight(baseHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!,
      x: isFullscreen ? fullscreenBounds!.x : options?.x,
      y: isFullscreen ? fullscreenBounds!.y : options?.y,
      minWidth: isFullscreen ? undefined : toWindowWidth(options?.minWidth ?? windowConfig.minWidth ?? 300)!,
      minHeight: isFullscreen ? undefined : toWindowHeight((options?.minHeight ?? windowConfig.minHeight ?? 200) + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!,
      maxWidth: isFullscreen ? undefined : toWindowWidth(options?.maxWidth ?? windowConfig.maxWidth),
      maxHeight: isFullscreen ? undefined : toWindowHeight((options?.maxHeight ?? windowConfig.maxHeight) != null ? ((options?.maxHeight ?? windowConfig.maxHeight)! + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0)) : undefined),
      show: false,
      frame: false,
      fullscreen: isFullscreen,
      fullscreenable: isFullscreen,
      alwaysOnTop: options?.alwaysOnTop,
      resizable: options?.resizable,
      thickFrame: !useWindowsFramelessSurface,
      backgroundColor: (resolvedTransparent || useWindowsFramelessSurface) ? '#00000000' : backgroundColor,
      transparent: resolvedTransparent || useWindowsFramelessSurface,
      hasShadow: resolvedTransparent ? false : !useWindowsFramelessSurface,
      title: options?.title || plugin.manifest.displayName,
      webPreferences: showTitleBar ? {
        preload: titlebarPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
      } : {
        preload: preloadPath,
        additionalArguments: ['--mulby-plugin-window'],
        contextIsolation: !hasCustomPreload,
        nodeIntegration: hasCustomPreload,
        sandbox: !hasCustomPreload,
        v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
      }
    })

    // 加载页面，附加 hash 路由
    const hash = path.startsWith('/') ? path.substring(1) : path

    // 创建插件 WebContentsView（仅在需要标题栏时）
    let pluginView: WebContentsView | null = null

    if (showTitleBar) {
      // BrowserWindow 加载标题栏页面
      const titlebarPath = this.getDetachedTitlebarPath()
      if (titlebarPath) {
        win.loadFile(titlebarPath)
      }

      // 创建插件内容 WebContentsView
      pluginView = new WebContentsView({
        webPreferences: {
          preload: preloadPath,
          additionalArguments: ['--mulby-plugin-window'],
          contextIsolation: !hasCustomPreload,
          nodeIntegration: hasCustomPreload,
          sandbox: !hasCustomPreload,
          v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
        }
      })

      win.contentView.addChildView(pluginView)
      layoutPluginView(win, pluginView, true)
      registerView(pluginView, win)

      // 加载插件 UI
      void pluginView.webContents.loadFile(uiPath, { hash })

      // 设置标题栏 IPC
      setupTitlebarIPC(win, pluginView, this.themeManager)

      // 窗口 resize 时更新插件视图布局
      win.on('resize', () => {
        if (!win.isDestroyed() && pluginView && !pluginView.webContents.isDestroyed()) {
          layoutPluginView(win, pluginView, true)
        }
      })
    } else {
      // 无标题栏：BrowserWindow 直接加载插件
      win.loadFile(uiPath, { hash })

      // 窗口状态事件
      win.on('maximize', () => win.webContents.send('window:stateChanged', { isMaximized: true }))
      win.on('unmaximize', () => win.webContents.send('window:stateChanged', { isMaximized: false }))
    }

    // 目标 webContents（插件内容）
    const pluginWebContents = pluginView?.webContents ?? win.webContents

    win.once('ready-to-show', async () => {
      if (showTitleBar) {
        initTitlebar(win, options?.title || plugin.manifest.displayName, currentTheme)
      }
      if (useWindowsFramelessSurface) {
        await applyWindowsFramelessSurface(win, { includeTitleBar: false })
        if (win.isDestroyed()) return
      }
      win.show()
      // 应用初始透明度
      if (resolvedOpacity !== undefined) {
        win.setOpacity(Math.max(0, Math.min(1, resolvedOpacity)))
      }
      if (this.shouldOpenPluginDevTools()) {
        pluginWebContents.openDevTools({ mode: 'detach' })
      }
    })

    // 等待插件内容加载完成后，再发送初始化数据和主题
    pluginWebContents.on('did-finish-load', async () => {
      if (useWindowsFramelessSurface && !win.isDestroyed()) {
        await applyWindowsFramelessSurface(win, { includeTitleBar: false })
      }
      // 延迟确保 React useEffect 已注册 IPC 回调
      setTimeout(() => {
        if (win.isDestroyed() || pluginWebContents.isDestroyed()) return
        pluginWebContents.send('plugin:init', {
          pluginName: plugin.id,
          featureCode: '', // 辅助窗口没有 featureCode
          input: '',
          attachments: [],
          mode: 'detached',
          windowType,
          route: path, // 额外字段，通知前端跳转
          nonce: Date.now()
        })
        if (this.themeManager) {
          pluginWebContents.send('theme:changed', this.themeManager.getActualTheme())
          if (showTitleBar) {
            notifyTitlebarThemeChange(win, this.themeManager.getActualTheme())
          }
        }
      }, 100)
    })

    if (this.themeManager) {
      this.themeManager.registerWindow(win)
    }

    const windowId = win.id
    this.detachedWindows.set(windowId, {
      window: win,
      pluginView: pluginView ?? undefined,
      plugin,
      featureCode: '',
      input: '',
      attachments: [],
      startedAt: Date.now(),
      creatorId
    })

    registerPluginWindow(windowId, plugin.id)
    registerProtectedWindow(windowId)

    this.updateDockVisibility()

    installConsoleCapture(win, plugin.id)

    win.on('closed', () => {
      this.detachedWindows.delete(windowId)
      unregisterPluginWindow(windowId)
      unregisterProtectedWindow(windowId)
      if (pluginView && !pluginView.webContents.isDestroyed()) {
        pluginView.webContents.close()
      }
      this.updateDockVisibility()
      this.notifyPluginWindowClosed(plugin.id)
    })

    return win
  }

  // 关闭指定独立窗口
  closeDetached(windowId: number): void {
    const info = this.detachedWindows.get(windowId)
    if (info) {
      unregisterPluginWindow(windowId)
      if (!info.window.isDestroyed()) {
        info.window.close()
      }
    }
  }

  // 关闭指定插件的所有独立窗口
  closeDetachedWindowsByPlugin(pluginId: string): void {
    for (const [windowId, info] of this.detachedWindows.entries()) {
      if (info.plugin.id === pluginId) {
        unregisterPluginWindow(windowId)
        if (!info.window.isDestroyed()) {
          info.window.close()
        }
      }
    }
  }

  // 获取所有独立窗口
  getAllDetachedWindows(): BrowserWindow[] {
    return Array.from(this.detachedWindows.values())
      .map(info => info.window)
      .filter(win => !win.isDestroyed())
  }

  // 获取所有独立窗口信息
  getAllDetachedInfos(): DetachedWindowInfo[] {
    return Array.from(this.detachedWindows.values())
      .filter(info => !info.window.isDestroyed())
  }

  // 获取当前所有可见/存活窗口对应的插件（用于任务管理器）
  getActiveWindowPlugins(): Array<{ pluginId: string; pluginName: string; displayName: string; startedAt: number }> {
    const byPlugin = new Map<string, { pluginId: string; pluginName: string; displayName: string; startedAt: number }>()

    if (this.attachedPlugin && this.panelWindow?.isOpen() && !this.panelWindow.isSuspendedForResident()) {
      const current = this.attachedPlugin
      byPlugin.set(current.plugin.id, {
        pluginId: current.plugin.id,
        pluginName: current.plugin.manifest.name,
        displayName: current.plugin.manifest.displayName,
        startedAt: current.startedAt
      })
    }

    for (const info of this.detachedWindows.values()) {
      if (info.window.isDestroyed()) continue
      const existing = byPlugin.get(info.plugin.id)
      if (existing) {
        existing.startedAt = Math.min(existing.startedAt, info.startedAt)
        continue
      }
      byPlugin.set(info.plugin.id, {
        pluginId: info.plugin.id,
        pluginName: info.plugin.manifest.name,
        displayName: info.plugin.manifest.displayName,
        startedAt: info.startedAt
      })
    }

    return Array.from(byPlugin.values())
  }

  closeAll(): void {
    this.closeAttached(true)
    for (const [windowId, info] of this.detachedWindows.entries()) {
      unregisterPluginWindow(windowId)
      unregisterProtectedWindow(windowId)
      if (!info.window.isDestroyed()) {
        info.window.close()
      }
    }
    this.detachedWindows.clear()
  }

  // 设置窗口置顶
  setAlwaysOnTop(windowId: number, flag: boolean): void {
    const info = this.detachedWindows.get(windowId)
    if (info && !info.window.isDestroyed()) {
      info.window.setAlwaysOnTop(flag)
    }
  }

  // 获取面板窗口管理器
  getPanelWindow(): PluginPanelWindow | null {
    return this.panelWindow
  }

  // 隐藏面板窗口（但不关闭）
  hidePanelWindow(): void {
    this.panelWindow?.hide()
  }

  // 显示面板窗口
  showPanelWindow(): void {
    this.panelWindow?.show()
  }

  /**
   * 隐藏主搜索框窗口（preCapture 截图前调用）
   * 隐藏主窗口 + 面板窗口，确保截图不会包含搜索框
   */
  hideMainWindowForCapture(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.panelWindow?.hide()
      this.mainWindow.hide()
    }
  }

  /**
   * 恢复主搜索框窗口（preCapture 截图后调用）
   * 仅在需要时恢复显示（某些截图流程后不需要恢复）
   */
  showMainWindowAfterCapture(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show()
      this.mainWindow.focus()
      if (!this.panelWindow?.isSuspendedForResident()) {
        this.panelWindow?.show()
      }
    }
  }

  // 根据窗口实例获取关联的插件
  getPluginByWindow(win: BrowserWindow): Plugin | null {
    if (!win) return null

    // 检查是否为独立窗口
    const detachedInfo = this.detachedWindows.get(win.id)
    if (detachedInfo) return detachedInfo.plugin

    // 检查是否为面板窗口
    const panelWin = this.panelWindow?.getWindow()
    if (panelWin && panelWin.id === win.id) {
      if (this.panelWindow?.isSuspendedForResident()) return null
      return this.attachedPlugin?.plugin || null
    }

    return null
  }

  // 获取窗口的父窗口 ID
  getParentWindowId(windowId: number): number | null {
    const info = this.detachedWindows.get(windowId)
    return info?.creatorId ?? null
  }

  private notifyPluginWindowClosed(pluginId: string): void {
    if (!this.onWindowClosedCallback) return
    if (this.hasOpenWindowsForPlugin(pluginId)) return

    this.onWindowClosedCallback(pluginId).catch(err => {
      log.error('[PluginWindowManager] Error in window closed callback:', err)
    })
  }

  /**
   * 获取插件当前最合适的 BrowserWindow，用于作为系统对话框的 parent。
   * 查找顺序：detached window → panel window → main window
   */
  getPluginWindow(pluginId: string): BrowserWindow | null {
    for (const info of this.detachedWindows.values()) {
      if (info.plugin.id === pluginId && !info.window.isDestroyed()) {
        return info.window
      }
    }
    if (this.attachedPlugin?.plugin.id === pluginId
        && this.panelWindow?.isOpen()
        && !this.panelWindow.isSuspendedForResident()) {
      const panelWin = this.panelWindow.getWindow()
      if (panelWin && !panelWin.isDestroyed()) return panelWin
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow
    return null
  }

  hasOpenWindowsForPlugin(pluginId: string): boolean {
    if (this.attachedPlugin?.plugin.id === pluginId
        && this.panelWindow?.isOpen()
        && !this.panelWindow.isSuspendedForResident()) {
      return true
    }

    for (const info of this.detachedWindows.values()) {
      if (info.plugin.id === pluginId && !info.window.isDestroyed()) {
        return true
      }
    }

    return false
  }
}

/**
 * 判断窗口是否应该显示 Mulby 标题栏
 * - default 类型：默认显示（除非 titleBar 显式设为 false）
 * - borderless / fullscreen 类型：默认不显示（除非 titleBar 显式设为 true）
 */
function shouldShowTitleBar(windowConfig: WindowOptions): boolean {
  const windowType = windowConfig.type || 'default'
  if (windowConfig.titleBar !== undefined) {
    return windowConfig.titleBar
  }
  return windowType === 'default'
}
