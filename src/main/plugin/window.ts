import { BrowserWindow, app, screen, WebContentsView } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { InputAttachment, InputPayload, Plugin, PluginLaunchMode, WindowOptions } from '../../shared/types/plugin'
import { ThemeManager } from '../services/theme'
import { loggerService } from '../services/logger'
import { installConsoleCaptureForWebContents } from './console-capture'
import { appSettingsManager } from '../services/app-settings'
import { PluginPanelWindow } from './panel-window'
import { clearSubInputState, isSubInputEnabled } from '../services/subinput-state'
import { getPluginPreloadPath, getPluginPreloadPathForEntry } from './plugin-preload-wrapper'
import {
  PLUGIN_RENDERER_V8_CACHE_OPTIONS,
  getPluginRendererCapabilities,
  getPluginRendererWebPreferences,
  installPluginWebviewSecurity
} from './plugin-web-preferences'
import {
  applyWindowResizeHandlesToWebContents,
  applyWindowsFramelessSurface,
  getWindowsFramelessSurfaceInsets,
  shouldUseWindowsFramelessSurface
} from '../services/window-surface'
import { registerView, getPluginWebContents } from '../services/webcontents-registry'
import { registerPluginWindow, unregisterPluginWindow } from '../services/ipc-caller-resolver'
import { resolvePluginWindowIcon } from '../services/window-icon'
import { registerWindowsInputTargetWindow, unregisterWindowsInputTargetWindow } from '../services/windows-input-target-window'
import { registerProtectedWindow, unregisterProtectedWindow } from './input'
import { installPluginViewFocusBridge } from './plugin-view-focus-bridge'
import {
  DETACHED_TITLEBAR_HEIGHT,
  setupTitlebarIPC,
  initTitlebar,
  notifyTitlebarThemeChange,
  layoutPluginView
} from './titlebar-view'
import { formatPayloadTrace } from '../../shared/attachment-trace'
import log from 'electron-log'
import { pinWindowSize, unpinWindowSize } from '../services/window-size-pin'
import {
  createAuxiliaryLoadFileOptions,
  parseAuxiliaryPath,
  resolveLegacyAuxiliaryFileEntry
} from './window-path'
import {
  resolveAuxiliaryWindowBackgroundThrottling,
  resolveAuxiliaryWindowSizeLimits
} from './auxiliary-window-options'
import type { MacDockPluginWindowSnapshot } from '../services/mac-dock-presentation-model'

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
  route?: string
  resident?: boolean
  input: string
  attachments?: InputAttachment[]
  startedAt: number
  lastFocusedAt: number
  creatorId?: number  // 创建此窗口的父窗口 ID
}

export interface PluginLaunchTarget {
  plugin: Plugin
  featureCode: string
  mode: PluginLaunchMode
  route?: string
}

interface ResidentPanelInfo {
  panelWindow: PluginPanelWindow
  attachedPlugin: AttachedPlugin
}

interface DetachedWindowCreateOptions {
  hiddenResident?: boolean
}

// 子窗口创建选项
interface AuxiliaryWindowOptions {
  width?: number
  height?: number
  title?: string
  loadMode?: 'route' | 'file'
  preload?: string
  type?: 'default' | 'borderless' | 'fullscreen'
  titleBar?: boolean
  fullscreen?: boolean
  alwaysOnTop?: boolean
  alwaysOnTopLevel?: string
  resizable?: boolean
  movable?: boolean
  minimizable?: boolean
  maximizable?: boolean
  fullscreenable?: boolean
  focusable?: boolean
  skipTaskbar?: boolean
  enableLargerThanScreen?: boolean
  x?: number
  y?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  inheritWindowSizeLimits?: boolean
  opacity?: number
  transparent?: boolean
  backgroundThrottling?: boolean
  visibleOnAllWorkspaces?: boolean
  visibleOnFullScreen?: boolean
  ignoreMouseEvents?: boolean
  forwardMouseEvents?: boolean
  params?: Record<string, string>
}

export class PluginWindowManager {
  private mainWindow: BrowserWindow | null = null
  private themeManager: ThemeManager | null = null
  private attachedPlugin: AttachedPlugin | null = null
  private detachedWindows: Map<number, DetachedWindowInfo> = new Map()
  private dockPresentationRefreshHandler?: () => void | Promise<void>
  private onWindowClosedCallback?: (pluginId: string) => Promise<void>
  /**
   * 回调：attached panel 即将关闭时，由 PluginManager 决定是否挂起为 resident-ui。
   * 返回 true 表示已挂起（不走 close 路径），返回 false 表示正常关闭。
   */
  private shouldSuspendOnCloseCallback?: (pluginId: string, featureCode: string, route?: string) => boolean

  // 面板窗口管理器（跟随搜索框的插件窗口）
  private panelWindow: PluginPanelWindow | null = null
  private residentPanels: Map<string, ResidentPanelInfo> = new Map()

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
      log.warn(`[PluginWindowManager] Failed to open DevTools for ${pluginId}:`, err)
    }
  }

  private sendToMainWindow(channel: string, payload?: unknown): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) return
    this.mainWindow.webContents.send(channel, payload)
  }

  private normalizeRoute(route?: string): string | undefined {
    return route || undefined
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

  setDockPresentationRefreshHandler(handler: () => void | Promise<void>) {
    this.dockPresentationRefreshHandler = handler
  }

  private refreshDockPresentation(): void {
    if (process.platform !== 'darwin') return
    void this.dockPresentationRefreshHandler?.()
  }

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win
    // 初始化面板窗口管理器
    this.panelWindow = this.createPanelWindow()
  }

  isMainWindowVisible(): boolean {
    return Boolean(this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible())
  }

  setThemeManager(manager: ThemeManager) {
    this.themeManager = manager
    // 同时设置到面板窗口管理器
    this.panelWindow?.setThemeManager(manager)
    for (const info of this.residentPanels.values()) {
      info.panelWindow.setThemeManager(manager)
    }
  }

  private createPanelWindow(): PluginPanelWindow {
    if (!this.mainWindow) {
      throw new Error('Main window is not initialized')
    }
    const panelWindow = new PluginPanelWindow(this.mainWindow)
    if (this.themeManager) {
      panelWindow.setThemeManager(this.themeManager)
    }
    return panelWindow
  }

  private ensurePanelWindow(): PluginPanelWindow | null {
    if (this.panelWindow) return this.panelWindow
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return null
    this.panelWindow = this.createPanelWindow()
    return this.panelWindow
  }

  private destroyPanelWindow(panelWindow: PluginPanelWindow): void {
    panelWindow.close()
    const win = panelWindow.getWindow()
    if (win && !win.isDestroyed()) {
      win.close()
    }
  }

  prewarmAttachedShell(delayMs = 300): void {
    const timer = setTimeout(() => {
      this.panelWindow?.prewarmShell()
    }, delayMs)
    timer.unref?.()
  }

  notifyPluginLaunchStart(payload: {
    requestId: string
    pluginName: string
    displayName: string
    featureCode: string
    startedAt: number
  }): void {
    this.sendToMainWindow('plugin:launch-start', payload)
  }

  notifyPluginLaunchEnd(payload: {
    requestId: string
    pluginName: string
    featureCode: string
    reason: 'finished' | 'failed' | 'cancelled' | 'skipped'
  }): void {
    this.sendToMainWindow('plugin:launch-end', payload)
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
  attachPlugin(
    plugin: Plugin,
    featureCode: string,
    input?: InputPayload,
    route?: string,
    launchStart?: number,
    onLoadReady?: Promise<unknown>,
    launchRequestId?: string
  ): boolean {
    if (!plugin.manifest.ui) return false

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) {
      log.error(`Plugin UI not found: ${uiPath}`)
      return false
    }

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
              capabilities: getPluginRendererCapabilities(plugin),
              nonce: Date.now()
            })
            return true
          }
        }
      }
    }

    // 关闭之前附着的插件（强制关闭，不走 resident 挂起；PluginManager.run() 已单独处理 resident）
    this.closeAttached(true)

    this.attachedPlugin = {
      plugin,
      featureCode,
      route,
      input: input?.text || '',
      attachments: input?.attachments,
      startedAt: Date.now()
    }

    // 使用 Panel 模式（独立窗口跟随）
    const activePanelWindow = this.ensurePanelWindow()
    if (!activePanelWindow) {
      log.error('[PluginWindowManager] Panel window not initialized')
      return false
    }

    const notifyRendererAttached = () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) return
      this.mainWindow.webContents.send('plugin:attach', {
        pluginName: plugin.id,
        displayName: plugin.manifest.displayName,
        featureCode,
        input: input?.text || '',
        attachments: input?.attachments,
        mode: 'panel',
        launchRequestId
      })
      log.info(`[AttachmentTrace][Main] plugin:attach sent | plugin=${plugin.id} | feature=${featureCode} | ${formatPayloadTrace({ text: input?.text || '', attachments: input?.attachments || [] })}${launchStart ? ` | +${Date.now() - launchStart}ms` : ''}`)
    }

    const panelWin = activePanelWindow.createPanel(plugin, featureCode, input, route, launchStart, onLoadReady, notifyRendererAttached)
    if (!panelWin) {
      log.error('[PluginWindowManager] Failed to create panel window')
      this.attachedPlugin = null
      return false
    }

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
    const panelWindow = this.panelWindow
    const attachedPlugin = this.attachedPlugin
    // Match the old closeAttached() focus handoff before hiding the focused
    // panel. Otherwise PluginPanelWindow's blur guard can hide the main window.
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus()
    }
    const suspended = panelWindow.suspend()
    if (!suspended) return null

    this.residentPanels.set(pluginId, { panelWindow, attachedPlugin })
    this.attachedPlugin = null
    this.panelWindow = this.createPanelWindow()

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
   * 创建一个不显示的 resident attached 面板。
   * 用于“跟随 Mulby 启动”时缓存 UI Renderer，避免启动后抢占唯一的可见附着面板。
   */
  createHiddenResidentPanel(plugin: Plugin, featureCode: string, route?: string): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false
    if (!plugin.manifest.ui) return false

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) {
      log.error(`Plugin UI not found: ${uiPath}`)
      return false
    }

    if (this.residentPanels.has(plugin.id)) {
      this.evictResident(plugin.id)
    }

    const panelWindow = this.createPanelWindow()
    const input: InputPayload = { text: '', attachments: [] }
    const panelWin = panelWindow.createPanel(
      plugin,
      featureCode,
      input,
      route,
      undefined,
      undefined,
      undefined,
      { hiddenResident: true }
    )
    if (!panelWin) {
      this.destroyPanelWindow(panelWindow)
      return false
    }

    const suspended = panelWindow.suspend()
    if (!suspended) {
      this.destroyPanelWindow(panelWindow)
      return false
    }

    this.residentPanels.set(plugin.id, {
      panelWindow,
      attachedPlugin: {
        plugin,
        featureCode,
        route,
        input: '',
        attachments: [],
        startedAt: Date.now()
      }
    })

    log.info(`[ResidentUI] hidden cache created | plugin=${plugin.id} | feature=${featureCode} | route=${route || ''}`)
    return true
  }

  createHiddenResidentDetachedWindow(plugin: Plugin, featureCode: string, route?: string): boolean {
    const win = this.createDetachedWindow(
      plugin,
      featureCode,
      { text: '', attachments: [] },
      route,
      { hiddenResident: true }
    )
    if (!win) return false

    log.info(`[ResidentUI] hidden detached cache created | plugin=${plugin.id} | feature=${featureCode} | route=${route || ''}`)
    return true
  }

  restoreDetachedIfResident(
    pluginId: string,
    featureCode: string,
    input?: InputPayload,
    route?: string
  ): boolean {
    for (const info of this.detachedWindows.values()) {
      if (!info.resident || info.plugin.id !== pluginId) continue
      if (info.featureCode !== featureCode || this.normalizeRoute(info.route) !== this.normalizeRoute(route)) {
        return false
      }

      const win = info.window
      if (win.isDestroyed()) return false

      info.resident = false
      info.input = input?.text || ''
      info.attachments = input?.attachments || []
      info.route = route
      info.lastFocusedAt = Date.now()

      if (win.isMinimized()) {
        win.restore()
      }
      if (!win.isVisible()) {
        win.show()
      }
      try {
        win.focus()
      } catch {
        // Non-focusable detached windows can still be shown as a cached UI.
      }

      const target = info.pluginView?.webContents ?? win.webContents
      if (!target.isDestroyed()) {
        target.send('plugin:init', {
          pluginName: info.plugin.id,
          featureCode,
          input: input?.text || '',
          attachments: input?.attachments || [],
          mode: 'detached',
          route,
          capabilities: getPluginRendererCapabilities(info.plugin),
          nonce: Date.now()
        })
        if (this.themeManager) {
          target.send('theme:changed', this.themeManager.getActualTheme())
        }
      }

      log.info(`[ResidentUI] detached restore | plugin=${pluginId} | feature=${featureCode} | route=${route || ''}`)
      return true
    }

    return false
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
    const cached = this.residentPanels.get(pluginId)
    if (!cached) return false

    const activePanelWindow = this.panelWindow
    if (this.attachedPlugin || activePanelWindow?.isOpen()) {
      this.closeAttached(true)
    } else if (activePanelWindow && activePanelWindow !== cached.panelWindow) {
      this.destroyPanelWindow(activePanelWindow)
    }

    this.residentPanels.delete(pluginId)
    this.panelWindow = cached.panelWindow
    this.attachedPlugin = {
      ...cached.attachedPlugin,
      featureCode,
      route,
      input: input?.text || '',
      attachments: input?.attachments,
      startedAt: Date.now()
    }

    const restored = this.panelWindow.restore(featureCode, input, route)
    if (!restored) {
      this.destroyPanelWindow(cached.panelWindow)
      this.attachedPlugin = null
      this.panelWindow = this.createPanelWindow()
      return false
    }

    // 重新通知渲染进程插件已附着
    const plugin = this.attachedPlugin.plugin
    if (plugin && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('plugin:attach', {
        pluginName: plugin.id,
        displayName: plugin.manifest.displayName,
        featureCode,
        input: input?.text || '',
        attachments: input?.attachments,
        mode: 'panel'
      })
      log.info(`[AttachmentTrace][Main] resident plugin:attach sent | plugin=${plugin.id} | feature=${featureCode} | ${formatPayloadTrace({ text: input?.text || '', attachments: input?.attachments || [] })}`)
    }

    return true
  }

  /**
   * 强制驱逐 resident-ui 缓存（真正销毁面板窗口和上下文）。
   * 返回被驱逐的 pluginId，null 表示无缓存可驱逐。
   */
  evictResident(pluginId?: string): string | null {
    const firstResident = this.residentPanels.keys().next()
    const targetId = pluginId ?? (firstResident.done ? undefined : firstResident.value)
    if (!targetId) {
      for (const info of this.detachedWindows.values()) {
        if (info.resident) {
          return this.evictResident(info.plugin.id)
        }
      }
      return null
    }

    const cached = this.residentPanels.get(targetId)
    if (!cached) {
      for (const [windowId, info] of this.detachedWindows.entries()) {
        if (info.plugin.id !== targetId || !info.resident) continue
        log.info(`[ResidentUI] evict detached | plugin=${targetId}`)
        this.detachedWindows.delete(windowId)
        if (!info.window.isDestroyed()) {
          info.window.close()
        }
        clearSubInputState()
        return targetId
      }
      return null
    }

    log.info(`[ResidentUI] evict | plugin=${targetId}`)
    this.residentPanels.delete(targetId)
    if (cached.panelWindow.isOpen()) {
      cached.panelWindow.send('plugin:out', true)
    }
    this.destroyPanelWindow(cached.panelWindow)
    clearSubInputState()
    return targetId
  }

  evictAllResidents(): string[] {
    const evicted: string[] = []
    for (const pluginId of Array.from(this.residentPanels.keys())) {
      const removed = this.evictResident(pluginId)
      if (removed) evicted.push(removed)
    }
    const detachedResidentPluginIds = Array.from(this.detachedWindows.values())
      .filter((info) => info.resident)
      .map((info) => info.plugin.id)
    for (const pluginId of detachedResidentPluginIds) {
      const removed = this.evictResident(pluginId)
      if (removed) evicted.push(removed)
    }
    return evicted
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

      // 通知插件 UI 即将退出
      if (this.panelWindow?.isOpen()) {
        this.panelWindow.send('plugin:out', force)
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

    const { plugin, featureCode, route, input, attachments, startedAt } = this.attachedPlugin
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
        const promotedBounds = win.getBounds()
        pinWindowSize(windowId, promotedBounds.width, promotedBounds.height)
        this.detachedWindows.set(windowId, {
          window: win,
          pluginView: promoted.pluginView,
          plugin,
          featureCode,
          route,
          input,
          attachments,
          startedAt,
          lastFocusedAt: Date.now()
        })
        registerProtectedWindow(windowId)
        registerWindowsInputTargetWindow(windowId, win.getNativeWindowHandle())
        this.installDetachedDockRefreshHandlers(win, windowId)
        this.refreshDockPresentation()

        win.on('closed', () => {
          this.detachedWindows.delete(windowId)
          unpinWindowSize(windowId)
          unregisterProtectedWindow(windowId)
          unregisterWindowsInputTargetWindow(windowId)
          this.refreshDockPresentation()
          this.notifyPluginWindowClosed(plugin.id)
        })

        return win
      }
    }

    // 如果 promoteToWindow 失败，创建新的独立窗口
    return this.createDetachedWindow(plugin, featureCode, { text: input, attachments: attachments || [] }, route)
  }

  // 创建独立窗口
  createDetachedWindow(
    plugin: Plugin,
    featureCode: string,
    input?: InputPayload,
    route?: string,
    options: DetachedWindowCreateOptions = {}
  ): BrowserWindow | null {
    if (!plugin.manifest.ui) return null
    const hiddenResident = options.hiddenResident === true

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) return null

    // 单例模式检查：如果 pluginSetting.single 为 true（默认），检查是否已有该插件的窗口
    const isSingleMode = plugin.manifest.pluginSetting?.single !== false
    if (isSingleMode) {
      // 查找已存在的该插件窗口
      for (const info of this.detachedWindows.values()) {
        if (info.plugin.id === plugin.id) {
          if (hiddenResident) return null
          if (info.resident) continue
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
                capabilities: getPluginRendererCapabilities(plugin),
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
    const backgroundThrottling = windowConfig.backgroundThrottling ?? true
    const isFullscreen = windowType === 'fullscreen'
    const isResizable = windowConfig.resizable ?? true
    const isMaximizable = windowConfig.resizable !== false
    const isFullscreenable = windowConfig.fullscreenable ?? true
    const captureRegion = input?.attachments?.find(attachment => attachment.kind === 'image' && attachment.capture?.region)?.capture?.region
    const shouldPositionAtCaptureRegion = windowConfig.position === 'capture-region' && captureRegion
    const shouldFitCaptureRegion = (windowConfig.fit === 'capture-region' || windowConfig.fit === 'capture-region-with-toolbar') && captureRegion
    const captureToolbarHeight = Math.max(0, windowConfig.captureToolbarHeight ?? 56)

    // 获取插件 preload 路径（支持自定义 preload）
    const basePreloadPath = join(__dirname, '../preload/index.js')
    const preloadPath = getPluginPreloadPath(basePreloadPath, plugin)
    const hasCustomPreload = !!plugin.manifest.preload

    // 全屏模式：获取主屏幕工作区大小
    const fullscreenBounds = isFullscreen ? screen.getPrimaryDisplay().workArea : null

    // 标题栏 preload 路径
    const titlebarPreloadPath = join(__dirname, '../preload/titlebar.js')

    // ===== WebContentsView 架构：BrowserWindow 加载标题栏，插件作为子视图 =====
    const contentWidth = shouldFitCaptureRegion ? captureRegion.width : (windowConfig.width ?? 500)
    const contentHeight = shouldFitCaptureRegion
      ? captureRegion.height + (windowConfig.fit === 'capture-region-with-toolbar' ? captureToolbarHeight : 0)
      : (windowConfig.height ?? 400)
    const windowWidth = isFullscreen ? fullscreenBounds!.width : toWindowWidth(contentWidth)!
    const windowHeight = isFullscreen ? fullscreenBounds!.height : toWindowHeight(contentHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!
    const windowX = isFullscreen ? fullscreenBounds!.x : (shouldPositionAtCaptureRegion ? captureRegion.x : undefined)
    const windowY = isFullscreen ? fullscreenBounds!.y : (shouldPositionAtCaptureRegion ? captureRegion.y : undefined)
    const minContentWidth = shouldFitCaptureRegion ? Math.max(1, Math.min(contentWidth, windowConfig.minWidth ?? contentWidth)) : (windowConfig.minWidth ?? 300)
    const minContentHeight = shouldFitCaptureRegion ? Math.max(1, Math.min(contentHeight, windowConfig.minHeight ?? contentHeight)) : (windowConfig.minHeight ?? 200)
    const maxContentWidth = shouldFitCaptureRegion && windowConfig.maxWidth != null ? Math.max(contentWidth, windowConfig.maxWidth) : windowConfig.maxWidth
    const maxContentHeight = shouldFitCaptureRegion && windowConfig.maxHeight != null ? Math.max(contentHeight, windowConfig.maxHeight) : windowConfig.maxHeight

    // 透明且不可调整大小的窗口：锁定 maxWidth/maxHeight 防止 Windows DWM 尺寸漂移
    const pinTransparentSize = windowConfig.transparent && windowConfig.resizable === false
    const resolvedMaxWidth = pinTransparentSize
      ? windowWidth
      : (isFullscreen ? undefined : toWindowWidth(maxContentWidth))
    const resolvedMaxHeight = pinTransparentSize
      ? windowHeight
      : (isFullscreen ? undefined : toWindowHeight(maxContentHeight != null ? maxContentHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0) : undefined))

    const win = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: windowX,
      y: windowY,
      minWidth: isFullscreen ? undefined : toWindowWidth(minContentWidth)!,
      minHeight: isFullscreen ? undefined : toWindowHeight(minContentHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!,
      maxWidth: resolvedMaxWidth,
      maxHeight: resolvedMaxHeight,
      resizable: isResizable,
      maximizable: isMaximizable,
      show: false,
      frame: false,
      fullscreen: isFullscreen,
      fullscreenable: isFullscreenable,
      alwaysOnTop: windowConfig.alwaysOnTop,
      focusable: windowConfig.focusable !== false,
      thickFrame: !useWindowsFramelessSurface,
      backgroundColor: (windowConfig.transparent || useWindowsFramelessSurface) ? '#00000000' : backgroundColor,
      transparent: windowConfig.transparent || useWindowsFramelessSurface,
      hasShadow: windowConfig.transparent ? false : !useWindowsFramelessSurface,
      title: plugin.manifest.displayName,
      icon: resolvePluginWindowIcon(plugin),
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
        backgroundThrottling,
        v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS,
        ...getPluginRendererWebPreferences(plugin)
      }
    })
    win.setResizable(isResizable)
    win.setMaximizable(isMaximizable)
    win.setFullScreenable(isFullscreenable)
    if (!showTitleBar) {
      installPluginWebviewSecurity(win.webContents, plugin)
    }

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
          backgroundThrottling,
          v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS,
          ...getPluginRendererWebPreferences(plugin)
        }
      })
      installPluginWebviewSecurity(pluginView.webContents, plugin)

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

      // WebContentsView-backed windows need explicit focus handoff on macOS
      // and after Windows foreground restoration.
      installPluginViewFocusBridge(win, pluginView)

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
        win.webContents.send('window:stateChanged', {
          isMaximized: true,
          canMaximize: win.isResizable()
        })
      })
      win.on('unmaximize', () => {
        win.webContents.send('window:stateChanged', {
          isMaximized: false,
          canMaximize: win.isResizable()
        })
      })
    }

    // 目标 webContents（插件内容）
    const pluginWebContents = pluginView?.webContents ?? win.webContents

    win.once('ready-to-show', async () => {
      if (showTitleBar) {
        // WebContentsView 架构：初始化标题栏
        initTitlebar(win, plugin.manifest.displayName, currentTheme, plugin.isDev === true)
      }
      if (useWindowsFramelessSurface && !windowConfig.transparent) {
        // 标题栏已独立，不需要 surface 注入 padding-top
        // 跳过明确透明的窗口——surface 的 box-shadow / resize-handle 会透过透明背景可见
        await applyWindowsFramelessSurface(win, {
          includeTitleBar: false,
          contentBackground: 'theme',
          resizeMode: showTitleBar ? 'none' : 'all'
        })
        if (win.isDestroyed()) return
      }
      registerWindowsInputTargetWindow(win.id, win.getNativeWindowHandle())
      // 应用 manifest.window.opacity 初始透明度
      if (windowConfig.opacity !== undefined) {
        win.setOpacity(Math.max(0, Math.min(1, windowConfig.opacity)))
      }
      if (windowConfig.visibleOnAllWorkspaces) {
        win.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: windowConfig.visibleOnFullScreen === true
        })
      }
      if (windowConfig.ignoreMouseEvents) {
        win.setIgnoreMouseEvents(true, {
          forward: windowConfig.forwardMouseEvents === true
        })
      }
      if (windowConfig.skipTaskbar) {
        win.setSkipTaskbar(true)
      }
      if (windowConfig.alwaysOnTop && windowConfig.alwaysOnTopLevel) {
        win.setAlwaysOnTop(true, windowConfig.alwaysOnTopLevel as Parameters<BrowserWindow['setAlwaysOnTop']>[1])
      } else if (windowConfig.alwaysOnTop && process.platform === 'win32') {
        win.setAlwaysOnTop(true, 'screen-saver')
      }
      if (!hiddenResident) {
        if (windowConfig.focusable === false) {
          win.showInactive()
        } else {
          win.show()
        }
        this.openPluginDevTools(pluginWebContents, plugin.id)
      }
    })

    // macOS multi-view focus: inject mousedown handler for titlebar windows
    if (showTitleBar && pluginView) {
      pluginView.webContents.on('dom-ready', () => {
        if (pluginView.webContents.isDestroyed()) return
        pluginView.webContents.executeJavaScript(`
          document.addEventListener('mousedown', function() {
            if (window.mulby && window.mulby.window && window.mulby.window.focus) {
              window.mulby.window.focus()
            }
          }, true)
        `).catch(() => {})
      })
    }

    // 等待插件内容加载完成后，发送 plugin:init 和 theme 信息
    pluginWebContents.on('did-finish-load', async () => {
      if (!hiddenResident) {
        this.openPluginDevTools(pluginWebContents, plugin.id)
      }
      if (useWindowsFramelessSurface && !windowConfig.transparent && !win.isDestroyed()) {
        await applyWindowsFramelessSurface(win, {
          includeTitleBar: false,
          contentBackground: 'theme',
          resizeMode: showTitleBar ? 'none' : 'all'
        })
      }
      if (isResizable && !isFullscreen) {
        await applyWindowResizeHandlesToWebContents(pluginWebContents, {
          resizeMode: showTitleBar ? 'side-bottom' : 'all'
        })
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
          capabilities: getPluginRendererCapabilities(plugin),
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
    // 注册窗口尺寸，用于 setPosition 时通过 setBounds 固定尺寸防止 DWM 漂移
    pinWindowSize(windowId, windowWidth, windowHeight)

    this.detachedWindows.set(windowId, {
      window: win,
      pluginView: pluginView ?? undefined,
      plugin,
      featureCode,
      route,
      resident: hiddenResident,
      input: input?.text || '',
      attachments: input?.attachments,
      startedAt: Date.now(),
      lastFocusedAt: Date.now()
    })

    registerPluginWindow(windowId, plugin.id)
    registerProtectedWindow(windowId)
    registerWindowsInputTargetWindow(windowId, win.getNativeWindowHandle())

    this.installDetachedDockRefreshHandlers(win, windowId)
    this.refreshDockPresentation()

    installConsoleCaptureForWebContents(pluginWebContents, plugin.id)

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
      unpinWindowSize(windowId)
      unregisterPluginWindow(windowId)
      unregisterProtectedWindow(windowId)
      unregisterWindowsInputTargetWindow(windowId)
      if (pluginView && !pluginView.webContents.isDestroyed()) {
        pluginView.webContents.close()
      }
      this.refreshDockPresentation()
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
    const loadMode = options?.loadMode === 'file' ? 'file' : 'route'
    let contentPath: string
    let loadFileOptions: Electron.LoadFileOptions | undefined
    let auxiliaryRoute: string | undefined

    if (loadMode === 'file') {
      try {
        const entry = resolveLegacyAuxiliaryFileEntry(plugin.path, path)
        contentPath = entry.htmlPath
        loadFileOptions = entry.loadFileOptions
      } catch (err) {
        log.warn(`[PluginWindowManager] 拒绝创建文件模式辅助窗口: plugin=${plugin.id}, path=${path}, error=${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    } else {
      if (!plugin.manifest.ui) return null

      contentPath = join(plugin.path, plugin.manifest.ui)
      if (!existsSync(contentPath)) return null

      // 加载页面，分离 hash 路由和 query 参数，兼容 `/index.html#route?a=1` 等旧写法。
      const auxiliaryPath = parseAuxiliaryPath(path)
      loadFileOptions = createAuxiliaryLoadFileOptions(auxiliaryPath)
      auxiliaryRoute = auxiliaryPath.hash
    }

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
    const backgroundThrottling = resolveAuxiliaryWindowBackgroundThrottling(options, windowConfig)

    // 获取插件 preload 路径（支持自定义 preload）
    const basePreloadPath = join(__dirname, '../preload/index.js')
    let preloadPath: string
    try {
      preloadPath = loadMode === 'file'
        ? getPluginPreloadPathForEntry(basePreloadPath, plugin, options?.preload)
        : getPluginPreloadPath(basePreloadPath, plugin)
    } catch (err) {
      log.warn(`[PluginWindowManager] 拒绝创建文件模式辅助窗口: plugin=${plugin.id}, preload=${options?.preload}, error=${err instanceof Error ? err.message : String(err)}`)
      return null
    }
    const hasCustomPreload = loadMode === 'file'
      ? Boolean(options?.preload ?? plugin.manifest.preload)
      : !!plugin.manifest.preload

    // 全屏模式：获取主屏幕工作区大小
    const fullscreenBounds = isFullscreen ? screen.getPrimaryDisplay().workArea : null

    // 标题栏 preload 路径
    const titlebarPreloadPath = join(__dirname, '../preload/titlebar.js')

    const baseWidth = options?.width || windowConfig.width || 800
    const baseHeight = options?.height || windowConfig.height || 600
    const sizeLimits = resolveAuxiliaryWindowSizeLimits(options, windowConfig)
    const minHeight = sizeLimits.minHeight == null
      ? undefined
      : sizeLimits.minHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0)
    const maxHeight = sizeLimits.maxHeight == null
      ? undefined
      : sizeLimits.maxHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0)

    const isOverlayLike = resolvedTransparent && options?.ignoreMouseEvents === true

    const win = new BrowserWindow({
      width: isFullscreen ? fullscreenBounds!.width : toWindowWidth(baseWidth)!,
      height: isFullscreen ? fullscreenBounds!.height : toWindowHeight(baseHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!,
      x: isFullscreen ? fullscreenBounds!.x : options?.x,
      y: isFullscreen ? fullscreenBounds!.y : options?.y,
      minWidth: isFullscreen ? undefined : toWindowWidth(sizeLimits.minWidth),
      minHeight: isFullscreen ? undefined : toWindowHeight(minHeight),
      maxWidth: isFullscreen ? undefined : toWindowWidth(sizeLimits.maxWidth),
      maxHeight: isFullscreen ? undefined : toWindowHeight(maxHeight),
      show: false,
      frame: false,
      fullscreen: isFullscreen,
      fullscreenable: options?.fullscreenable ?? true,
      alwaysOnTop: options?.alwaysOnTop,
      resizable: options?.resizable,
      movable: options?.movable,
      minimizable: options?.minimizable,
      maximizable: options?.maximizable,
      focusable: options?.focusable !== false,
      skipTaskbar: options?.skipTaskbar,
      enableLargerThanScreen: options?.enableLargerThanScreen,
      thickFrame: !useWindowsFramelessSurface,
      backgroundColor: (resolvedTransparent || useWindowsFramelessSurface) ? '#00000000' : backgroundColor,
      transparent: resolvedTransparent || useWindowsFramelessSurface,
      hasShadow: isOverlayLike ? false : (resolvedTransparent ? false : !useWindowsFramelessSurface),
      title: options?.title || plugin.manifest.displayName,
      icon: resolvePluginWindowIcon(plugin),
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
        backgroundThrottling,
        v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS,
        ...getPluginRendererWebPreferences(plugin)
      }
    })
    if (!showTitleBar) {
      installPluginWebviewSecurity(win.webContents, plugin)
    }

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
          backgroundThrottling,
          v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS,
          ...getPluginRendererWebPreferences(plugin)
        }
      })
      installPluginWebviewSecurity(pluginView.webContents, plugin)

      win.contentView.addChildView(pluginView)
      layoutPluginView(win, pluginView, true)
      registerView(pluginView, win)

      // 加载插件 UI
      if (loadFileOptions) {
        void pluginView.webContents.loadFile(contentPath, loadFileOptions)
      } else {
        void pluginView.webContents.loadFile(contentPath)
      }

      // 设置标题栏 IPC
      setupTitlebarIPC(win, pluginView, this.themeManager)

      installPluginViewFocusBridge(win, pluginView)

      // 窗口 resize 时更新插件视图布局
      win.on('resize', () => {
        if (!win.isDestroyed() && pluginView && !pluginView.webContents.isDestroyed()) {
          layoutPluginView(win, pluginView, true)
        }
      })
    } else {
      // 无标题栏：BrowserWindow 直接加载插件
      if (loadFileOptions) {
        void win.loadFile(contentPath, loadFileOptions)
      } else {
        void win.loadFile(contentPath)
      }

      // 窗口状态事件
      win.on('maximize', () => win.webContents.send('window:stateChanged', {
        isMaximized: true,
        canMaximize: win.isResizable()
      }))
      win.on('unmaximize', () => win.webContents.send('window:stateChanged', {
        isMaximized: false,
        canMaximize: win.isResizable()
      }))
    }

    // 目标 webContents（插件内容）
    const pluginWebContents = pluginView?.webContents ?? win.webContents

    win.once('ready-to-show', async () => {
      if (showTitleBar) {
        initTitlebar(win, options?.title || plugin.manifest.displayName, currentTheme, plugin.isDev === true)
      }
      if (useWindowsFramelessSurface && !resolvedTransparent) {
        await applyWindowsFramelessSurface(win, {
          includeTitleBar: false,
          contentBackground: 'theme'
        })
        if (win.isDestroyed()) return
      }
      registerWindowsInputTargetWindow(win.id, win.getNativeWindowHandle())

      if (options?.alwaysOnTop && options.alwaysOnTopLevel) {
        win.setAlwaysOnTop(true, options.alwaysOnTopLevel as Parameters<BrowserWindow['setAlwaysOnTop']>[1])
      } else if (options?.alwaysOnTop && process.platform === 'win32') {
        win.setAlwaysOnTop(true, 'screen-saver')
      }
      if (options?.ignoreMouseEvents) {
        win.setIgnoreMouseEvents(true, { forward: options.forwardMouseEvents === true })
      }
      if (options?.visibleOnAllWorkspaces) {
        win.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: options.visibleOnFullScreen === true
        })
      }

      if (options?.focusable === false) {
        win.showInactive()
      } else {
        win.show()
      }
      if (resolvedOpacity !== undefined) {
        win.setOpacity(Math.max(0, Math.min(1, resolvedOpacity)))
      }
      this.openPluginDevTools(pluginWebContents, plugin.id)
    })

    // macOS multi-view focus: inject mousedown handler to request focus on click.
    // This fixes the issue where frame:false + WebContentsView windows don't
    // properly become key window on macOS when clicked.
    if (showTitleBar && pluginView) {
      pluginView.webContents.on('dom-ready', () => {
        if (pluginView.webContents.isDestroyed()) return
        pluginView.webContents.executeJavaScript(`
          document.addEventListener('mousedown', function(e) {
            console.log('[mulby:focus-fix] mousedown on plugin content, requesting focus, target:', e.target?.tagName)
            if (window.mulby && window.mulby.window && window.mulby.window.focus) {
              window.mulby.window.focus()
            }
          }, true)
        `).catch(() => {})
      })
    }

    // 等待插件内容加载完成后，再发送初始化数据和主题
    pluginWebContents.on('did-finish-load', async () => {
      this.openPluginDevTools(pluginWebContents, plugin.id)
      if (useWindowsFramelessSurface && !resolvedTransparent && !win.isDestroyed()) {
        await applyWindowsFramelessSurface(win, {
          includeTitleBar: false,
          contentBackground: 'theme'
        })
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
          route: auxiliaryRoute,
          params: options?.params,
          capabilities: getPluginRendererCapabilities(plugin),
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
    const auxWinWidth = isFullscreen ? fullscreenBounds!.width : toWindowWidth(baseWidth)!
    const auxWinHeight = isFullscreen ? fullscreenBounds!.height : toWindowHeight(baseHeight + (showTitleBar ? DETACHED_TITLEBAR_HEIGHT : 0))!
    pinWindowSize(windowId, auxWinWidth, auxWinHeight)

    this.detachedWindows.set(windowId, {
      window: win,
      pluginView: pluginView ?? undefined,
      plugin,
      featureCode: '',
      input: '',
      attachments: [],
      startedAt: Date.now(),
      lastFocusedAt: Date.now(),
      creatorId
    })

    registerPluginWindow(windowId, plugin.id)
    registerProtectedWindow(windowId)
    registerWindowsInputTargetWindow(windowId, win.getNativeWindowHandle())

    this.installDetachedDockRefreshHandlers(win, windowId)
    this.refreshDockPresentation()

    installConsoleCaptureForWebContents(pluginWebContents, plugin.id)

    win.on('closed', () => {
      const info = this.detachedWindows.get(windowId)
      if (info) {
        this.notifyParentChildWindowClosed(windowId, info)
      }
      this.detachedWindows.delete(windowId)
      unpinWindowSize(windowId)
      unregisterPluginWindow(windowId)
      unregisterProtectedWindow(windowId)
      unregisterWindowsInputTargetWindow(windowId)
      if (pluginView && !pluginView.webContents.isDestroyed()) {
        pluginView.webContents.close()
      }
      this.refreshDockPresentation()
      this.notifyPluginWindowClosed(plugin.id)
    })

    return win
  }

  private installDetachedDockRefreshHandlers(win: BrowserWindow, windowId: number): void {
    win.on('focus', () => {
      const info = this.detachedWindows.get(windowId)
      if (!info || info.window.isDestroyed()) return
      info.lastFocusedAt = Date.now()
      this.refreshDockPresentation()
    })
  }

  private notifyParentChildWindowClosed(windowId: number, info: DetachedWindowInfo): void {
    const parentId = info.creatorId
    if (!parentId) return

    const parentWin = BrowserWindow.fromId(parentId)
    if (!parentWin || parentWin.isDestroyed()) return

    const targetWc = getPluginWebContents(parentWin) ?? parentWin.webContents
    if (targetWc.isDestroyed()) return

    targetWc.send('window:childMessage', 'child-window-closed', {
      id: windowId,
      pluginId: info.plugin.id,
      featureCode: info.featureCode,
      at: Date.now()
    })
  }

  focusDetachedWindow(windowId: number): boolean {
    const info = this.detachedWindows.get(windowId)
    if (!info || info.window.isDestroyed()) return false
    if (!info.window.isVisible()) {
      info.window.show()
    }
    if (info.window.isMinimized()) {
      info.window.restore()
    }
    info.window.focus()
    info.lastFocusedAt = Date.now()
    this.refreshDockPresentation()
    return true
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

  getDockPluginWindows(): MacDockPluginWindowSnapshot[] {
    return Array.from(this.detachedWindows.entries())
      .filter(([, info]) => !info.window.isDestroyed())
      .map(([windowId, info]) => ({
        windowId,
        pluginId: info.plugin.id,
        displayName: info.plugin.manifest.displayName,
        startedAt: info.startedAt,
        lastFocusedAt: info.lastFocusedAt,
        resolvedIcon: info.plugin.resolvedIcon
      }))
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

  /**
   * 收集某插件当前所有存活 UI 视图的 webContents（附着面板 + 独立窗口）。
   * 用于把后端日志/错误回灌到对应插件的 DevTools 控制台。
   * 返回插件内容 WebContentsView 的 webContents（无标题栏时回退到窗口 webContents）。
   */
  getPluginViewWebContentsList(pluginId: string): Electron.WebContents[] {
    const result: Electron.WebContents[] = []
    const seen = new Set<number>()
    const push = (wc: Electron.WebContents | null | undefined) => {
      if (wc && !wc.isDestroyed() && !seen.has(wc.id)) {
        seen.add(wc.id)
        result.push(wc)
      }
    }

    // 附着面板
    const panelWin = this.panelWindow?.getWindow()
    if (
      panelWin &&
      !panelWin.isDestroyed() &&
      this.attachedPlugin?.plugin.id === pluginId &&
      this.panelWindow?.isOpen() &&
      !this.panelWindow?.isSuspendedForResident()
    ) {
      push(getPluginWebContents(panelWin) ?? panelWin.webContents)
    }

    // 独立窗口
    for (const info of this.detachedWindows.values()) {
      if (info.resident) continue
      if (info.window.isDestroyed()) continue
      if (info.plugin.id !== pluginId) continue
      push(getPluginWebContents(info.window) ?? info.window.webContents)
    }

    return result
  }

  closeAll(): void {
    this.closeAttached(true)
    this.evictAllResidents()
    for (const [windowId, info] of this.detachedWindows.entries()) {
      unregisterPluginWindow(windowId)
      unregisterProtectedWindow(windowId)
      unregisterWindowsInputTargetWindow(windowId)
      if (!info.window.isDestroyed()) {
        info.window.destroy()
      }
    }
    this.detachedWindows.clear()
    this.refreshDockPresentation()
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
  // 使用 activate: true 使面板获得焦点，避免焦点停留在主窗口搜索框，
  // 让用户在 hide→show 后可以直接继续在插件中输入。
  // 但是，如果当前插件启用了 subInput，则不应该激活面板窗口，焦点应该留在宿主的 subInput 上。
  showPanelWindow(): void {
    this.panelWindow?.show({ activate: !isSubInputEnabled() })
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
      this.mainWindow.setOpacity(1)
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
    if (detachedInfo) return detachedInfo.resident ? null : detachedInfo.plugin

    // 检查是否为面板窗口
    const panelWin = this.panelWindow?.getWindow()
    if (panelWin && panelWin.id === win.id) {
      if (this.panelWindow?.isSuspendedForResident()) return null
      return this.attachedPlugin?.plugin || null
    }

    return null
  }

  getLaunchTargetByWindow(win: BrowserWindow): PluginLaunchTarget | null {
    if (!win) return null

    const detachedInfo = this.detachedWindows.get(win.id)
    if (detachedInfo) {
      if (detachedInfo.resident) return null
      return {
        plugin: detachedInfo.plugin,
        featureCode: detachedInfo.featureCode,
        mode: 'detached',
        route: detachedInfo.route
      }
    }

    const panelWin = this.panelWindow?.getWindow()
    if (panelWin && panelWin.id === win.id && this.attachedPlugin && !this.panelWindow?.isSuspendedForResident()) {
      return {
        plugin: this.attachedPlugin.plugin,
        featureCode: this.attachedPlugin.featureCode,
        mode: 'attached',
        route: this.attachedPlugin.route
      }
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
      if (!info.resident && info.plugin.id === pluginId && !info.window.isDestroyed()) {
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
