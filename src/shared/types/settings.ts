export type AppShortcutAction =
  | 'toggleWindow'
  | 'openSettings'
  | 'openAiSettings'
  | 'openPluginStore'
  | 'openPluginManager'
  | 'openBackgroundPlugins'
  | 'openTaskScheduler'
  | 'openLogViewer'

export interface AppShortcutSettings {
  toggleWindow: string
  openSettings: string
  openAiSettings: string
  openPluginStore: string
  openPluginManager: string
  openBackgroundPlugins: string
  openTaskScheduler: string
  openLogViewer: string
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

export type CommandRuleMode = 'exact' | 'prefix'

export interface CommandRule {
  id: string
  mode: CommandRuleMode
  value: string
  enabled?: boolean
}

export type CommandCallerSource = 'app' | 'plugin'

export interface CommandTrustRecord {
  fingerprint: string
  source: CommandCallerSource
  pluginId?: string
  command: string
  args?: string[]
  shell?: boolean
  createdAt: number
  lastUsedAt: number
}

export type CommandAuditStatus = 'allowed' | 'blocked' | 'error' | 'timeout'

export interface CommandAuditItem {
  id: string
  timestamp: number
  source: CommandCallerSource
  pluginId?: string
  command: string
  args?: string[]
  envKeys?: string[]
  cwd?: string
  shell?: boolean
  timeoutMs?: number
  durationMs?: number
  exitCode?: number | null
  signal?: string | null
  status: CommandAuditStatus
  reason?: string
  success?: boolean
  timedOut?: boolean
  truncated?: boolean
}

export interface CommandRunnerSettings {
  enabled: boolean
  requireConsent: boolean
  allowShell: boolean
  defaultTimeoutMs: number
  maxTimeoutMs: number
  maxOutputBytes: number
  maxConcurrent: number
  denyEnvKeys: string[]
  maskEnvKeysInAudit: string[]
  allowList: CommandRule[]
  denyList: CommandRule[]
  trustedFingerprints: CommandTrustRecord[]
  audit: {
    maxItems: number
    records: CommandAuditItem[]
  }
}

export interface AiToolFilesystemSettings {
  allowedRoots: string[]
  maxReadBytes: number
  maxEntries: number
  maxSearchHits: number
  maxSearchFileBytes: number
}

export interface AiToolPatchSettings {
  allowedRoots: string[]
  maxPatchBytes: number
  requireDryRunFirst: boolean
}

export interface AiToolHttpSettings {
  timeoutMs: number
  maxResponseBytes: number
  denyHosts: string[]
  denyCidrs: string[]
  denyUrlPrefixes: string[]
}

export interface AiToolScriptEntry {
  id: string
  command: string
  args?: string[]
  cwd?: string
  timeoutMs?: number
  allowEnvKeys?: string[]
}

export interface AiToolRunScriptSettings {
  entries: AiToolScriptEntry[]
  defaultTimeoutMs: number
  maxTimeoutMs: number
}

export interface AiToolGitSettings {
  allowedRepoRoots: string[]
  maxDiffBytes: number
}

export type AiToolCapabilityGrantDecision = 'allow' | 'deny'

export interface AiToolCapabilityGrant {
  id: string
  capability: string
  decision: AiToolCapabilityGrantDecision
  createdAt?: number
  updatedAt?: number
  expiresAt?: number
}

export interface AiToolCapabilityPolicySettings {
  defaultAppCapabilities: string[]
  /**
   * Canonical grant list: global capability allow/deny rules.
   */
  globalGrants: AiToolCapabilityGrant[]
}

export interface AiToolingSettings {
  enabled: boolean
  filesystem: AiToolFilesystemSettings
  patch: AiToolPatchSettings
  http: AiToolHttpSettings
  runScript: AiToolRunScriptSettings
  git: AiToolGitSettings
  capabilityPolicy: AiToolCapabilityPolicySettings
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

export type TrayClickAction = 'toggleWindow' | 'openMenu'

export interface TraySettings {
  enabled: boolean
  closeToTray: boolean
  clickAction: TrayClickAction
}

export interface AppSettings {
  shortcuts: AppShortcutSettings
  storeSources: StoreSource[]
  developer: DeveloperSettings
  commandRunner: CommandRunnerSettings
  aiTooling: AiToolingSettings
  window?: WindowSettings
  input: InputSettings
  tray: TraySettings
}

export interface ShortcutStatus {
  ok: boolean
  reason?: ShortcutStatusReason
}

export type ShortcutStatusReason = 'duplicate' | 'in-use' | 'invalid' | 'system-reserved'

export type ShortcutStatusMap = Record<AppShortcutAction, ShortcutStatus>
