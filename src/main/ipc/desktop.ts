import { ipcMain } from 'electron'
import { pluginDesktop } from '../plugin/desktop'
import { appSettingsManager } from '../services/app-settings'

export function registerDesktopHandlers() {
  // 系统文件搜索
  // 返回 { name, path, isDirectory, size }[]
  ipcMain.handle('desktop:searchFiles', async (_, query: string, limit?: number) => {
    const settings = appSettingsManager.getSettings()
    if (!settings.search.enableFiles) return []
    return pluginDesktop.searchFiles(query, limit)
  })

  // 系统应用搜索
  // 返回 { name, path, kind }[]
  ipcMain.handle('desktop:searchApps', async (_, query: string, limit?: number) => {
    const settings = appSettingsManager.getSettings()
    if (!settings.search.enableApps) return []
    return pluginDesktop.searchApps(query, limit)
  })
}

