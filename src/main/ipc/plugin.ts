import { ipcMain, app } from 'electron'
import { resolve } from 'path'
import { PluginManager } from '../plugin'
import { resolveIcon } from '../plugin/icon-resolver'
import type { InputPayload } from '../../shared/types/plugin'
import { PluginInstaller } from '../plugin/installer'

export function registerPluginHandlers(manager: PluginManager) {
  const installer = new PluginInstaller()
  const userPluginsDir = resolve(app.getPath('userData'), 'plugins')
  const isBuiltin = (pluginPath: string) => !resolve(pluginPath).startsWith(userPluginsDir)
  // 获取所有插件
  ipcMain.handle('plugin:getAll', () => {
    return manager.getAll().map(p => ({
      id: p.id,
      name: p.manifest.name,
      displayName: p.manifest.displayName,
      description: p.manifest.description,
      version: p.manifest.version,
      author: p.manifest.author,
      homepage: p.manifest.homepage,
      main: p.manifest.main,
      ui: p.manifest.ui,
      window: p.manifest.window,
      icon: p.resolvedIcon,
      path: p.path,
      builtin: isBuiltin(p.path),
      isDev: p.isDev,
      features: manager.getFeatures(p.id),
      enabled: p.enabled
    }))
  })

  // 搜索插件（返回匹配的功能入口）
  ipcMain.handle('plugin:search', async (_, query: string | InputPayload) => {
    const searchResults = await manager.search(query)

    return Promise.all(searchResults.map(async result => {
      // 优先使用功能独立图标，否则使用插件图标
      let icon = result.plugin.resolvedIcon
      if (result.feature.icon) {
        const featureIcon = await resolveIcon(result.feature.icon, result.plugin.path)
        if (featureIcon) {
          icon = featureIcon
        }
      }

      return {
        pluginId: result.plugin.id,
        pluginName: result.plugin.manifest.name,
        displayName: result.plugin.manifest.displayName,
        featureCode: result.feature.code,
        featureExplain: result.feature.explain,
        matchType: result.matchType,
        icon
      }
    }))
  })

  // 执行插件
  ipcMain.handle('plugin:run', async (_, name: string, featureCode: string, input?: string | InputPayload) => {
    return manager.run(name, featureCode, input)
  })

  // 安装插件
  ipcMain.handle('plugin:install', async (_, filePath: string) => {
    const result = await installer.install(filePath)
    if (result.success) {
      await manager.init() // 重新加载插件
      if (result.pluginName) {
        await manager.initializePlugin(result.pluginName)
      }
    }
    return result
  })

  // 启用插件
  ipcMain.handle('plugin:enable', async (_, name: string) => {
    const plugin = manager.get(name)
    if (plugin && isBuiltin(plugin.path)) {
      return { success: false, error: '内置插件不支持禁用' }
    }
    return manager.enable(name)
  })

  // 禁用插件
  ipcMain.handle('plugin:disable', async (_, name: string) => {
    const plugin = manager.get(name)
    if (plugin && isBuiltin(plugin.path)) {
      return { success: false, error: '内置插件不支持禁用' }
    }
    return manager.disable(name)
  })

  // 卸载插件
  ipcMain.handle('plugin:uninstall', async (_, name: string) => {
    const plugin = manager.get(name)
    if (plugin && isBuiltin(plugin.path)) {
      return { success: false, error: '内置插件不支持卸载' }
    }
    return manager.uninstall(name)
  })

  // 获取插件文档
  ipcMain.handle('plugin:getReadme', async (_, name: string) => {
    return manager.getReadme(name)
  })

  // 列出所有后台插件
  ipcMain.handle('plugin:listBackground', () => {
    const backgroundPlugins = manager.getBackgroundManager().list()
    const activeHosts = manager.getHostManager().getActiveHosts()
    const allPlugins = manager.getAll()

    // 合并后台插件和其他活跃插件
    const result = []
    const addedPlugins = new Set<string>()

    // 先添加后台插件
    for (const bgPlugin of backgroundPlugins) {
      result.push({
        ...bgPlugin,
        runMode: 'background' as const
      })
      addedPlugins.add(bgPlugin.pluginId)
    }

    // 添加其他活跃的插件（有 Host 进程但不在后台列表中的）
    for (const hostPluginId of activeHosts) {
      if (!addedPlugins.has(hostPluginId)) {
        const plugin = allPlugins.find(p => p.id === hostPluginId)
        if (plugin) {
          const watchdog = manager.getHostManager().getWatchdog()
          const health = watchdog.getHostHealth(hostPluginId)
          const hostInfo = manager.getHostManager().getHostInfo(hostPluginId)

          result.push({
            pluginId: plugin.id,
            pluginName: plugin.manifest.name,
            displayName: plugin.manifest.displayName,
            startedAt: hostInfo?.startedAt ?? Date.now(),
            uptime: hostInfo?.startedAt ? Date.now() - hostInfo.startedAt : 0,
            persistent: false,
            maxRuntime: 0,
            memoryUsage: health?.memoryUsage ?? 0,
            cpuUsage: health?.cpuUsage ?? 0,
            requestCount: health?.requestCount ?? 0,
            errorCount: health?.errorCount ?? 0,
            healthy: health ? watchdog.isHostHealthy(hostPluginId) : true, // 有健康数据才判断，否则视为健康
            lastHeartbeat: health?.lastHeartbeat ?? 0,
            missedHeartbeats: health?.missedHeartbeats ?? 0,
            runMode: 'active' as const // 活跃插件（可能是独立窗口或面板）
          })
          addedPlugins.add(hostPluginId)
        }
      }
    }

    return result
  })

  // 停止后台插件
  ipcMain.handle('plugin:stopBackground', async (_, pluginId: string) => {
    await manager.getBackgroundManager().stop(pluginId, 'manual')
    return { success: true }
  })

  // 获取后台插件详细信息
  ipcMain.handle('plugin:getBackgroundInfo', (_, pluginId: string) => {
    return manager.getBackgroundManager().getInfo(pluginId)
  })

  // 手动启动后台插件
  ipcMain.handle('plugin:startBackground', async (_, pluginId: string) => {
    const plugin = manager.get(pluginId)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }
    const success = await manager.getBackgroundManager().start(plugin)
    return { success }
  })

  // 停止运行中的插件（关闭窗口并销毁 Host 进程）
  ipcMain.handle('plugin:stopPlugin', async (_, pluginId: string) => {
    return manager.stopPlugin(pluginId)
  })
}
