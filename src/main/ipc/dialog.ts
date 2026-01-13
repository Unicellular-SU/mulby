import { dialog, ipcMain } from 'electron'
import { withDialogMode } from '../blur-manager'

export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
  properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
}

/**
 * 注册对话框 IPC 处理器
 */
export function registerDialogHandlers() {
  // 打开文件对话框
  ipcMain.handle('dialog:showOpenDialog', async (_, options: OpenDialogOptions = {}) => {
    return withDialogMode(async () => {
      const result = await dialog.showOpenDialog({
        title: options.title,
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel,
        filters: options.filters,
        properties: options.properties || ['openFile']
      })
      return result.canceled ? [] : result.filePaths
    })
  })

  // 保存文件对话框
  ipcMain.handle('dialog:showSaveDialog', async (_, options: SaveDialogOptions = {}) => {
    return withDialogMode(async () => {
      const result = await dialog.showSaveDialog({
        title: options.title,
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel,
        filters: options.filters
      })
      return result.canceled ? null : result.filePath || null
    })
  })

  // 消息框（不需要隐藏窗口，因为它是模态的）
  ipcMain.handle('dialog:showMessageBox', async (_, options: MessageBoxOptions) => {
    const result = await dialog.showMessageBox({
      type: options.type || 'info',
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: options.buttons || ['OK'],
      defaultId: options.defaultId,
      cancelId: options.cancelId
    })
    return result
  })

  // 错误框
  ipcMain.handle('dialog:showErrorBox', (_, title: string, content: string) => {
    dialog.showErrorBox(title, content)
  })
}
