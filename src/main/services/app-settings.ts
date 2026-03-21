import db from '../db'
import path from 'node:path'
import type {
  AiToolCapabilityGrant,
  AiToolCapabilityPolicySettings,
  AiToolingSettings,
  AiToolScriptEntry,
  AppSettings,
  CommandAuditItem,
  CommandAuditStatus,
  CommandCallerSource,
  CommandRunnerSettings,
  CommandRule,
  TraySettings,
  CommandTrustRecord
} from '../../shared/types/settings'

const SETTINGS_NAMESPACE = 'app'
const SETTINGS_KEY = 'settings'

const DEFAULT_RUN_COMMAND_DENY_ENV_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'DATABASE_URL'
]

const DEFAULT_RUN_COMMAND_MASK_ENV_KEYS = [
  ...DEFAULT_RUN_COMMAND_DENY_ENV_KEYS,
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'HF_TOKEN'
]

const DEFAULT_SETTINGS: AppSettings = {
  shortcuts: {
    toggleWindow: 'Alt+Space',
    openSettings: 'CommandOrControl+,'
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
    allowShell: true,
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 300_000,
    maxOutputBytes: 1_048_576,
    maxConcurrent: 4,
    denyEnvKeys: DEFAULT_RUN_COMMAND_DENY_ENV_KEYS,
    maskEnvKeysInAudit: DEFAULT_RUN_COMMAND_MASK_ENV_KEYS,
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
  aiTooling: {
    enabled: true,
    filesystem: {
      allowedRoots: [process.cwd()],
      maxReadBytes: 512 * 1024,
      maxEntries: 2000,
      maxSearchHits: 200,
      maxSearchFileBytes: 512 * 1024
    },
    patch: {
      allowedRoots: [process.cwd()],
      maxPatchBytes: 512 * 1024,
      requireDryRunFirst: true
    },
    http: {
      timeoutMs: 30_000,
      maxResponseBytes: 2 * 1024 * 1024,
      denyHosts: ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'],
      denyCidrs: ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '::1/128', 'fc00::/7'],
      denyUrlPrefixes: []
    },
    runScript: {
      entries: [],
      defaultTimeoutMs: 30_000,
      maxTimeoutMs: 300_000
    },
    git: {
      allowedRepoRoots: [process.cwd()],
      maxDiffBytes: 1024 * 1024
    },
    capabilityPolicy: {
      defaultAppCapabilities: [
        'shell.exec',
        'shell.script',
        'fs.read',
        'fs.list',
        'fs.search',
        'patch.apply',
        'http.fetch',
        'git.status',
        'git.diff'
      ],
      globalGrants: []
    }
  },
  window: {
    width: 800
  },
  search: {
    enableApps: true,
    enableFiles: false
  },
  input: {
    autoPasteOnShow: true,
    autoPasteMaxAge: 5000
  },
  tray: {
    enabled: true,
    closeToTray: true,
    clickAction: 'toggleWindow'
  },
  onboardingCompleted: false
}

function normalizeTraySettings(input: Partial<TraySettings> | undefined): TraySettings {
  const current = {
    ...DEFAULT_SETTINGS.tray,
    ...(input || {})
  }

  return {
    enabled: current.enabled !== false,
    closeToTray: current.closeToTray !== false,
    clickAction: current.clickAction === 'openMenu' ? 'openMenu' : 'toggleWindow'
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

function normalizeStringList(input: unknown, maxItems = 200): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const value = String(item || '').trim()
    if (!value) continue
    const lower = value.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(value)
    if (out.length >= maxItems) break
  }
  return out
}

function normalizePathList(input: unknown, fallback: string[]): string[] {
  const values = normalizeStringList(input)
  const source = values.length > 0 ? values : fallback
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of source) {
    const resolved = path.resolve(raw)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

function normalizeScriptEntry(input: unknown, index: number): AiToolScriptEntry | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  const id = String(obj.id || `script-${index + 1}`).trim()
  const command = String(obj.command || '').trim()
  if (!id || !command) return null
  const args = normalizeStringList(obj.args, 200)
  const allowEnvKeys = normalizeStringList(obj.allowEnvKeys, 200)
  const timeoutMsRaw = Number(obj.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
    ? Math.max(1000, Math.min(timeoutMsRaw, 3_600_000))
    : undefined
  return {
    id,
    command,
    args: args.length > 0 ? args : undefined,
    cwd: String(obj.cwd || '').trim() || undefined,
    timeoutMs,
    allowEnvKeys: allowEnvKeys.length > 0 ? allowEnvKeys : undefined
  }
}

function normalizeCapabilityGrant(input: unknown, index: number): AiToolCapabilityGrant | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  const capability = String(obj.capability || '').trim()
  if (!capability) return null
  const decision = obj.decision === 'deny' ? 'deny' : obj.decision === 'allow' ? 'allow' : null
  if (!decision) return null
  const id = String(obj.id || `grant-${index + 1}`).trim() || `grant-${index + 1}`
  const createdAt = Number(obj.createdAt)
  const updatedAt = Number(obj.updatedAt)
  const expiresAt = Number(obj.expiresAt)
  return {
    id,
    capability,
    decision,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : undefined,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : undefined,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : undefined
  }
}

function normalizeCapabilityPolicySettings(input: Partial<AiToolCapabilityPolicySettings> | undefined): AiToolCapabilityPolicySettings {
  const current = {
    ...DEFAULT_SETTINGS.aiTooling.capabilityPolicy,
    ...(input || {})
  }
  const normalizedGlobalGrants = Array.isArray(current.globalGrants)
    ? current.globalGrants
      .map((item, index) => normalizeCapabilityGrant(item, index))
      .filter((item): item is AiToolCapabilityGrant => !!item)
    : []
  return {
    defaultAppCapabilities: normalizeStringList(
      current.defaultAppCapabilities,
      DEFAULT_SETTINGS.aiTooling.capabilityPolicy.defaultAppCapabilities.length
    ),
    globalGrants: normalizedGlobalGrants
  }
}

function normalizeAiToolingSettings(input: Partial<AiToolingSettings> | undefined): AiToolingSettings {
  const current = {
    ...DEFAULT_SETTINGS.aiTooling,
    ...(input || {})
  }
  const filesystem = current.filesystem || DEFAULT_SETTINGS.aiTooling.filesystem
  const patch = current.patch || DEFAULT_SETTINGS.aiTooling.patch
  const http = current.http || DEFAULT_SETTINGS.aiTooling.http
  const runScript = current.runScript || DEFAULT_SETTINGS.aiTooling.runScript
  const git = current.git || DEFAULT_SETTINGS.aiTooling.git
  const capabilityPolicy = normalizeCapabilityPolicySettings(current.capabilityPolicy)
  const scriptEntries = Array.isArray(runScript.entries)
    ? runScript.entries
      .map((entry, index) => normalizeScriptEntry(entry, index))
      .filter((entry): entry is AiToolScriptEntry => !!entry)
    : []

  return {
    enabled: current.enabled !== false,
    filesystem: {
      allowedRoots: normalizePathList(filesystem.allowedRoots, DEFAULT_SETTINGS.aiTooling.filesystem.allowedRoots),
      maxReadBytes: Math.max(4 * 1024, Math.min(Number(filesystem.maxReadBytes || DEFAULT_SETTINGS.aiTooling.filesystem.maxReadBytes), 20 * 1024 * 1024)),
      maxEntries: Math.max(10, Math.min(Number(filesystem.maxEntries || DEFAULT_SETTINGS.aiTooling.filesystem.maxEntries), 50_000)),
      maxSearchHits: Math.max(10, Math.min(Number(filesystem.maxSearchHits || DEFAULT_SETTINGS.aiTooling.filesystem.maxSearchHits), 5000)),
      maxSearchFileBytes: Math.max(4 * 1024, Math.min(Number(filesystem.maxSearchFileBytes || DEFAULT_SETTINGS.aiTooling.filesystem.maxSearchFileBytes), 10 * 1024 * 1024))
    },
    patch: {
      allowedRoots: normalizePathList(patch.allowedRoots, DEFAULT_SETTINGS.aiTooling.patch.allowedRoots),
      maxPatchBytes: Math.max(1024, Math.min(Number(patch.maxPatchBytes || DEFAULT_SETTINGS.aiTooling.patch.maxPatchBytes), 10 * 1024 * 1024)),
      requireDryRunFirst: patch.requireDryRunFirst !== false
    },
    http: {
      timeoutMs: Math.max(1000, Math.min(Number(http.timeoutMs || DEFAULT_SETTINGS.aiTooling.http.timeoutMs), 300_000)),
      maxResponseBytes: Math.max(8 * 1024, Math.min(Number(http.maxResponseBytes || DEFAULT_SETTINGS.aiTooling.http.maxResponseBytes), 20 * 1024 * 1024)),
      denyHosts: normalizeStringList(http.denyHosts, 500),
      denyCidrs: normalizeStringList(http.denyCidrs, 500),
      denyUrlPrefixes: normalizeStringList(http.denyUrlPrefixes, 500)
    },
    runScript: {
      entries: scriptEntries,
      defaultTimeoutMs: Math.max(1000, Math.min(Number(runScript.defaultTimeoutMs || DEFAULT_SETTINGS.aiTooling.runScript.defaultTimeoutMs), 300_000)),
      maxTimeoutMs: Math.max(5000, Math.min(Number(runScript.maxTimeoutMs || DEFAULT_SETTINGS.aiTooling.runScript.maxTimeoutMs), 3_600_000))
    },
    git: {
      allowedRepoRoots: normalizePathList(git.allowedRepoRoots, DEFAULT_SETTINGS.aiTooling.git.allowedRepoRoots),
      maxDiffBytes: Math.max(8 * 1024, Math.min(Number(git.maxDiffBytes || DEFAULT_SETTINGS.aiTooling.git.maxDiffBytes), 20 * 1024 * 1024))
    },
    capabilityPolicy
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
      .filter((item) => {
        if (!item || typeof item !== 'object') return false
        // 兼容旧数据：带 fingerprint（SHA256 hash）的旧记录无法反向转为前缀，直接丢弃
        if ('fingerprint' in item && !('prefix' in item)) return false
        return !!String((item as CommandTrustRecord).prefix || '').trim()
      })
      .map((item) => {
        const record = item as CommandTrustRecord
        const prefix = String(record.prefix).trim().toLowerCase()
        const source: CommandCallerSource = record.source === 'plugin' ? 'plugin' : 'app'
        const now = Date.now()
        return {
          prefix,
          source,
          pluginId: String(record.pluginId || '').trim() || undefined,
          command: String(record.command || '').trim(),
          args: Array.isArray(record.args) ? record.args.map((arg) => String(arg)) : [],
          shell: record.shell === true,
          createdAt: Number(record.createdAt || now),
          lastUsedAt: Number(record.lastUsedAt || now)
        }
      })
    : []

  const maxItems = Math.max(50, Math.min(5000, Number(current.audit?.maxItems || DEFAULT_SETTINGS.commandRunner.audit.maxItems)))
  const denyEnvKeys = normalizeStringList(current.denyEnvKeys, 500)
  const maskEnvKeysInAudit = normalizeStringList(current.maskEnvKeysInAudit, 500)
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
          envKeys: Array.isArray(item.envKeys) ? item.envKeys.map((key) => String(key)).filter(Boolean) : undefined,
          timestamp: Number(item.timestamp || Date.now()),
          status,
          signal: item.signal ? String(item.signal) : null
        }
      })
    : []

  return {
    enabled: current.enabled !== false,
    requireConsent: current.requireConsent !== false,
    allowShell: current.allowShell !== false,
    defaultTimeoutMs: Math.max(1000, Math.min(Number(current.defaultTimeoutMs || DEFAULT_SETTINGS.commandRunner.defaultTimeoutMs), 300_000)),
    maxTimeoutMs: Math.max(5000, Math.min(Number(current.maxTimeoutMs || DEFAULT_SETTINGS.commandRunner.maxTimeoutMs), 3_600_000)),
    maxOutputBytes: Math.max(8 * 1024, Math.min(Number(current.maxOutputBytes || DEFAULT_SETTINGS.commandRunner.maxOutputBytes), 10 * 1024 * 1024)),
    maxConcurrent: Math.max(1, Math.min(Number(current.maxConcurrent || DEFAULT_SETTINGS.commandRunner.maxConcurrent), 16)),
    denyEnvKeys: denyEnvKeys.length > 0 ? denyEnvKeys : [...DEFAULT_SETTINGS.commandRunner.denyEnvKeys],
    maskEnvKeysInAudit: maskEnvKeysInAudit.length > 0 ? maskEnvKeysInAudit : [...DEFAULT_SETTINGS.commandRunner.maskEnvKeysInAudit],
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
    aiTooling: normalizeAiToolingSettings({
      ...current.aiTooling,
      ...(next.aiTooling || {}),
      capabilityPolicy: {
        ...current.aiTooling.capabilityPolicy,
        ...((next.aiTooling && next.aiTooling.capabilityPolicy) || {})
      }
    }),
    window: {
      ...(current.window || { width: 800 }),
      ...(next.window || {})
    },
    search: {
      ...current.search,
      ...(next.search || {})
    },
    input: {
      ...current.input,
      ...(next.input || {})
    },
    tray: normalizeTraySettings({
      ...current.tray,
      ...(next.tray || {})
    }),
    onboardingCompleted: next.onboardingCompleted ?? current.onboardingCompleted ?? false
  }
}

function sanitizeShortcuts(settings: AppSettings): AppSettings {
  const next: AppSettings = {
    ...settings,
    shortcuts: { ...settings.shortcuts },
    commandRunner: normalizeCommandRunnerSettings(settings.commandRunner),
    aiTooling: normalizeAiToolingSettings(settings.aiTooling),
    tray: normalizeTraySettings(settings.tray)
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
      // 全新安装，使用默认设置（onboardingCompleted = false）
      this.cache = { ...DEFAULT_SETTINGS }
      return this.cache
    }

    try {
      const parsed = JSON.parse(row.value) as Partial<AppSettings>
      // 升级安装：如果已有存储设置但没有 onboardingCompleted 字段，视为已完成引导
      if (parsed.onboardingCompleted === undefined) {
        parsed.onboardingCompleted = true
      }
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
