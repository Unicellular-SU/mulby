import { ipcMain, app } from 'electron'
import { resolve } from 'path'
import { PluginManager } from '../plugin'
import { resolveIcon } from '../plugin/icon-resolver'
import type {
  InputPayload,
  Plugin,
  PluginCommandDisabledToggleInput,
  PluginCommandRunInput,
  PluginCommandShortcutBindInput,
  PluginFeature
} from '../../shared/types/plugin'
import { PluginInstaller } from '../plugin/installer'
import { PluginStoreService } from '../plugin/store-service'



export function registerPluginHandlers(manager: PluginManager) {
  const installer = new PluginInstaller()
  const storeService = new PluginStoreService(manager, installer)
  const userPluginsDir = resolve(app.getPath('userData'), 'plugins')
  const isBuiltin = (pluginPath: string) => !resolve(pluginPath).startsWith(userPluginsDir)
  const featureIconCache = new Map<string, Awaited<ReturnType<typeof resolveIcon>> | null>()

  const resolveResultIcon = async (
    cacheKey: string,
    pluginPath: string,
    featureIcon: PluginFeature['icon'] | undefined,
    fallback: Plugin['resolvedIcon']
  ) => {
    if (!featureIcon) {
      return {
        icon: fallback,
        featureIconRequested: false,
        cacheHit: false
      }
    }
    const cached = featureIconCache.get(cacheKey)
    if (cached !== undefined) {
      return {
        icon: cached || fallback,
        featureIconRequested: true,
        cacheHit: true
      }
    }
    const resolved = await resolveIcon(featureIcon, pluginPath)
    featureIconCache.set(cacheKey, resolved || null)
    return {
      icon: resolved || fallback,
      featureIconRequested: true,
      cacheHit: false
    }
  }

  const formatResultItem = async (
    cacheKey: string,
    plugin: Plugin,
    feature: PluginFeature,
    matchType: string
  ) => {
    const iconMeta = await resolveResultIcon(cacheKey, plugin.path, feature.icon, plugin.resolvedIcon)

    return {
      pluginId: plugin.id,
      pluginName: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      featureCode: feature.code,
      featureExplain: feature.explain,
      matchType,
      icon: iconMeta.icon
    }
  }

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

  // 获取命令清单（功能指令 + 匹配指令）
  ipcMain.handle('plugin:listCommands', (_event, pluginId?: string) => {
    return manager.listCommands(pluginId)
  })

  // 指令快捷键绑定列表
  ipcMain.handle('plugin:commandShortcut:list', (_event, pluginId?: string) => {
    return manager.listCommandShortcuts(pluginId)
  })

  // 绑定指令快捷键
  ipcMain.handle('plugin:commandShortcut:bind', (_event, input: PluginCommandShortcutBindInput) => {
    return manager.bindCommandShortcut(input)
  })

  // 解绑指令快捷键
  ipcMain.handle('plugin:commandShortcut:unbind', (_event, bindingId: string) => {
    return { success: manager.unbindCommandShortcut(bindingId) }
  })

  // 验证快捷键是否可用
  ipcMain.handle('plugin:commandShortcut:validate', (_event, accelerator: string, bindingId?: string) => {
    return manager.validateCommandShortcut(accelerator, bindingId)
  })

  // 搜索插件（返回匹配的功能入口）
  ipcMain.handle('plugin:search', async (_, query: string | InputPayload) => {
    const searchResults = await manager.search(query)
    const formattedResults = await Promise.all(searchResults.map((result) =>
      formatResultItem(
        `${result.plugin.id}:${result.feature.code}`,
        result.plugin,
        result.feature,
        result.matchType
      )
    ))

    return formattedResults
  })

  // 最近使用插件
  ipcMain.handle('plugin:getRecentUsed', async (_, limit?: number) => {
    const normalizedLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 20
    const recentResults = manager.getRecentUsed(normalizedLimit)
    const formattedResults = await Promise.all(recentResults.map((result) =>
      formatResultItem(
        `${result.plugin.id}:${result.feature.code}`,
        result.plugin,
        result.feature,
        'keyword'
      )
    ))
    return formattedResults
  })

  // 执行插件
  ipcMain.handle('plugin:run', async (_, name: string, featureCode: string, input?: string | InputPayload) => {
    return manager.run(name, featureCode, input)
  })

  // 执行指定指令
  ipcMain.handle('plugin:runCommand', async (_event, input: PluginCommandRunInput) => {
    return manager.runCommand(input)
  })

  // 指令禁用/启用
  ipcMain.handle('plugin:command:setDisabled', (_event, input: PluginCommandDisabledToggleInput) => {
    return manager.setCommandDisabled(input)
  })

  // 安装插件
  ipcMain.handle('plugin:install', async (_, filePath: string) => {
    const result = await installer.install(filePath)
    if (result.success && result.action !== 'already-installed') {
      await manager.init() // 重新加载插件
      if (result.pluginName) {
        await manager.initializePlugin(result.pluginName)
      }
    }
    return result
  })

  // 拉取插件商店索引
  ipcMain.handle('plugin:store:fetch', async () => {
    return storeService.fetchStoreEntries()
  })

  // 从插件商店 URL 下载并安装
  ipcMain.handle('plugin:store:installFromUrl', async (_, input) => {
    return storeService.installFromUrl(input || {})
  })

  // 检查已安装插件更新
  ipcMain.handle('plugin:store:checkUpdatesInstalled', async () => {
    return storeService.checkInstalledUpdates()
  })

  // 批量更新
  ipcMain.handle('plugin:store:updateAll', async (_, pluginIds?: string[]) => {
    return storeService.updateAll(pluginIds)
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
