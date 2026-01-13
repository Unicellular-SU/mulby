import { ipcMain } from 'electron'
import { ThemeManager, ThemeMode } from '../services/theme'

export function registerThemeHandlers(themeManager: ThemeManager) {
  // 获取主题信息
  ipcMain.handle('theme:get', () => {
    return themeManager.getThemeInfo()
  })

  // 设置主题模式
  ipcMain.handle('theme:set', (_, mode: ThemeMode) => {
    themeManager.setMode(mode)
    return themeManager.getThemeInfo()
  })

  // 获取实际主题（light/dark）
  ipcMain.handle('theme:getActual', () => {
    return themeManager.getActualTheme()
  })
}
