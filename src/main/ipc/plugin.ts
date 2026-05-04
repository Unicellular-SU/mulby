import { ipcMain, app } from 'electron'
import { resolve } from 'path'
import { PluginManager } from '../plugin'
import type { PluginToolRegistry } from '../plugin/plugin-tools'
import { buildFeatureIconCacheKey } from '../plugin/dev-reload-utils'
import { resolveIcon, resolveIconSync } from '../plugin/icon-resolver'
import type {
  BackgroundPluginInfo,
  InputPayload,
  Plugin,
  PluginCommandDisabledToggleInput,
  PluginCommandRunInput,
  PluginCommandShortcutBindInput,
  PluginFeature
} from '../../shared/types/plugin'
import { PluginInstaller } from '../plugin/installer'
import { PluginStoreService } from '../plugin/store-service'
import { queryMainPush, handleMainPushSelect, hasMainPushHandler, type MainPushItem } from '../plugin/dynamic-features'



export function registerPluginHandlers(manager: PluginManager, pluginToolRegistry?: PluginToolRegistry): { warmupFeatureIconCache: () => void } {
  const installer = new PluginInstaller()
  const storeService = new PluginStoreService(manager, installer)
  const userPluginsDir = resolve(app.getPath('userData'), 'plugins')
  const isBuiltin = (pluginPath: string) => !resolve(pluginPath).startsWith(userPluginsDir)
  const featureIconCache = new Map<string, Awaited<ReturnType<typeof resolveIcon>> | null>()

  // 预热所有启用插件的 feature 图标缓存
  // 搜索时 formatResultItem 直接从缓存读取，零异步开销
  // 注意：此函数必须在 pluginManager.init() 完成后调用，否则 getEnabled() 为空
  const warmupFeatureIconCache = () => {
    const enabledPlugins = manager.getEnabled()
    if (enabledPlugins.length === 0) return
    for (const plugin of enabledPlugins) {
      const features = manager.getFeatures(plugin.id)
      for (const feature of features) {
        if (!feature.icon) continue
        const cacheKey = buildFeatureIconCacheKey(plugin.id, feature, plugin.path)
        if (featureIconCache.has(cacheKey)) continue
        // 异步预热，不阻塞
        void resolveIcon(feature.icon, plugin.path).then((resolved) => {
          featureIconCache.set(cacheKey, resolved || null)
        }).catch(() => {
          featureIconCache.set(cacheKey, null)
        })
      }
    }
  }

  const resolveResultIcon = async (
    plugin: Plugin,
    feature: PluginFeature,
    fallback: Plugin['resolvedIcon']
  ) => {
    const featureIcon = feature.icon
    if (!featureIcon) {
      return {
        icon: fallback,
        featureIconRequested: false,
        cacheHit: false
      }
    }
    const cacheKey = buildFeatureIconCacheKey(plugin.id, feature, plugin.path)
    const cached = featureIconCache.get(cacheKey)
    if (cached !== undefined) {
      return {
        icon: cached || fallback,
        featureIconRequested: true,
        cacheHit: true
      }
    }
    const resolved = await resolveIcon(featureIcon, plugin.path)
    featureIconCache.set(cacheKey, resolved || null)
    return {
      icon: resolved || fallback,
      featureIconRequested: true,
      cacheHit: false
    }
  }

  const formatResultItem = async (
    plugin: Plugin,
    feature: PluginFeature,
    matchType: string
  ): Promise<{
    pluginId: string
    pluginName: string
    displayName: string
    featureCode: string
    featureExplain?: string
    builtin: boolean
    matchType: string
    icon: unknown
    mainPushItems?: MainPushItem[]
  }> => {
    const iconMeta = await resolveResultIcon(plugin, feature, plugin.resolvedIcon)

    return {
      pluginId: plugin.id,
      pluginName: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      featureCode: feature.code,
      featureExplain: feature.explain,
      builtin: isBuiltin(plugin.path),
      matchType,
      icon: iconMeta.icon
    }
  }

  // 获取所有插件
  ipcMain.handle('plugin:getAll', () => {
    return manager.getAll().map(p => {
      const features = manager.getFeatures(p.id).map(f => ({
        ...f,
        icon: f.icon ? resolveIconSync(f.icon, p.path) : undefined
      }))
      return {
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
        features,
        enabled: p.enabled,
        tools: pluginToolRegistry
          ? pluginToolRegistry.getPluginTools(p.id).map(e => ({ name: e.schema.name, description: e.schema.description }))
          : p.manifest.tools?.map(t => ({ name: t.name, description: t.description }))
      }
    })
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
        result.plugin,
        result.feature,
        result.matchType
      )
    ))

    // MainPush: 查询已注册 mainPush handler 且匹配搜索结果的插件
    const text = typeof query === 'string' ? query : query.text || ''
    if (text.trim()) {
      const mainPushPromises: Promise<void>[] = []
      for (let i = 0; i < searchResults.length; i++) {
        const result = searchResults[i]
        if (result.feature.mainPush && hasMainPushHandler(result.plugin.manifest.name)) {
          const idx = i
          mainPushPromises.push(
            queryMainPush(result.plugin.manifest.name, {
              code: result.feature.code,
              type: 'text',
              payload: text
            }).then((items) => {
              if (items.length > 0 && formattedResults[idx]) {
                formattedResults[idx].mainPushItems = items
              }
            })
          )
        }
      }
      if (mainPushPromises.length > 0) {
        await Promise.allSettled(mainPushPromises)
      }
    }

    return formattedResults
  })

  // MainPush: 用户选中推送项
  ipcMain.handle('plugin:mainPushSelect', async (_, pluginName: string, action: { code: string; type: string; payload: string; option: MainPushItem }) => {
    return await handleMainPushSelect(pluginName, action)
  })

  // 最近使用插件
  ipcMain.handle('plugin:getRecentUsed', async (_, limit?: number) => {
    const normalizedLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 20
    const recentResults = manager.getRecentUsed(normalizedLimit)
    const formattedResults = await Promise.all(recentResults.map(async (result) => {
      const item = await formatResultItem(
        result.plugin,
        result.feature,
        'keyword'
      )
      // 附加频次元数据，用于前端计算 Frecency Score
      return {
        ...item,
        lastUsedAt: result.lastUsedAt,
        useCount: result.useCount
      }
    }))
    return formattedResults
  })

  // 搜索偏好设置
  ipcMain.handle('plugin:getSearchPreferences', () => {
    return manager.getSearchPreferences()
  })

  ipcMain.handle('plugin:pinFeature', (_, pluginId: string, featureCode: string) => {
    manager.pinFeature(pluginId, featureCode)
    return { success: true }
  })

  ipcMain.handle('plugin:unpinFeature', (_, pluginId: string, featureCode: string) => {
    manager.unpinFeature(pluginId, featureCode)
    return { success: true }
  })

  ipcMain.handle('plugin:hideFeature', (_, pluginId: string, featureCode: string) => {
    manager.hideFeature(pluginId, featureCode)
    return { success: true }
  })

  ipcMain.handle('plugin:unhideFeature', (_, pluginId: string, featureCode: string) => {
    manager.unhideFeature(pluginId, featureCode)
    return { success: true }
  })

  ipcMain.handle('plugin:removeRecentUsage', (_, pluginId: string, featureCode: string) => {
    manager.removeRecentUsage(pluginId, featureCode)
    return { success: true }
  })

  // 搜索预热：Top N 结果稳定后提前初始化 Host
  ipcMain.handle('plugin:prewarm', (_, pluginId: string) => {
    void manager.prewarm(pluginId)
  })

  // 执行插件
  ipcMain.handle('plugin:run', async (_, name: string, featureCode: string, input?: string | InputPayload, launchStart?: number) => {
    manager.cancelPrewarm(name)
    return manager.run(name, featureCode, input, launchStart)
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
    const activeWindowPlugins = manager.getActiveWindowPlugins()
    const allPlugins = manager.getAll()
    const hostManager = manager.getHostManager()
    const watchdog = hostManager.getWatchdog()
    const now = Date.now()

    // 合并后台插件和其他活跃插件
    const result: BackgroundPluginInfo[] = []
    const pluginIndex = new Map<string, number>()
    const markAdded = (pluginId: string) => pluginIndex.set(pluginId, result.length - 1)

    // 先添加后台插件
    for (const bgPlugin of backgroundPlugins) {
      result.push({
        ...bgPlugin,
        runMode: 'background' as const
      })
      markAdded(bgPlugin.pluginId)
    }

    // 添加其他活跃的插件（有 Host 进程但不在后台列表中的）
    for (const hostPluginId of activeHosts) {
      if (pluginIndex.has(hostPluginId)) {
        continue
      }
      const plugin = allPlugins.find(p => p.id === hostPluginId)
      if (plugin) {
        const health = watchdog.getHostHealth(hostPluginId)
        const hostInfo = hostManager.getHostInfo(hostPluginId)
        const startedAt = hostInfo?.startedAt ?? now

        result.push({
          pluginId: plugin.id,
          pluginName: plugin.manifest.name,
          displayName: plugin.manifest.displayName,
          startedAt,
          uptime: now - startedAt,
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
        markAdded(hostPluginId)
      }
    }

    // 补充“有窗口但 Host 尚未注册/已异常”的活跃插件，避免任务管理器漏项
    for (const windowPlugin of activeWindowPlugins) {
      const existingIndex = pluginIndex.get(windowPlugin.pluginId)
      const health = watchdog.getHostHealth(windowPlugin.pluginId)
      const hostInfo = hostManager.getHostInfo(windowPlugin.pluginId)
      const startedAt = hostInfo?.startedAt ?? windowPlugin.startedAt ?? now

      if (existingIndex !== undefined) {
        const existing = result[existingIndex]
        result[existingIndex] = {
          ...existing,
          startedAt: Math.min(existing.startedAt, startedAt),
          uptime: now - Math.min(existing.startedAt, startedAt),
          runMode: 'active' as const
        }
        continue
      }

      result.push({
        pluginId: windowPlugin.pluginId,
        pluginName: windowPlugin.pluginName,
        displayName: windowPlugin.displayName,
        startedAt,
        uptime: now - startedAt,
        persistent: false,
        maxRuntime: 0,
        memoryUsage: health?.memoryUsage ?? 0,
        cpuUsage: health?.cpuUsage ?? 0,
        requestCount: health?.requestCount ?? 0,
        errorCount: health?.errorCount ?? 0,
        healthy: health ? watchdog.isHostHealthy(windowPlugin.pluginId) : true,
        lastHeartbeat: health?.lastHeartbeat ?? 0,
        missedHeartbeats: health?.missedHeartbeats ?? 0,
        runMode: 'active' as const
      })
      markAdded(windowPlugin.pluginId)
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

  return { warmupFeatureIconCache }
}
