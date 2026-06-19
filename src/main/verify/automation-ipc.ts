import { ipcMain } from 'electron'
import log from 'electron-log'
import type { PluginManager } from '../plugin'
import { ThemeManager } from '../services/theme'
import { appSettingsManager } from '../services/app-settings'
import { registerThemeHandlers } from '../ipc/theme'
import { registerStorageHandlers } from '../ipc/storage'
import { registerPluginHandlers } from '../ipc/plugin'
import { registerClipboardHandlers } from '../ipc/clipboard'
import { registerNotificationHandlers } from '../ipc/notification'
import { registerScreenHandlers } from '../ipc/screen'
import { registerHostHandlers } from '../ipc/host'
import { registerDirectoryAccessHandlers } from '../ipc/directory-access'
import { registerFilesystemHandlers } from '../ipc/filesystem'
import { registerDialogHandlers } from '../ipc/dialog'

let registered = false

/**
 * 为「插件 UI 离屏验证 / MCP 自动化」注册插件 UI 挂载常用的最小 IPC 处理器子集（一次性，幂等）。
 *
 * 刻意避免调用完整的 registerAllHandlers：它需要构造重型 manager（剪贴板 koffi 原生库、
 * 全局快捷键、各类窗口管理器，其中 ActionMenuWindowManager 在构造时即注册 IPC），在 headless
 * 验证场景既不需要也有副作用。这里只注册依赖轻量、且插件 UI 挂载常调用的处理器。
 *
 * 未覆盖的渠道在被调用时会产生「No handler registered」——ui-render 会将其降级为非致命的
 * missingBridge 提示，与插件自身错误区分。
 */
export function ensureAutomationIpcHandlers(pluginManager: PluginManager): void {
  if (registered) return
  registered = true
  try {
    const themeManager = new ThemeManager()
    registerThemeHandlers(themeManager)
    registerStorageHandlers()
    registerPluginHandlers(pluginManager)
    registerHostHandlers(pluginManager)
    registerClipboardHandlers()
    registerNotificationHandlers()
    registerScreenHandlers()
    registerDirectoryAccessHandlers()
    registerFilesystemHandlers()
    registerDialogHandlers()
    // 真实 registerSettingsHandlers 依赖 AppShortcutManager（构造成本高），这里只补插件 UI 常读取的 settings:get。
    // 返回形状须与真实处理器一致：{ settings, shortcutStatus }（验证场景下 shortcutStatus 用空对象兜底）。
    ipcMain.handle('settings:get', () => ({
      settings: appSettingsManager.getSettings(),
      shortcutStatus: {}
    }))
  } catch (err) {
    log.warn('[VerifyMode] 注册自动化 IPC 处理器出错:', err)
  }
}
