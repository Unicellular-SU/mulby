import { ipcMain } from 'electron'
import { PluginManager } from '../plugin'
import { PluginInstaller } from '../plugin/installer'

export function registerPluginHandlers(manager: PluginManager) {
  const installer = new PluginInstaller()
  // 获取所有插件
  ipcMain.handle('plugin:getAll', () => {
    return manager.getAll().map(p => ({
      id: p.id,
      name: p.manifest.name,
      displayName: p.manifest.displayName,
      description: p.manifest.description,
      features: manager.getFeatures(p.id),
      enabled: p.enabled
    }))
  })

  // 搜索插件（返回匹配的功能入口）
  ipcMain.handle('plugin:search', (_, query: string) => {
    return manager.search(query).map(result => ({
      pluginId: result.plugin.id,
      pluginName: result.plugin.manifest.name,
      displayName: result.plugin.manifest.displayName,
      featureCode: result.feature.code,
      featureExplain: result.feature.explain,
      matchType: result.matchType,
      icon: result.plugin.resolvedIcon
    }))
  })

  // 执行插件
  ipcMain.handle('plugin:run', async (_, name: string, featureCode: string, input?: string) => {
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
    return manager.enable(name)
  })

  // 禁用插件
  ipcMain.handle('plugin:disable', async (_, name: string) => {
    return manager.disable(name)
  })

  // 卸载插件
  ipcMain.handle('plugin:uninstall', async (_, name: string) => {
    return manager.uninstall(name)
  })

  // 获取插件文档
  ipcMain.handle('plugin:getReadme', async (_, name: string) => {
    return manager.getReadme(name)
  })
}
