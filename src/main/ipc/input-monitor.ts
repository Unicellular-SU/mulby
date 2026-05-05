import { ipcMain, BrowserWindow } from 'electron'
import { pluginInputMonitor } from '../plugin/input-monitor'
import type { InputMonitorOptions } from '../plugin/input-monitor'
import type { PluginWindowManager } from '../plugin/window'
import { permissionManager } from '../plugin/permission-manager'
import log from 'electron-log'

/**
 * 每个渲染进程（插件 UI 窗口）独立的 inputMonitor 会话追踪。
 * key = webContents.id → value = Set<sessionId>
 */
const webContentsSessions = new Map<number, Set<string>>()

export function registerInputMonitorHandlers(pluginWindowManager: PluginWindowManager) {
  /**
   * 从 IPC sender 反查插件，检查 inputMonitor 权限。
   * 返回 pluginName 或 null（权限不足）。
   */
  function resolvePluginWithPermission(sender: Electron.WebContents): string | null {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) return null
    const plugin = pluginWindowManager.getPluginByWindow(win)
    if (!plugin) return null
    if (plugin.manifest.permissions?.inputMonitor !== true) {
      log.warn(`[IPC:inputMonitor] Plugin "${plugin.id}" lacks inputMonitor permission`)
      return null
    }
    return plugin.id
  }

  ipcMain.handle('inputMonitor:isAvailable', (event) => {
    // No plugin id is needed to check native module availability, but plugin callers
    // still need to declare the capability before probing it.
    permissionManager.ensureCallerAccessPluginPermissions(event.sender, ['inputMonitor'])
    return pluginInputMonitor.isAvailable()
  })

  ipcMain.handle('inputMonitor:requireAccessibility', async (event) => {
    permissionManager.ensureCallerAccessPluginPermissions(event.sender, ['accessibility'])
    return pluginInputMonitor.requireAccessibility()
  })

  ipcMain.handle('inputMonitor:start', async (event, options?: InputMonitorOptions) => {
    permissionManager.ensureCallerAccessPluginPermissions(event.sender, ['inputMonitor', 'accessibility'])
    const pluginName = resolvePluginWithPermission(event.sender)
    if (!pluginName) return null

    const sessionId = await pluginInputMonitor.start(pluginName, options, (inputEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('inputMonitor:event', inputEvent)
      }
    })

    if (sessionId) {
      const wcId = event.sender.id
      if (!webContentsSessions.has(wcId)) {
        webContentsSessions.set(wcId, new Set())

        const capturedPluginName = pluginName
        event.sender.once('destroyed', () => {
          const sessions = webContentsSessions.get(wcId)
          if (sessions) {
            for (const sid of sessions) {
              pluginInputMonitor.stop(capturedPluginName, sid)
            }
            webContentsSessions.delete(wcId)
          }
        })
      }
      webContentsSessions.get(wcId)!.add(sessionId)
    }

    return sessionId
  })

  ipcMain.handle('inputMonitor:stop', (event, sessionId: string) => {
    permissionManager.ensureCallerAccessPluginPermissions(event.sender, ['inputMonitor'])
    const pluginName = resolvePluginWithPermission(event.sender)
    if (!pluginName) return
    pluginInputMonitor.stop(pluginName, sessionId)
    webContentsSessions.get(event.sender.id)?.delete(sessionId)
  })

  log.info('[IPC] inputMonitor handlers registered')
}
