import { ipcMain, powerMonitor, BrowserWindow } from 'electron'
import { pluginPowerMonitor } from '../plugin/power'

export function registerPowerMonitorHandlers() {
  // 获取系统空闲时间
  ipcMain.handle('power:getSystemIdleTime', () => {
    return pluginPowerMonitor.getSystemIdleTime()
  })

  // 获取系统空闲状态
  ipcMain.handle('power:getSystemIdleState', (_, idleThreshold: number) => {
    return pluginPowerMonitor.getSystemIdleState(idleThreshold)
  })

  // 是否使用电池供电
  ipcMain.handle('power:isOnBatteryPower', () => {
    return pluginPowerMonitor.isOnBatteryPower()
  })

  // 获取热状态
  ipcMain.handle('power:getCurrentThermalState', () => {
    return pluginPowerMonitor.getCurrentThermalState()
  })

  // 监听电源事件并转发给渲染进程
  powerMonitor.on('suspend', () => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('power:suspend')
    })
  })

  powerMonitor.on('resume', () => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('power:resume')
    })
  })

  powerMonitor.on('on-ac', () => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('power:on-ac')
    })
  })

  powerMonitor.on('on-battery', () => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('power:on-battery')
    })
  })

  powerMonitor.on('lock-screen', () => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('power:lock-screen')
    })
  })

  powerMonitor.on('unlock-screen', () => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('power:unlock-screen')
    })
  })
}
