import { ipcMain } from 'electron'
import { pluginDialog, OpenDialogOptions, SaveDialogOptions, MessageBoxOptions } from '../plugin/dialog'

export function registerDialogHandlers() {
  // 打开文件对话框
  ipcMain.handle('dialog:showOpenDialog', async (_, options?: OpenDialogOptions) => {
    return pluginDialog.showOpenDialog(options)
  })

  // 保存文件对话框
  ipcMain.handle('dialog:showSaveDialog', async (_, options?: SaveDialogOptions) => {
    return pluginDialog.showSaveDialog(options)
  })

  // 消息框
  ipcMain.handle('dialog:showMessageBox', async (_, options: MessageBoxOptions) => {
    return pluginDialog.showMessageBox(options)
  })

  // 错误框
  ipcMain.handle('dialog:showErrorBox', (_, title: string, content: string) => {
    pluginDialog.showErrorBox(title, content)
  })
}
