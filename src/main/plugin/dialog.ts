import { BrowserWindow, dialog } from 'electron'
import { withIgnoringBlur } from '../services/blur-manager'
import { showInternalMessageBox, type UiMessageBoxOptions } from '../services/ui-dialog-service'

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

export type PluginWindowResolver = (pluginId: string) => BrowserWindow | null

let globalPluginWindowResolver: PluginWindowResolver | undefined

/**
 * 注册全局插件窗口解析器（在 index.ts 中调用，注入 pluginWindowManager 的查找能力）
 */
export function setPluginDialogWindowResolver(resolver: PluginWindowResolver): void {
  globalPluginWindowResolver = resolver
}

export class PluginDialog {
  constructor(private readonly pluginId?: string) {}

  private resolveParentWindow(): BrowserWindow | undefined {
    if (this.pluginId && globalPluginWindowResolver) {
      const win = globalPluginWindowResolver(this.pluginId)
      if (win && !win.isDestroyed()) return win
    }
    return BrowserWindow.getFocusedWindow() ?? undefined
  }

  /**
   * 显示打开文件对话框
   * 传递 parentWindow 使对话框置于窗口顶层，避免隐藏/恢复窗口
   */
  async showOpenDialog(options: OpenDialogOptions = {}): Promise<string[]> {
    return withIgnoringBlur(async () => {
      const parent = this.resolveParentWindow()
      const dialogOpts: Electron.OpenDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel,
        filters: options.filters,
        properties: options.properties || ['openFile']
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts)
      return result.canceled ? [] : result.filePaths
    })
  }

  /**
   * 显示保存文件对话框
   * 传递 parentWindow 使对话框置于窗口顶层，避免隐藏/恢复窗口
   */
  async showSaveDialog(options: SaveDialogOptions = {}): Promise<string | null> {
    return withIgnoringBlur(async () => {
      const parent = this.resolveParentWindow()
      const dialogOpts: Electron.SaveDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel,
        filters: options.filters
      }
      const result = parent
        ? await dialog.showSaveDialog(parent, dialogOpts)
        : await dialog.showSaveDialog(dialogOpts)
      return result.canceled ? null : result.filePath || null
    })
  }

  /**
   * 显示消息框
   */
  async showMessageBox(options: MessageBoxOptions): Promise<{ response: number; checkboxChecked: boolean }> {
    return showInternalMessageBox(options)
  }

  /**
   * 显示错误框
   */
  showErrorBox(title: string, content: string): void {
    dialog.showErrorBox(title, content)
  }
}
