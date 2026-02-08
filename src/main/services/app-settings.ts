import db from '../db'
import type {
  AppSettings,
  CommandAuditItem,
  CommandAuditStatus,
  CommandCallerSource,
  CommandRunnerSettings,
  CommandRule,
  CommandTrustRecord
} from '../../shared/types/settings'

const SETTINGS_NAMESPACE = 'app'
const SETTINGS_KEY = 'settings'

const DEFAULT_SETTINGS: AppSettings = {
  shortcuts: {
    toggleWindow: 'Alt+Space',
    openSettings: 'CommandOrControl+,',
    openPluginStore: 'CommandOrControl+I',
    openPluginManager: 'CommandOrControl+Shift+M'
  },
  storeSources: [],
  developer: {
    enabled: false,
    pluginPaths: [],
    autoReload: true,
    showDevTools: false,
    logLevel: 'info'
  },
  commandRunner: {
    enabled: true,
    requireConsent: true,
    allowShell: false,
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 300_000,
    maxOutputBytes: 1_048_576,
    maxConcurrent: 4,
    allowList: [],
    denyList: [
      { id: 'deny-rm', mode: 'exact', value: 'rm', enabled: true },
      { id: 'deny-sudo', mode: 'exact', value: 'sudo', enabled: true },
      { id: 'deny-su', mode: 'exact', value: 'su', enabled: true },
      { id: 'deny-shutdown', mode: 'exact', value: 'shutdown', enabled: true },
      { id: 'deny-reboot', mode: 'exact', value: 'reboot', enabled: true },
      { id: 'deny-mkfs', mode: 'exact', value: 'mkfs', enabled: true },
      { id: 'deny-diskutil', mode: 'exact', value: 'diskutil', enabled: true },
      { id: 'deny-format', mode: 'exact', value: 'format', enabled: true },
      { id: 'deny-powershell-encoded', mode: 'prefix', value: 'powershell -EncodedCommand', enabled: true }
    ],
    trustedFingerprints: [],
    audit: {
      maxItems: 500,
      records: []
    }
  },
  window: {
    width: 800
  },
  input: {
    autoPasteOnShow: true,
    autoPasteMaxAge: 5000
  }
}

function normalizeRule(rule: Partial<CommandRule> | undefined, fallbackIdPrefix: string, index: number): CommandRule | null {
  if (!rule) return null
  const value = String(rule.value || '').trim()
  if (!value) return null
  const mode = rule.mode === 'prefix' ? 'prefix' : 'exact'
  const id = String(rule.id || `${fallbackIdPrefix}-${index + 1}`)
  return {
    id,
    mode,
    value,
    enabled: rule.enabled !== false
  }
}

function normalizeCommandRunnerSettings(input: Partial<CommandRunnerSettings> | undefined): CommandRunnerSettings {
  const current = {
    ...DEFAULT_SETTINGS.commandRunner,
    ...(input || {})
  }

  const allowList = Array.isArray(current.allowList)
    ? current.allowList
      .map((item, index) => normalizeRule(item, 'allow', index))
      .filter((item): item is CommandRule => !!item)
    : DEFAULT_SETTINGS.commandRunner.allowList

  const denyList = Array.isArray(current.denyList)
    ? current.denyList
      .map((item, index) => normalizeRule(item, 'deny', index))
      .filter((item): item is CommandRule => !!item)
    : DEFAULT_SETTINGS.commandRunner.denyList

  const trustedFingerprints: CommandTrustRecord[] = Array.isArray(current.trustedFingerprints)
    ? current.trustedFingerprints
      .filter((item) => item && typeof item === 'object' && String(item.fingerprint || '').trim())
      .map((item) => {
        const fingerprint = String(item.fingerprint).trim()
        const source: CommandCallerSource = item.source === 'plugin' ? 'plugin' : 'app'
        const now = Date.now()
        return {
          fingerprint,
          source,
          pluginId: String(item.pluginId || '').trim() || undefined,
          command: String(item.command || '').trim(),
          args: Array.isArray(item.args) ? item.args.map((arg) => String(arg)) : [],
          shell: item.shell === true,
          createdAt: Number(item.createdAt || now),
          lastUsedAt: Number(item.lastUsedAt || now)
        }
      })
    : []

  const maxItems = Math.max(50, Math.min(5000, Number(current.audit?.maxItems || DEFAULT_SETTINGS.commandRunner.audit.maxItems)))
  const auditRecords: CommandAuditItem[] = Array.isArray(current.audit?.records)
    ? current.audit.records
      .filter((item) => item && typeof item === 'object' && String(item.id || '').trim())
      .slice(-maxItems)
      .map((item) => {
        const source: CommandCallerSource = item.source === 'plugin' ? 'plugin' : 'app'
        const status: CommandAuditStatus = (
          item.status === 'blocked' || item.status === 'error' || item.status === 'timeout'
        ) ? item.status : 'allowed'
        return {
          ...item,
          id: String(item.id || ''),
          source,
          pluginId: String(item.pluginId || '').trim() || undefined,
          command: String(item.command || ''),
          args: Array.isArray(item.args) ? item.args.map((arg) => String(arg)) : [],
          timestamp: Number(item.timestamp || Date.now()),
          status,
          signal: item.signal ? String(item.signal) : null
        }
      })
    : []

  return {
    enabled: current.enabled !== false,
    requireConsent: current.requireConsent !== false,
    allowShell: current.allowShell === true,
    defaultTimeoutMs: Math.max(1000, Math.min(Number(current.defaultTimeoutMs || DEFAULT_SETTINGS.commandRunner.defaultTimeoutMs), 300_000)),
    maxTimeoutMs: Math.max(5000, Math.min(Number(current.maxTimeoutMs || DEFAULT_SETTINGS.commandRunner.maxTimeoutMs), 3_600_000)),
    maxOutputBytes: Math.max(8 * 1024, Math.min(Number(current.maxOutputBytes || DEFAULT_SETTINGS.commandRunner.maxOutputBytes), 10 * 1024 * 1024)),
    maxConcurrent: Math.max(1, Math.min(Number(current.maxConcurrent || DEFAULT_SETTINGS.commandRunner.maxConcurrent), 16)),
    allowList,
    denyList,
    trustedFingerprints,
    audit: {
      maxItems,
      records: auditRecords
    }
  }
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
    storeSources: next.storeSources ?? current.storeSources,
    developer: {
      ...current.developer,
      ...(next.developer || {})
    },
    commandRunner: normalizeCommandRunnerSettings({
      ...current.commandRunner,
      ...(next.commandRunner || {})
    }),
    window: {
      ...(current.window || { width: 800 }),
      ...(next.window || {})
    },
    input: {
      ...current.input,
      ...(next.input || {})
    }
  }
}

function sanitizeShortcuts(settings: AppSettings): AppSettings {
  const next: AppSettings = {
    ...settings,
    shortcuts: { ...settings.shortcuts },
    commandRunner: normalizeCommandRunnerSettings(settings.commandRunner)
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

  if (next.shortcuts.openPluginStore.includes('Dead')) {
    next.shortcuts.openPluginStore = DEFAULT_SETTINGS.shortcuts.openPluginStore
  }

  if (next.shortcuts.openPluginManager.includes('Dead')) {
    next.shortcuts.openPluginManager = DEFAULT_SETTINGS.shortcuts.openPluginManager
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
