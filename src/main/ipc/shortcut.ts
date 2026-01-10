import { ipcMain, BrowserWindow } from 'electron'
import { createPluginGlobalShortcut } from '../plugin/shortcut'

// 存储每个窗口对应的插件快捷键实例
const windowShortcuts = new Map<number, ReturnType<typeof createPluginGlobalShortcut>>()

export function registerGlobalShortcutHandlers() {
  // 注册快捷键
  ipcMain.handle('shortcut:register', (event, accelerator: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false

    const pluginName = `window-${win.id}`
    if (!windowShortcuts.has(win.id)) {
      windowShortcuts.set(win.id, createPluginGlobalShortcut(pluginName))
    }

    const shortcut = windowShortcuts.get(win.id)!
    return shortcut.register(accelerator, () => {
      event.sender.send('shortcut:triggered', accelerator)
    })
  })

  // 注销快捷键
  ipcMain.handle('shortcut:unregister', (event, accelerator: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const shortcut = windowShortcuts.get(win.id)
    if (shortcut) {
      shortcut.unregister(accelerator)
    }
  })

  // 注销所有快捷键
  ipcMain.handle('shortcut:unregisterAll', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const shortcut = windowShortcuts.get(win.id)
    if (shortcut) {
      shortcut.unregisterAll()
    }
  })

  // 检查是否已注册
  ipcMain.handle('shortcut:isRegistered', (_, accelerator: string) => {
    const { globalShortcut } = require('electron')
    return globalShortcut.isRegistered(accelerator)
  })
}
