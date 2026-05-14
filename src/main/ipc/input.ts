import { ipcMain } from 'electron'
import { pluginInput, simulateKeyboardTapForInputContext, type InputInvocationContext } from '../plugin/input'
import { windowFromWebContents } from '../services/webcontents-registry'

function normalizeModifierArguments(modifiers: unknown): string[] {
  if (modifiers === undefined || modifiers === null) {
    return []
  }
  return (Array.isArray(modifiers) ? modifiers : [modifiers]) as string[]
}

export function registerInputHandlers() {
  const getInputContext = (event: Electron.IpcMainInvokeEvent): InputInvocationContext => {
    const callerWindow = windowFromWebContents(event.sender)
    return {
      callerWindowId: callerWindow?.id,
      callerNativeWindowHandle: process.platform === 'win32' && callerWindow && !callerWindow.isDestroyed()
        ? callerWindow.getNativeWindowHandle()
        : undefined,
      callerLinuxWindowId: process.platform === 'linux' && callerWindow && !callerWindow.isDestroyed()
        ? String(callerWindow.getNativeWindowHandle())
        : undefined
    }
  }

  ipcMain.handle('input:hideMainWindowPasteText', (event, text: unknown) =>
    pluginInput.hideMainWindowPasteText(text as string, getInputContext(event))
  )

  ipcMain.handle('input:hideMainWindowPasteImage', (event, image: unknown) =>
    pluginInput.hideMainWindowPasteImage(image as string | Buffer | ArrayBuffer | Uint8Array, getInputContext(event))
  )

  ipcMain.handle('input:hideMainWindowPasteFile', (event, filePaths: unknown) =>
    pluginInput.hideMainWindowPasteFile(filePaths as string | string[], getInputContext(event))
  )

  ipcMain.handle('input:hideMainWindowTypeString', (event, text: unknown) =>
    pluginInput.hideMainWindowTypeString(text as string, getInputContext(event))
  )

  ipcMain.handle('input:restoreWindows', () =>
    pluginInput.restoreWindows()
  )

  // 模拟按键 API
  ipcMain.handle('input:simulateKeyboardTap', (event, key: unknown, modifiers: unknown) =>
    simulateKeyboardTapForInputContext(getInputContext(event), key as string, ...normalizeModifierArguments(modifiers))
  )

  ipcMain.handle('input:simulateMouseMove', (event, x: unknown, y: unknown) =>
    pluginInput.simulateMouseMove(x as number, y as number, getInputContext(event))
  )

  ipcMain.handle('input:simulateMouseClick', (event, x: unknown, y: unknown) =>
    pluginInput.simulateMouseClick(x as number, y as number, getInputContext(event))
  )

  ipcMain.handle('input:simulateMouseDoubleClick', (event, x: unknown, y: unknown) =>
    pluginInput.simulateMouseDoubleClick(x as number, y as number, getInputContext(event))
  )

  ipcMain.handle('input:simulateMouseRightClick', (event, x: unknown, y: unknown) =>
    pluginInput.simulateMouseRightClick(x as number, y as number, getInputContext(event))
  )
}
