export type AppShortcutAction = 'toggleWindow' | 'openSettings' | 'openPluginStore' | 'openPluginManager'

export interface AppShortcutSettings {
  toggleWindow: string
  openSettings: string
  openPluginStore: string
  openPluginManager: string
}

export interface StoreSource {
  id: string
  name: string
  url: string
  enabled: boolean
  priority: number
  lastSyncAt?: number
  lastError?: string
}

// 日志级别类型
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// 输入设置
export interface InputSettings {
  autoPasteOnShow: boolean       // 窗口唤起时自动粘贴剪贴板内容
  autoPasteMaxAge: number         // 剪贴板内容最大有效期（毫秒），默认 5000
}

// 开发者模式设置
export interface DeveloperSettings {
  enabled: boolean           // 是否启用开发者模式
  pluginPaths: string[]      // 外部插件开发目录列表
  autoReload: boolean        // 是否自动热重载
  showDevTools: boolean      // 是否自动打开 DevTools
  logLevel: LogLevel         // 日志级别
}

// 窗口设置
export interface WindowSettings {
  width: number
  height?: number
  x?: number
  y?: number
}

export interface AppSettings {
  shortcuts: AppShortcutSettings
  storeSources: StoreSource[]
  developer: DeveloperSettings
  window?: WindowSettings
  input: InputSettings
}

export interface ShortcutStatus {
  ok: boolean
  reason?: string
}

export type ShortcutStatusMap = Record<AppShortcutAction, ShortcutStatus>
