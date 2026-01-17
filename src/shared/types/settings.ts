export type AppShortcutAction = 'toggleWindow' | 'openSettings'

export interface AppShortcutSettings {
  toggleWindow: string
  openSettings: string
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

export interface AppSettings {
  shortcuts: AppShortcutSettings
  storeSources: StoreSource[]
}

export interface ShortcutStatus {
  ok: boolean
  reason?: string
}

export type ShortcutStatusMap = Record<AppShortcutAction, ShortcutStatus>
