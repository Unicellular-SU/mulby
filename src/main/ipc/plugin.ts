import { ipcMain } from 'electron'
import { PluginManager } from '../plugin'

export function registerPluginHandlers(manager: PluginManager) {
  // 获取所有插件
  ipcMain.handle('plugin:getAll', () => {
    return manager.getAll().map(p => ({
      name: p.manifest.name,
      displayName: p.manifest.displayName,
      description: p.manifest.description,
      icon: p.manifest.icon,
      triggers: p.manifest.triggers,
      enabled: p.enabled
    }))
  })

  // 搜索插件
  ipcMain.handle('plugin:search', (_, query: string) => {
    return manager.search(query).map(p => ({
      name: p.manifest.name,
      displayName: p.manifest.displayName,
      description: p.manifest.description,
      icon: p.manifest.icon,
      triggers: p.manifest.triggers,
      enabled: p.enabled
    }))
  })

  // 执行插件
  ipcMain.handle('plugin:run', async (_, name: string) => {
    return manager.run(name)
  })
}
