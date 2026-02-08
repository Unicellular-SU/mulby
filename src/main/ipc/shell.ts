import { ipcMain } from 'electron'
import { pluginShell } from '../plugin/shell'
import { commandRunnerService } from '../services/command-runner'

export function registerShellHandlers() {
  // 打开文件
  ipcMain.handle('shell:openPath', async (_, path: string) => {
    return pluginShell.openPath(path)
  })

  // 打开 URL
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    return pluginShell.openExternal(url)
  })

  // 在文件管理器中显示
  ipcMain.handle('shell:showItemInFolder', (_, path: string) => {
    pluginShell.showItemInFolder(path)
  })

  // 打开文件夹
  ipcMain.handle('shell:openFolder', async (_, path: string) => {
    return pluginShell.openFolder(path)
  })

  // 移动到回收站
  ipcMain.handle('shell:trashItem', async (_, path: string) => {
    return pluginShell.trashItem(path)
  })

  // 播放提示音
  ipcMain.handle('shell:beep', () => {
    pluginShell.beep()
  })

  ipcMain.handle('shell:runCommand', async (_event, input) => {
    return await commandRunnerService.runCommand(input, {
      source: 'app'
    })
  })

  ipcMain.handle('shell:getRunCommandPolicy', () => {
    return commandRunnerService.getPolicy()
  })

  ipcMain.handle('shell:updateRunCommandPolicy', (_event, patch) => {
    return commandRunnerService.updatePolicy(patch || {})
  })

  ipcMain.handle('shell:listRunCommandAudit', (_event, limit?: number) => {
    return commandRunnerService.listAudit(limit)
  })

  ipcMain.handle('shell:clearRunCommandAudit', () => {
    return commandRunnerService.clearAudit()
  })

  ipcMain.handle('shell:clearRunCommandTrusted', () => {
    return commandRunnerService.clearTrustedFingerprints()
  })
}
