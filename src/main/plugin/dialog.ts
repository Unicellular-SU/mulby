import { dialog } from 'electron'
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

export class PluginDialog {
  /**
   * 显示打开文件对话框
   * 使用 withDialogMode 临时隐藏窗口，防止遮挡系统对话框
   */
  async showOpenDialog(options: OpenDialogOptions = {}): Promise<string[]> {
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
  }

  /**
   * 显示保存文件对话框
   * 使用 withDialogMode 临时隐藏窗口，防止遮挡系统对话框
   */
  async showSaveDialog(options: SaveDialogOptions = {}): Promise<string | null> {
    return withDialogMode(async () => {
      const result = await dialog.showSaveDialog({
        title: options.title,
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel,
        filters: options.filters
      })
      return result.canceled ? null : result.filePath || null
    })
  }

  /**
   * 显示消息框
   */
  async showMessageBox(options: MessageBoxOptions): Promise<{ response: number; checkboxChecked: boolean }> {
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
  }

  /**
   * 显示错误框
   */
  showErrorBox(title: string, content: string): void {
    dialog.showErrorBox(title, content)
  }
}

export const pluginDialog = new PluginDialog()
