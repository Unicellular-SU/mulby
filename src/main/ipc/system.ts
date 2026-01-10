import { ipcMain } from 'electron'
import { pluginSystem } from '../plugin/system'

export function registerSystemHandlers() {
  // 获取系统信息
  ipcMain.handle('system:getSystemInfo', () => {
    return pluginSystem.getSystemInfo()
  })

  // 获取应用信息
  ipcMain.handle('system:getAppInfo', () => {
    return pluginSystem.getAppInfo()
  })

  // 获取特定路径
  ipcMain.handle('system:getPath', (_, name: string) => {
    return pluginSystem.getPath(name as any)
  })

  // 获取环境变量
  ipcMain.handle('system:getEnv', (_, name: string) => {
    return pluginSystem.getEnv(name)
  })

  // 获取系统空闲时间
  ipcMain.handle('system:getIdleTime', () => {
    return pluginSystem.getIdleTime()
  })
}
