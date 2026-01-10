import { ipcMain } from 'electron'
import { pluginShell } from '../plugin/shell'

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
}
