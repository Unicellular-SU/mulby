import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { Plugin } from '../../shared/types/plugin'

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
  private attachedPlugin: AttachedPlugin | null = null
  private detachedWindows: Map<number, DetachedWindowInfo> = new Map()

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win
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
      uiPath
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

    const win = new BrowserWindow({
      width: 500,
      height: 400,
      minWidth: 300,
      minHeight: 200,
      show: false,
      title: plugin.manifest.displayName,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.loadFile(uiPath)

    win.once('ready-to-show', () => {
      win.show()
      win.webContents.send('plugin:init', {
        pluginName: plugin.manifest.name,
        featureCode,
        input: input || '',
        mode: 'detached'
      })
    })

    const windowId = win.id
    this.detachedWindows.set(windowId, {
      window: win,
      plugin,
      featureCode,
      input: input || ''
    })

    win.on('closed', () => {
      this.detachedWindows.delete(windowId)
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