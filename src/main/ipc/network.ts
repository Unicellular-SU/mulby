import { ipcMain } from 'electron'
import { pluginNetwork } from '../plugin/network'

export function registerNetworkHandlers() {
  // 检查是否在线
  ipcMain.handle('network:isOnline', () => {
    return pluginNetwork.isOnline()
  })
}
