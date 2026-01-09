import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { Plugin } from '../../shared/types/plugin'

export class PluginWindowManager {
  private windows: Map<string, BrowserWindow> = new Map()

  // 打开插件 UI 窗口
  openWindow(plugin: Plugin, featureCode: string, input?: string): BrowserWindow | null {
    const uiPath = plugin.manifest.ui
    if (!uiPath) return null

    const fullPath = join(plugin.path, uiPath)
    if (!existsSync(fullPath)) {
      console.error(`Plugin UI file not found: ${fullPath}`)
      return null
    }

    // 如果窗口已存在，聚焦并返回
    const existingWindow = this.windows.get(plugin.manifest.name)
    if (existingWindow && !existingWindow.isDestroyed()) {
      existingWindow.focus()
      return existingWindow
    }

    // 创建新窗口
    const win = new BrowserWindow({
      width: 500,
      height: 400,
      frame: false,
      resizable: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // 加载 UI 文件
    win.loadFile(fullPath)

    // 窗口准备好后显示并发送初始数据
    win.once('ready-to-show', () => {
      win.show()
      win.webContents.send('plugin:init', {
        pluginName: plugin.manifest.name,
        featureCode,
        input: input || ''
      })
    })

    // 窗口关闭时清理
    win.on('closed', () => {
      this.windows.delete(plugin.manifest.name)
    })

    this.windows.set(plugin.manifest.name, win)
    return win
  }

  // 关闭插件窗口
  closeWindow(pluginName: string): void {
    const win = this.windows.get(pluginName)
    if (win && !win.isDestroyed()) {
      win.close()
    }
    this.windows.delete(pluginName)
  }

  // 获取插件窗口
  getWindow(pluginName: string): BrowserWindow | null {
    const win = this.windows.get(pluginName)
    if (win && !win.isDestroyed()) {
      return win
    }
    return null
  }

  // 关闭所有插件窗口
  closeAll(): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.close()
      }
    }
    this.windows.clear()
  }
}
