import { ipcMain } from 'electron'
import {
  pluginSystem,
  type PathName,
  type SystemIconBatchOptions,
  type SystemIconRequest,
  type SystemIconSingleOptions
} from '../plugin/system'

export function registerSystemHandlers() {
  // 获取系统信息
  ipcMain.handle('system:getSystemInfo', () => {
    return pluginSystem.getSystemInfo()
  })

  // 获取应用信息
  ipcMain.handle('system:getAppInfo', () => {
    return pluginSystem.getAppInfo()
  })

  // 获取当前应用资源占用
  ipcMain.handle('system:getAppResourceUsage', () => {
    return pluginSystem.getAppResourceUsage()
  })

  // 获取特定路径
  ipcMain.handle('system:getPath', (_, name: PathName) => {
    return pluginSystem.getPath(name)
  })

  // 获取环境变量
  ipcMain.handle('system:getEnv', (_, name: string) => {
    return pluginSystem.getEnv(name)
  })

  // 获取系统空闲时间
  ipcMain.handle('system:getIdleTime', () => {
    return pluginSystem.getIdleTime()
  })

  // 获取文件图标 (新增)
  ipcMain.handle('system:getFileIcon', async (_, filePath: string, options?: SystemIconSingleOptions) => {
    return pluginSystem.getFileIcon(filePath, options)
  })

  ipcMain.handle(
    'system:getFileIcons',
    async (_, requests: SystemIconRequest[], options?: SystemIconBatchOptions) => {
      return pluginSystem.getFileIcons(requests, options)
    }
  )

  ipcMain.handle('system:clearFileIconCache', () => {
    pluginSystem.clearFileIconCache()
    return true
  })

  // 获取设备唯一标识 (新增)
  ipcMain.handle('system:getNativeId', () => {
    return pluginSystem.getNativeId()
  })

  // 判断是否开发环境 (新增)
  ipcMain.handle('system:isDev', () => {
    return pluginSystem.isDev()
  })

  // 平台判断 (新增)
  ipcMain.handle('system:isMacOS', () => {
    return pluginSystem.isMacOS()
  })

  ipcMain.handle('system:isWindows', () => {
    return pluginSystem.isWindows()
  })

  ipcMain.handle('system:isLinux', () => {
    return pluginSystem.isLinux()
  })
}
