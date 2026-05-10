import { ipcMain } from 'electron'
import { pluginInput } from '../plugin/input'

function normalizeModifierArguments(modifiers: unknown): string[] {
  if (modifiers === undefined || modifiers === null) {
    return []
  }
  return (Array.isArray(modifiers) ? modifiers : [modifiers]) as string[]
}

export function registerInputHandlers() {
  ipcMain.handle('input:hideMainWindowPasteText', (_, text: unknown) =>
    pluginInput.hideMainWindowPasteText(text as string)
  )

  ipcMain.handle('input:hideMainWindowPasteImage', (_, image: unknown) =>
    pluginInput.hideMainWindowPasteImage(image as string | Buffer | ArrayBuffer | Uint8Array)
  )

  ipcMain.handle('input:hideMainWindowPasteFile', (_, filePaths: unknown) =>
    pluginInput.hideMainWindowPasteFile(filePaths as string | string[])
  )

  ipcMain.handle('input:hideMainWindowTypeString', (_, text: unknown) =>
    pluginInput.hideMainWindowTypeString(text as string)
  )

  ipcMain.handle('input:restoreWindows', () =>
    pluginInput.restoreWindows()
  )

  // 模拟按键 API
  ipcMain.handle('input:simulateKeyboardTap', (_, key: unknown, modifiers: unknown) =>
    pluginInput.simulateKeyboardTap(key as string, ...normalizeModifierArguments(modifiers))
  )

  ipcMain.handle('input:simulateMouseMove', (_, x: unknown, y: unknown) =>
    pluginInput.simulateMouseMove(x as number, y as number)
  )

  ipcMain.handle('input:simulateMouseClick', (_, x: unknown, y: unknown) =>
    pluginInput.simulateMouseClick(x as number, y as number)
  )

  ipcMain.handle('input:simulateMouseDoubleClick', (_, x: unknown, y: unknown) =>
    pluginInput.simulateMouseDoubleClick(x as number, y as number)
  )

  ipcMain.handle('input:simulateMouseRightClick', (_, x: unknown, y: unknown) =>
    pluginInput.simulateMouseRightClick(x as number, y as number)
  )
}
