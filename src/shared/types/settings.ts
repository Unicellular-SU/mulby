export type AppShortcutAction =
  | 'toggleWindow'
  | 'openSettings'

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

export type CommandRuleMode = 'exact' | 'prefix'

export interface CommandRule {
  id: string
  mode: CommandRuleMode
  value: string
  enabled?: boolean
}

export type CommandCallerSource = 'app' | 'plugin'

export interface CommandTrustRecord {
  prefix: string
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

// ==================== OpenClaw Node 设置 ====================

/** 命令执行安全模式 */
export type OpenClawSecurityMode = 'deny' | 'allowlist' | 'full'

/** 审批询问模式 */
export type OpenClawAskMode = 'off' | 'on-miss' | 'always'

/** OpenClaw Gateway 连接配置 */
export interface OpenClawGatewayConfig {
  host: string
  port: number
  useTls: boolean
  tlsFingerprint?: string
}

/** OpenClaw 认证配置 */
export interface OpenClawAuthConfig {
  token?: string
  /** 配对后 Gateway 颁发的 device token（自动管理，用户不可编辑） */
  deviceToken?: string
}

/** OpenClaw Node 标识配置 */
export interface OpenClawNodeConfig {
  displayName: string
  autoConnect: boolean
}

/** OpenClaw 安全策略配置 */
export interface OpenClawSecurityConfig {
  execMode: OpenClawSecurityMode
  execAsk: OpenClawAskMode
  allowedCommands: string[]
  /** 是否暴露 Mulby 插件调用能力 */
  exposePlugins: boolean
  /** 是否暴露剪贴板读写能力 */
  exposeClipboard: boolean
  /** 是否暴露搜索能力 */
  exposeSearch: boolean
}

/** OpenClaw Node 完整设置 */
export interface OpenClawSettings {
  enabled: boolean
  gateway: OpenClawGatewayConfig
  auth: OpenClawAuthConfig
  node: OpenClawNodeConfig
  security: OpenClawSecurityConfig
}

// 日志级别类型
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// 搜索设置
export interface SearchSettings {
  enableApps: boolean             // 搜索框是否搜索本机应用
  enableFiles: boolean            // 搜索框是否搜索本机文件
}

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
  search: SearchSettings
  input: InputSettings
  tray: TraySettings
  onboardingCompleted?: boolean
  openclaw: OpenClawSettings
}

export interface ShortcutStatus {
  ok: boolean
  reason?: ShortcutStatusReason
  /** 快捷键生效方式：'hook' 表示通过底层键盘钩子接管 */
  via?: 'hook'
}

export type ShortcutStatusReason = 'duplicate' | 'in-use' | 'invalid' | 'system-reserved'

export type ShortcutStatusMap = Record<AppShortcutAction, ShortcutStatus>
