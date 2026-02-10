import { ipcMain } from 'electron'
import { pluginDesktop } from '../plugin/desktop'

export function registerDesktopHandlers() {
  // 系统文件搜索
  // 返回 { name, path, isDirectory, size }[]
  ipcMain.handle('desktop:searchFiles', async (_, query: string, limit?: number) => {
    return pluginDesktop.searchFiles(query, limit)
  })

  // 系统应用搜索
  // 返回 { name, path, kind }[]
  ipcMain.handle('desktop:searchApps', async (_, query: string, limit?: number) => {
    return pluginDesktop.searchApps(query, limit)
  })
}
