import { dialog, ipcMain } from 'electron'
import { withIgnoringBlur } from '../services/blur-manager'
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
  // Pass the parent window so the dialog appears on top of it (as a sheet on
  // macOS or a child window on Windows/Linux) without hiding the app windows.
  ipcMain.handle('dialog:showOpenDialog', async (event, options: OpenDialogOptions = {}) => {
    return withIgnoringBlur(async () => {
      const parentWindow = windowFromWebContents(event.sender) ?? undefined
      const dialogOpts: Electron.OpenDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel,
        filters: options.filters,
        properties: options.properties || ['openFile']
      }
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts)
      return result.canceled ? [] : result.filePaths
    })
  })

  // 保存文件对话框
  ipcMain.handle('dialog:showSaveDialog', async (event, options: SaveDialogOptions = {}) => {
    return withIgnoringBlur(async () => {
      const parentWindow = windowFromWebContents(event.sender) ?? undefined
      const dialogOpts: Electron.SaveDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel,
        filters: options.filters
      }
      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, dialogOpts)
        : await dialog.showSaveDialog(dialogOpts)
      return result.canceled ? null : result.filePath || null
    })
  })

  // 消息框（不需要隐藏窗口，因为它是模态的）
  ipcMain.handle('dialog:showMessageBox', async (event, options: MessageBoxOptions) => {
    const parentWindow = windowFromWebContents(event.sender)
    return showInternalMessageBox(options, { parentWindow })
  })

  // 错误框
  ipcMain.handle('dialog:showErrorBox', async (event, title: string, content: string) => {
    const parentWindow = windowFromWebContents(event.sender)
    await showInternalMessageBox({
      type: 'error',
      title,
      message: content,
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0
    }, { parentWindow })
  })
}
