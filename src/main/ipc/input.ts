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

  // 模拟按键 API
  ipcMain.handle('input:simulateKeyboardTap', (_, key: string, modifiers: string[]) =>
    pluginInput.simulateKeyboardTap(key, ...modifiers)
  )

  ipcMain.handle('input:simulateMouseMove', (_, x: number, y: number) =>
    pluginInput.simulateMouseMove(x, y)
  )

  ipcMain.handle('input:simulateMouseClick', (_, x: number, y: number) =>
    pluginInput.simulateMouseClick(x, y)
  )

  ipcMain.handle('input:simulateMouseDoubleClick', (_, x: number, y: number) =>
    pluginInput.simulateMouseDoubleClick(x, y)
  )

  ipcMain.handle('input:simulateMouseRightClick', (_, x: number, y: number) =>
    pluginInput.simulateMouseRightClick(x, y)
  )
}
