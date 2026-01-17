import db from '../db'
import type { AppSettings } from '../../shared/types/settings'

const SETTINGS_NAMESPACE = 'app'
const SETTINGS_KEY = 'settings'

const DEFAULT_SETTINGS: AppSettings = {
  shortcuts: {
    toggleWindow: 'Alt+Space',
    openSettings: 'CommandOrControl+,'
  },
  storeSources: []
}

const stmtGet = db.prepare('SELECT value FROM store WHERE plugin_id = ? AND key = ?')
const stmtSet = db.prepare(`
  INSERT OR REPLACE INTO store (plugin_id, key, value, updated_at)
  VALUES (?, ?, ?, ?)
`)

function mergeSettings(current: AppSettings, next: Partial<AppSettings>): AppSettings {
  return {
    ...current,
    ...next,
    shortcuts: {
      ...current.shortcuts,
      ...(next.shortcuts || {})
    },
    storeSources: next.storeSources ?? current.storeSources
  }
}

function sanitizeShortcuts(settings: AppSettings): AppSettings {
  const next = {
    ...settings,
    shortcuts: { ...settings.shortcuts }
  }

  if (next.shortcuts.openSettings === 'CommandOrControl+Comma') {
    next.shortcuts.openSettings = DEFAULT_SETTINGS.shortcuts.openSettings
  }

  if (next.shortcuts.toggleWindow.includes('Dead')) {
    next.shortcuts.toggleWindow = DEFAULT_SETTINGS.shortcuts.toggleWindow
  }

  if (next.shortcuts.openSettings.includes('Dead')) {
    next.shortcuts.openSettings = DEFAULT_SETTINGS.shortcuts.openSettings
  }

  return next
}

export class AppSettingsManager {
  private cache: AppSettings | null = null

  getSettings(): AppSettings {
    if (this.cache) {
      return this.cache
    }

    const row = stmtGet.get(SETTINGS_NAMESPACE, SETTINGS_KEY) as { value: string } | undefined
    if (!row?.value) {
      this.cache = { ...DEFAULT_SETTINGS }
      return this.cache
    }

    try {
      const parsed = JSON.parse(row.value) as Partial<AppSettings>
      const merged = mergeSettings({ ...DEFAULT_SETTINGS }, parsed)
      const sanitized = sanitizeShortcuts(merged)
      this.cache = sanitized
      if (JSON.stringify(merged) !== JSON.stringify(sanitized)) {
        this.save(sanitized)
      }
    } catch {
      this.cache = { ...DEFAULT_SETTINGS }
    }

    return this.cache
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const current = this.getSettings()
    const next = mergeSettings(current, partial)
    this.save(next)
    return next
  }

  resetSettings(): AppSettings {
    const next = { ...DEFAULT_SETTINGS }
    this.save(next)
    return next
  }

  private save(settings: AppSettings) {
    this.cache = settings
    stmtSet.run(SETTINGS_NAMESPACE, SETTINGS_KEY, JSON.stringify(settings), Date.now())
  }
}

export const appSettingsManager = new AppSettingsManager()
