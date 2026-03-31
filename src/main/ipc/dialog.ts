import { dialog, ipcMain } from 'electron'
import { withDialogMode } from '../services/blur-manager'
import { showInternalMessageBox, type UiMessageBoxOptions } from '../services/ui-dialog-service'
import { windowFromWebContents } from '../services/webcontents-registry'

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

export type MessageBoxOptions = UiMessageBoxOptions

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
  ipcMain.handle('dialog:showMessageBox', async (event, options: MessageBoxOptions) => {
    const parentWindow = windowFromWebContents(event.sender)
    return showInternalMessageBox(options, { parentWindow })
  })

  // 错误框
  ipcMain.handle('dialog:showErrorBox', (_, title: string, content: string) => {
    dialog.showErrorBox(title, content)
  })
}
