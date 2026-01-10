import { app, nativeTheme, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeConfig {
  mode: ThemeMode
}

export class ThemeManager {
  private config: ThemeConfig = { mode: 'system' }
  private configPath: string
  private windows: Set<BrowserWindow> = new Set()

  constructor() {
    const configDir = join(app.getPath('userData'), 'config')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.configPath = join(configDir, 'theme.json')
    this.loadConfig()

    // 监听系统主题变化
    nativeTheme.on('updated', () => {
      if (this.config.mode === 'system') {
        this.notifyAllWindows()
      }
    })
  }

  private loadConfig(): void {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8')
        this.config = JSON.parse(data)
      }
    } catch {
      this.config = { mode: 'system' }
    }
  }

  private saveConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
    } catch (err) {
      console.error('Failed to save theme config:', err)
    }
  }

  // 注册窗口以接收主题更新
  registerWindow(win: BrowserWindow): void {
    this.windows.add(win)
    win.on('closed', () => {
      this.windows.delete(win)
    })
  }

  // 获取当前主题模式设置
  getMode(): ThemeMode {
    return this.config.mode
  }

  // 获取实际应用的主题（解析 system）
  getActualTheme(): 'light' | 'dark' {
    if (this.config.mode === 'system') {
      return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    }
    return this.config.mode
  }

  // 设置主题模式
  setMode(mode: ThemeMode): void {
    this.config.mode = mode
    this.saveConfig()
    this.notifyAllWindows()
  }

  // 通知所有窗口主题变化
  private notifyAllWindows(): void {
    const theme = this.getActualTheme()
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('theme:changed', theme)
      }
    }
  }

  // 获取主题信息（供 IPC 使用）
  getThemeInfo(): { mode: ThemeMode; actual: 'light' | 'dark' } {
    return {
      mode: this.config.mode,
      actual: this.getActualTheme()
    }
  }
}
