import { ipcMain } from 'electron'
import log from 'electron-log'
import { pluginGeolocation } from '../plugin/geolocation'

export function registerGeolocationHandlers() {
  log.info('[IPC] Registering geolocation handlers')

  // 获取位置权限状态
  ipcMain.handle('geolocation:getAccessStatus', () => {
    log.info('[IPC] geolocation:getAccessStatus called')
    const status = pluginGeolocation.getAccessStatus()
    log.info(`[IPC] geolocation:getAccessStatus result: ${status}`)
    return status
  })

  // 请求位置权限
  ipcMain.handle('geolocation:requestAccess', async (event) => {
    log.info('[IPC] geolocation:requestAccess called')
    const result = await pluginGeolocation.requestAccess(event.sender)
    log.info(`[IPC] geolocation:requestAccess result: ${result}`)
    return result
  })

  // 检查是否可以获取位置
  ipcMain.handle('geolocation:canGetPosition', () => {
    log.info('[IPC] geolocation:canGetPosition called')
    return pluginGeolocation.canGetPosition()
  })

  // 打开系统位置设置
  ipcMain.handle('geolocation:openSettings', () => {
    log.info('[IPC] geolocation:openSettings called')
    pluginGeolocation.openSettings()
  })

  // 获取当前位置（macOS 原生定位优先，IP 地理定位作为后备）
  ipcMain.handle('geolocation:getCurrentPosition', async (event) => {
    log.info('[IPC] geolocation:getCurrentPosition called')
    try {
      const position = await pluginGeolocation.getCurrentPosition(event.sender)
      log.info('[IPC] geolocation:getCurrentPosition result:', position)
      return position
    } catch (error) {
      log.error('[IPC] geolocation:getCurrentPosition error:', error)
      throw error
    }
  })
}
