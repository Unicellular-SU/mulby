import { BrowserWindow, app, Menu } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { Plugin } from '../../shared/types/plugin'
import { ThemeManager } from '../theme'
import { injectCustomTitleBar } from './titlebar'

interface AttachedPlugin {
  plugin: Plugin
  featureCode: string
  input: string
}

interface DetachedWindowInfo {
  window: BrowserWindow
  plugin: Plugin
  featureCode: string
  input: string
}

export class PluginWindowManager {
  private mainWindow: BrowserWindow | null = null
  private themeManager: ThemeManager | null = null
  private attachedPlugin: AttachedPlugin | null = null
  private detachedWindows: Map<number, DetachedWindowInfo> = new Map()
  private dockVisible = false

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
  }

  setThemeManager(manager: ThemeManager) {
    this.themeManager = manager
  }

  // 获取附着的插件信息
  getAttachedPlugin(): AttachedPlugin | null {
    return this.attachedPlugin
  }

  // 是否有附着的插件
  hasAttachedPlugin(): boolean {
    return this.attachedPlugin !== null
  }

  // 附着插件到主窗口
  attachPlugin(plugin: Plugin, featureCode: string, input?: string): boolean {
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
      input: input || ''
    }

    // 通知渲染进程加载插件
    this.mainWindow?.webContents.send('plugin:attach', {
      pluginName: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      featureCode,
      input: input || '',
      uiPath,
      preloadPath: join(__dirname, '../preload/index.js')
    })

    return true
  }

  // 关闭附着的插件
  closeAttached(): void {
    if (this.attachedPlugin) {
      this.attachedPlugin = null
      this.mainWindow?.webContents.send('plugin:detached')
    }
  }

  // 分离当前附着的插件为独立窗口
  detachCurrent(): BrowserWindow | null {
    if (!this.attachedPlugin) return null

    const { plugin, featureCode, input } = this.attachedPlugin
    this.attachedPlugin = null
    this.mainWindow?.webContents.send('plugin:detached')

    return this.createDetachedWindow(plugin, featureCode, input)
  }

  // 创建独立窗口
  createDetachedWindow(
    plugin: Plugin,
    featureCode: string,
    input?: string
  ): BrowserWindow | null {
    if (!plugin.manifest.ui) return null

    const uiPath = join(plugin.path, plugin.manifest.ui)
    if (!existsSync(uiPath)) return null

    // 根据当前主题设置窗口背景色，避免重载时闪白
    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const isDark = currentTheme === 'dark'
    const backgroundColor = isDark ? '#1e293b' : '#ffffff'

    const win = new BrowserWindow({
      width: 500,
      height: 400,
      minWidth: 300,
      minHeight: 200,
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

    win.loadFile(uiPath)

    win.once('ready-to-show', async () => {
      // 注入自定义标题栏
      await injectCustomTitleBar(win, plugin.manifest.displayName, currentTheme)
      win.show()
      win.webContents.send('plugin:init', {
        pluginName: plugin.manifest.name,
        featureCode,
        input: input || '',
        mode: 'detached'
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
      input: input || ''
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
}