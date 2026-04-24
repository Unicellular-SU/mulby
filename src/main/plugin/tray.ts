import { Tray, nativeImage } from 'electron'
import log from 'electron-log'

// 存储插件的托盘实例
const pluginTrays = new Map<string, Tray>()

export interface TrayOptions {
  icon: string  // 图标路径或 base64
  tooltip?: string
  title?: string  // macOS 托盘标题
}

export interface TrayMenuItem {
  label: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  enabled?: boolean
  click?: string  // 回调标识
}

export class PluginTray {
  private pluginName: string

  constructor(pluginName: string) {
    this.pluginName = pluginName
  }

  /**
   * 创建系统托盘
   */
  create(options: TrayOptions): boolean {
    try {
      // 如果已存在，先销毁
      this.destroy()

      let image: Electron.NativeImage
      if (options.icon.startsWith('data:')) {
        // Base64 图片
        image = nativeImage.createFromDataURL(options.icon)
      } else {
        // 文件路径
        image = nativeImage.createFromPath(options.icon)
      }

      // 调整图标大小（托盘图标通常为 16x16 或 22x22）
      if (!image.isEmpty()) {
        image = image.resize({ width: 16, height: 16 })
      }

      const tray = new Tray(image)

      if (options.tooltip) {
        tray.setToolTip(options.tooltip)
      }

      if (options.title && process.platform === 'darwin') {
        tray.setTitle(options.title)
      }

      pluginTrays.set(this.pluginName, tray)
      return true
    } catch (error) {
      log.error('Failed to create tray:', error)
      return false
    }
  }

  /**
   * 销毁托盘
   */
  destroy(): void {
    const tray = pluginTrays.get(this.pluginName)
    if (tray) {
      tray.destroy()
      pluginTrays.delete(this.pluginName)
    }
  }

  /**
   * 设置托盘图标
   */
  setIcon(icon: string): void {
    const tray = pluginTrays.get(this.pluginName)
    if (!tray) return

    let image: Electron.NativeImage
    if (icon.startsWith('data:')) {
      image = nativeImage.createFromDataURL(icon)
    } else {
      image = nativeImage.createFromPath(icon)
    }

    if (!image.isEmpty()) {
      image = image.resize({ width: 16, height: 16 })
      tray.setImage(image)
    }
  }

  /**
   * 设置提示文字
   */
  setTooltip(tooltip: string): void {
    const tray = pluginTrays.get(this.pluginName)
    if (tray) {
      tray.setToolTip(tooltip)
    }
  }

  /**
   * 设置标题（仅 macOS）
   */
  setTitle(title: string): void {
    const tray = pluginTrays.get(this.pluginName)
    if (tray && process.platform === 'darwin') {
      tray.setTitle(title)
    }
  }

  /**
   * 检查托盘是否存在
   */
  exists(): boolean {
    return pluginTrays.has(this.pluginName)
  }
}

export function createPluginTray(pluginName: string) {
  return new PluginTray(pluginName)
}
