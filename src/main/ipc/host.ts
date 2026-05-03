/**
 * Plugin Host IPC 处理器
 * 处理插件 UI 窗口与 UtilityProcess Host 之间的通信
 */

import { ipcMain } from 'electron'
import { PluginManager } from '../plugin'
import { loggerService } from '../services/logger'
import { logHostIpcError } from './host-error-logging'

export function registerHostHandlers(pluginManager: PluginManager) {
  const hostManager = pluginManager.getHostManager()

  // 插件 UI 调用后端方法
  ipcMain.handle('host:invoke', async (_event, pluginName: string, method: string, ...args: unknown[]) => {
    try {
      const plugin = pluginManager.get(pluginName)
      if (!plugin) {
        throw new Error(`Plugin not found: ${pluginName}`)
      }

      // 确保 Host 已初始化
      if (!hostManager.isHostReady(pluginName)) {
        const inited = await hostManager.initPlugin(plugin)
        if (!inited) {
          throw new Error(`Failed to initialize host for plugin: ${pluginName}`)
        }
      }

      // 调用后端方法（通过 API 代理）
      // 这里的 method 格式为 'namespace.method'，如 'clipboard.readText'
      return await hostManager.invokePluginMethod(pluginName, method, args)
    } catch (error) {
      logHostIpcError(loggerService, 'host:invoke', pluginName, method, error)
      throw error
    }
  })

  // 插件 UI 调用 host 自定义方法
  ipcMain.handle('host:call', async (_event, pluginName: string, method: string, ...args: unknown[]) => {
    try {
      const plugin = pluginManager.get(pluginName)
      if (!plugin) {
        throw new Error(`Plugin not found: ${pluginName}`)
      }

      // 确保 Host 已初始化
      if (!hostManager.isHostReady(pluginName)) {
        const inited = await hostManager.initPlugin(plugin)
        if (!inited) {
          throw new Error(`Failed to initialize host for plugin: ${pluginName}`)
        }
      }

      // 调用插件 host 对象的方法
      return await hostManager.callHostMethod(pluginName, method, args)
    } catch (error) {
      logHostIpcError(loggerService, 'host:call', pluginName, method, error)
      throw error
    }
  })

  // 获取 Host 状态
  ipcMain.handle('host:status', async (_, pluginName: string) => {
    return {
      ready: hostManager.isHostReady(pluginName),
      active: hostManager.getActiveHosts().includes(pluginName)
    }
  })

  // 重启 Host
  ipcMain.handle('host:restart', async (_, pluginName: string) => {
    const plugin = pluginManager.get(pluginName)
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`)
    }

    await hostManager.destroyHost(pluginName)
    return await hostManager.createHost(plugin)
  })
}
