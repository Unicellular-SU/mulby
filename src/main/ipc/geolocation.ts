import { ipcMain } from 'electron'
import { pluginGeolocation } from '../plugin/geolocation'

export function registerGeolocationHandlers() {
  // 获取位置权限状态
  ipcMain.handle('geolocation:getAccessStatus', () => {
    return pluginGeolocation.getAccessStatus()
  })
}
