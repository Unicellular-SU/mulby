import { ipcMain } from 'electron'
import { pluginInput } from '../plugin/input'

export function registerInputHandlers() {
  ipcMain.handle('input:hideMainWindowPasteText', (_, text: string) =>
    pluginInput.hideMainWindowPasteText(text)
  )

  ipcMain.handle('input:hideMainWindowPasteImage', (_, image: string | Buffer) =>
    pluginInput.hideMainWindowPasteImage(image)
  )

  ipcMain.handle('input:hideMainWindowPasteFile', (_, filePaths: string | string[]) =>
    pluginInput.hideMainWindowPasteFile(filePaths)
  )

  ipcMain.handle('input:hideMainWindowTypeString', (_, text: string) =>
    pluginInput.hideMainWindowTypeString(text)
  )
}
