import { BrowserWindow, app, Menu } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { InputAttachment, InputPayload, Plugin } from '../../shared/types/plugin'
import { ThemeManager } from '../services/theme'
import { injectCustomTitleBar } from './titlebar'
import { PluginPanelWindow } from './panel-window'
import { clearSubInputState } from '../services/subinput-state'

interface AttachedPlugin {
  plugin: Plugin
  featureCode: string
  input: string
  attachments?: InputAttachment[]
}

interface DetachedWindowInfo {
  window: BrowserWindow
  plugin: Plugin
  featureCode: string
  input: string
  attachments?: InputAttachment[]
  creatorId?: number  // 创建此窗口的父窗口 ID
}

export class PluginWindowManager {
  private mainWindow: BrowserWindow | null = null
  private themeManager: ThemeManager | null = null
  private attachedPlugin: AttachedPlugin | null = null
  private detachedWindows: Map<number, DetachedWindowInfo> = new Map()
  private dockVisible = false

  // 面板窗口管理器（跟随搜索框的插件窗口）
  private panelWindow: PluginPanelWindow | null = null

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

  // 获取附着的插件信息
  getAttachedPlugin(): AttachedPlugin | null {
    return this.attachedPlugin
  }

  // 是否有附着的插件
  hasAttachedPlugin(): boolean {
    return this.panelWindow?.isOpen() ?? false
  }

  // 附着插件（使用 Panel 模式）
  attachPlugin(plugin: Plugin, featureCode: string, input?: InputPayload, route?: string): boolean {
    if (!plugin.manifest.ui) return false

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) {
      console.error(`Plugin UI not found: ${uiPath}`)
      return false
    }

    // 关闭之前附着的插件
    this.closeAttached()

    this.attachedPlugin = {
      plugin,
      featureCode,
      input: input?.text || '',
      attachments: input?.attachments
    }

    // 使用 Panel 模式（独立窗口跟随）
    if (!this.panelWindow) {
      console.error('[PluginWindowManager] Panel window not initialized')
      return false
    }

    const panelWin = this.panelWindow.createPanel(plugin, featureCode, input, route)
    if (!panelWin) {
      console.error('[PluginWindowManager] Failed to create panel window')
      this.attachedPlugin = null
      return false
    }

    // 通知渲染进程插件已打开（用于隐藏列表和调整窗口高度）
    this.mainWindow?.webContents.send('plugin:attach', {
      pluginName: plugin.id,
      displayName: plugin.manifest.displayName,
      featureCode,
      input: input?.text || '',
      attachments: input?.attachments,
      mode: 'panel'
    })

    return true
  }

  // 关闭附着的插件
  closeAttached(): void {
    if (this.attachedPlugin || this.panelWindow?.isOpen()) {
      this.attachedPlugin = null

      // 关闭 Panel 窗口
      if (this.panelWindow?.isOpen()) {
        this.panelWindow.close()
      }

      // 清理主进程中的 SubInput 状态
      clearSubInputState()

      // 通知渲染进程禁用 SubInput（重置搜索框状态）
      this.mainWindow?.webContents.send('subInput:disabled')

      // 通知渲染进程插件已分离
      this.mainWindow?.webContents.send('plugin:detached')

      // 关闭插件后聚焦主窗口，使搜索框获得焦点
      this.mainWindow?.focus()
    }
  }

  // 分离当前附着的插件为独立窗口
  detachCurrent(): BrowserWindow | null {
    if (!this.attachedPlugin) return null

    const { plugin, featureCode, input, attachments } = this.attachedPlugin
    this.attachedPlugin = null

    // 清理主进程中的 SubInput 状态
    clearSubInputState()

    // 通知渲染进程禁用 SubInput + 分离插件
    this.mainWindow?.webContents.send('subInput:disabled')
    this.mainWindow?.webContents.send('plugin:detached')

    // 使用 promoteToWindow 将面板升级为独立窗口
    if (this.panelWindow?.isOpen()) {
      const win = this.panelWindow.promoteToWindow()
      if (win) {
        // 注册到 detachedWindows
        const windowId = win.id
        this.detachedWindows.set(windowId, {
          window: win,
          plugin,
          featureCode,
          input,
          attachments
        })
        this.updateDockVisibility()

        win.on('closed', () => {
          this.detachedWindows.delete(windowId)
          this.updateDockVisibility()
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
      for (const [_, info] of this.detachedWindows) {
        if (info.plugin.id === plugin.id) {
          // 已有窗口，聚焦并返回现有窗口
          const existingWindow = info.window
          if (existingWindow && !existingWindow.isDestroyed()) {
            if (existingWindow.isMinimized()) {
              existingWindow.restore()
            }
            existingWindow.focus()
            // 发送新的输入和 feature 信息
            existingWindow.webContents.send('plugin:init', {
              pluginName: plugin.id,
              featureCode,
              input: input?.text || '',
              attachments: input?.attachments || [],
              mode: 'detached',
              route
            })
            return existingWindow
          }
        }
      }
    }

    // 根据当前主题设置窗口背景色，避免重载时闪白
    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const isDark = currentTheme === 'dark'
    const backgroundColor = isDark ? '#1e293b' : '#ffffff'

    // 从 manifest.window 读取窗口配置
    const windowConfig = plugin.manifest.window || {}

    const win = new BrowserWindow({
      width: windowConfig.width ?? 500,
      height: windowConfig.height ?? 400,
      minWidth: windowConfig.minWidth ?? 300,
      minHeight: windowConfig.minHeight ?? 200,
      maxWidth: windowConfig.maxWidth,
      maxHeight: windowConfig.maxHeight,
      show: false,
      frame: false,
      backgroundColor,
      title: plugin.manifest.displayName,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    if (route) {
      void win.loadFile(uiPath, { hash: route })
    } else {
      win.loadFile(uiPath)
    }

    win.once('ready-to-show', async () => {
      // 注入自定义标题栏
      await injectCustomTitleBar(win, plugin.manifest.displayName, currentTheme)
      win.show()
      // TODO: 自动开启开发者工具，后面要根据开关启用和关闭
      win.webContents.openDevTools({ mode: 'detach' })
      win.webContents.send('plugin:init', {
        pluginName: plugin.id,
        featureCode,
        input: input?.text || '',
        attachments: input?.attachments,
        mode: 'detached',
        route
      })
      // 发送初始主题
      if (this.themeManager) {
        win.webContents.send('theme:changed', this.themeManager.getActualTheme())
      }
    })

    // 监听窗口状态变化，通知渲染进程
    win.on('maximize', () => {
      win.webContents.send('window:stateChanged', { isMaximized: true })
    })
    win.on('unmaximize', () => {
      win.webContents.send('window:stateChanged', { isMaximized: false })
    })

    // 监听页面重载，重新注入标题栏
    win.webContents.on('did-finish-load', async () => {
      // 检查标题栏是否已存在，避免首次加载时重复注入
      const hasTitleBar = await win.webContents.executeJavaScript(
        'document.getElementById("intools-titlebar") !== null'
      )
      if (!hasTitleBar) {
        const theme = this.themeManager?.getActualTheme() || 'dark'
        await injectCustomTitleBar(win, plugin.manifest.displayName, theme)
      }
    })

    // 注册窗口到主题管理器
    if (this.themeManager) {
      this.themeManager.registerWindow(win)
    }

    const windowId = win.id
    this.detachedWindows.set(windowId, {
      window: win,
      plugin,
      featureCode,
      input: input?.text || '',
      attachments: input?.attachments
    })

    // 显示 Dock 图标
    this.updateDockVisibility()

    win.on('closed', () => {
      this.detachedWindows.delete(windowId)
      // 检查是否需要隐藏 Dock 图标
      this.updateDockVisibility()
    })

    return win
  }

  // 创建辅助窗口（同插件的子窗口）
  createAuxiliaryWindow(
    plugin: Plugin,
    path: string, // 路由路径，如 /img-editor
    options?: { width?: number; height?: number; title?: string },
    creatorId?: number  // 创建此窗口的父窗口 ID
  ): BrowserWindow | null {
    if (!plugin.manifest.ui) return null

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) return null

    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const isDark = currentTheme === 'dark'
    const backgroundColor = isDark ? '#1e293b' : '#ffffff'

    // 从 manifest.window 读取窗口配置（辅助窗口优先使用传入的 options）
    const windowConfig = plugin.manifest.window || {}

    const win = new BrowserWindow({
      width: options?.width || windowConfig.width || 800,
      height: options?.height || windowConfig.height || 600,
      minWidth: windowConfig.minWidth ?? 300,
      minHeight: windowConfig.minHeight ?? 200,
      maxWidth: windowConfig.maxWidth,
      maxHeight: windowConfig.maxHeight,
      show: false,
      frame: false,
      backgroundColor,
      title: options?.title || plugin.manifest.displayName,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // 加载页面，附加 hash 路由
    // 如果 path 以 / 开头，作为 hash 加载
    const hash = path.startsWith('/') ? path.substring(1) : path
    // 开发环境如果使用了 loadURL (e.g. vite dev server)
    if (process.env.VITE_DEV_SERVER_URL || (process.env.NODE_ENV === 'development' && !app.isPackaged)) {
      win.loadFile(uiPath, { hash })
    } else {
      win.loadFile(uiPath, { hash })
    }

    win.once('ready-to-show', async () => {
      await injectCustomTitleBar(win, options?.title || plugin.manifest.displayName, currentTheme)
      win.show()
      // win.webContents.openDevTools({ mode: 'detach' }) // Optional

      // 发送初始化消息，让插件知道自己在哪个路由
      win.webContents.send('plugin:init', {
        pluginName: plugin.id,
        featureCode: '', // 辅助窗口没有 featureCode
        input: '',
        attachments: [],
        mode: 'detached',
        route: path // 额外字段，通知前端跳转
      })

      if (this.themeManager) {
        win.webContents.send('theme:changed', this.themeManager.getActualTheme())
      }
    })

    // 窗口状态事件
    win.on('maximize', () => win.webContents.send('window:stateChanged', { isMaximized: true }))
    win.on('unmaximize', () => win.webContents.send('window:stateChanged', { isMaximized: false }))

    // 页面加载完成
    win.webContents.on('did-finish-load', async () => {
      const hasTitleBar = await win.webContents.executeJavaScript('document.getElementById("intools-titlebar") !== null')
      if (!hasTitleBar) {
        const theme = this.themeManager?.getActualTheme() || 'dark'
        await injectCustomTitleBar(win, options?.title || plugin.manifest.displayName, theme)
      }
    })

    if (this.themeManager) {
      this.themeManager.registerWindow(win)
    }

    const windowId = win.id
    this.detachedWindows.set(windowId, {
      window: win,
      plugin,
      featureCode: '',
      input: '',
      attachments: [],
      creatorId  // 记录创建者
    })

    this.updateDockVisibility()
    win.on('closed', () => {
      this.detachedWindows.delete(windowId)
      this.updateDockVisibility()
    })

    return win
  }

  // 关闭指定独立窗口
  closeDetached(windowId: number): void {
    const info = this.detachedWindows.get(windowId)
    if (info && !info.window.isDestroyed()) {
      info.window.close()
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

  // 关闭所有窗口
  closeAll(): void {
    this.closeAttached()
    for (const info of this.detachedWindows.values()) {
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

  // 根据窗口实例获取关联的插件
  getPluginByWindow(win: BrowserWindow): Plugin | null {
    if (!win) return null

    // 检查是否为独立窗口
    const detachedInfo = this.detachedWindows.get(win.id)
    if (detachedInfo) return detachedInfo.plugin

    // 检查是否为面板窗口
    const panelWin = this.panelWindow?.getWindow()
    if (panelWin && panelWin.id === win.id) {
      return this.attachedPlugin?.plugin || null
    }

    return null
  }

  // 获取窗口的父窗口 ID
  getParentWindowId(windowId: number): number | null {
    const info = this.detachedWindows.get(windowId)
    return info?.creatorId ?? null
  }
}
