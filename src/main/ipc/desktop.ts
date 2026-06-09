import { ipcMain } from 'electron'
import { pluginDesktop } from '../plugin/desktop'

export function registerDesktopHandlers() {
  // 系统文件搜索（插件 API）
  // 返回 { name, path, isDirectory, size }[]
  // 不受 settings.search.enableFiles 网关：该开关只决定「主搜索框」是否展示本机文件结果
  // （见 renderer/components/PluginList.tsx），不应阻断插件主动调用此 API——否则
  // 「本地搜索」这类专用插件会因为默认关闭的开关而完全搜不出文件。
  ipcMain.handle('desktop:searchFiles', async (_, query: string, limit?: number) => {
    return pluginDesktop.searchFiles(query, limit)
  })

  // 系统应用搜索（插件 API）
  // 返回 { name, path, kind }[]
  // 同理不受 settings.search.enableApps 网关：该开关只决定主搜索框是否展示本机应用结果。
  ipcMain.handle('desktop:searchApps', async (_, query: string, limit?: number) => {
    return pluginDesktop.searchApps(query, limit)
  })
}
