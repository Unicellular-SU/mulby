import { globalShortcut } from 'electron'

// 存储插件注册的快捷键
const pluginShortcuts = new Map<string, Map<string, () => void>>()

export class PluginGlobalShortcut {
  private pluginName: string

  constructor(pluginName: string) {
    this.pluginName = pluginName
  }

  /**
   * 注册全局快捷键
   */
  register(accelerator: string, callback: () => void): boolean {
    try {
      // 检查是否已被注册
      if (globalShortcut.isRegistered(accelerator)) {
        return false
      }

      const success = globalShortcut.register(accelerator, callback)

      if (success) {
        // 记录插件注册的快捷键
        if (!pluginShortcuts.has(this.pluginName)) {
          pluginShortcuts.set(this.pluginName, new Map())
        }
        pluginShortcuts.get(this.pluginName)!.set(accelerator, callback)
      }

      return success
    } catch {
      return false
    }
  }

  /**
   * 注销全局快捷键
   */
  unregister(accelerator: string): void {
    globalShortcut.unregister(accelerator)

    // 从记录中移除
    const shortcuts = pluginShortcuts.get(this.pluginName)
    if (shortcuts) {
      shortcuts.delete(accelerator)
    }
  }

  /**
   * 注销该插件的所有快捷键
   */
  unregisterAll(): void {
    const shortcuts = pluginShortcuts.get(this.pluginName)
    if (shortcuts) {
      for (const accelerator of shortcuts.keys()) {
        globalShortcut.unregister(accelerator)
      }
      shortcuts.clear()
    }
  }

  /**
   * 检查快捷键是否已注册
   */
  isRegistered(accelerator: string): boolean {
    return globalShortcut.isRegistered(accelerator)
  }
}

// 工厂函数
export function createPluginGlobalShortcut(pluginName: string) {
  return new PluginGlobalShortcut(pluginName)
}
