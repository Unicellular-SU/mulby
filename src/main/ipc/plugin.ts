import { ipcMain } from 'electron'
import { PluginManager } from '../plugin'
import { PluginInstaller } from '../plugin/installer'

export function registerPluginHandlers(manager: PluginManager) {
  const installer = new PluginInstaller()
  // 获取所有插件
  ipcMain.handle('plugin:getAll', () => {
    return manager.getAll().map(p => ({
      name: p.manifest.name,
      displayName: p.manifest.displayName,
      description: p.manifest.description,
      features: p.manifest.features,
      enabled: p.enabled
    }))
  })

  // 搜索插件（返回匹配的功能入口）
  ipcMain.handle('plugin:search', (_, query: string) => {
    return manager.search(query).map(result => ({
      pluginName: result.plugin.manifest.name,
      displayName: result.plugin.manifest.displayName,
      featureCode: result.feature.code,
      featureExplain: result.feature.explain,
      matchType: result.matchType
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
      manager.init() // 重新加载插件
    }
    return result
  })
}
