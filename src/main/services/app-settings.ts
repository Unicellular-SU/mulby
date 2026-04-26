import db from '../db'
import path from 'node:path'
import { APP_SETTINGS_DEFAULT_WINDOW_WIDTH } from '../constants/window-defaults'
import type {
  AiToolCapabilityGrant,
  AiToolCapabilityPolicySettings,
  AiToolingSettings,
  AiToolScriptEntry,
  AiToolWebSearchSettings,
  AppSettings,
  CommandAuditItem,
  CommandAuditStatus,
  CommandCallerSource,
  CommandRunnerSettings,
  CommandRule,
  CustomSearchApiConfig,
  DoubleTapSettings,
  LocalSearchEngineConfig,
  MouseTriggerSettings,
  TraySettings,
  CommandTrustRecord,
  McpServerSettings,
  OpenClawSettings,
  SuperPanelSettings,
  SuperPanelTriggerSettings
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

const DEFAULT_LOCAL_ENGINES: LocalSearchEngineConfig[] = [
  {
    id: 'local-ddg',
    name: 'DuckDuckGo',
    urlTemplate: 'https://html.duckduckgo.com/html/?q=%s',
    resultSelector: '#links .result',
    titleSelector: '.result__a',
    linkSelector: '.result__a',
    snippetSelector: '.result__snippet',
    urlDecoder: 'ddg-redirect',
    builtin: true
  },
  {
    id: 'local-bing',
    name: 'Bing',
    urlTemplate: 'https://cn.bing.com/search?q=%s',
    resultSelector: '#b_results li.b_algo',
    titleSelector: 'h2 a',
    linkSelector: 'h2 a',
    snippetSelector: '.b_caption p, .b_caption .b_algoSlug',
    urlDecoder: 'bing-redirect',
    builtin: true
  },
  {
    id: 'local-google',
    name: 'Google',
    urlTemplate: 'https://www.google.com/search?q=%s',
    resultSelector: '#search .MjjYud',
    titleSelector: 'h3',
    linkSelector: 'a',
    snippetSelector: '[data-sncf] span, .VwiC3b',
    builtin: true
  }
]

const DEFAULT_SETTINGS: AppSettings = {
  shortcuts: {
    toggleWindow: 'Alt+Space',
    openSettings: 'CommandOrControl+,'
  },
  mouseTrigger: {
    enabled: false,
    button: 'middle',
    action: 'click',
    longPressMs: 500
  },
  doubleTap: {
    enabled: false,
    modifier: process.platform === 'darwin' ? 'Command' : 'Ctrl'
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
    maxQueueSize: 20,
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
    webSearch: {
      activeProvider: 'local-ddg',
      maxResults: 5,
      maxContentLength: 8000,
      timeoutMs: 30_000,
      providerKeys: {},
      localEngines: DEFAULT_LOCAL_ENGINES,
      customApis: [],
      fetchContent: true,
      maxContentPerResult: 2000,
      resultDenyHosts: []
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
        // 注意：web.search / web.fetch 默认关闭，用户需在设置中手动启用
      ],
      globalGrants: []
    }
  },
  window: {
    width: APP_SETTINGS_DEFAULT_WINDOW_WIDTH
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
  onboardingCompleted: false,
  mcpServer: {
    enabled: false,
    port: 18790,
    token: ''
  },
  openclaw: {
    enabled: false,
    gateway: {
      host: '127.0.0.1',
      port: 18789,
      useTls: false
    },
    auth: {},
    node: {
      displayName: 'Mulby',
      autoConnect: false
    },
    security: {
      execMode: 'deny',
      execAsk: 'on-miss',
      allowedCommands: [],
      exposePlugins: true,
      exposeClipboard: false,
      exposeSearch: true
    }
  },
  superPanel: {
    enabled: false,
    trigger: {
      type: 'mouse_click',
      mouseButton: 'middle',
      longPressMs: 500
    },
    blockedApps: [
      // JetBrains IDE（中键点击关闭标签页）
      'com.jetbrains.intellij',
      'com.jetbrains.WebStorm',
      'com.jetbrains.pycharm',
      'com.jetbrains.goland',
      'com.jetbrains.CLion',
      'com.jetbrains.rider',
      'com.jetbrains.PhpStorm',
      'com.jetbrains.rubymine',
      'com.jetbrains.datagrip',
      'idea64',
      'webstorm64',
      'pycharm64',
      'goland64',
      'clion64',
      // VS Code（中键点击关闭标签页）
      'com.microsoft.VSCode',
      'Code',
      // 终端模拟器（Linux 中键粘贴）
      'gnome-terminal',
      'konsole',
      'xfce4-terminal',
      'alacritty',
      'kitty',
      'com.apple.Terminal',
      'com.googlecode.iterm2',
      'WindowsTerminal',
      // 游戏
      'Steam',
      'steam'
    ],
    clipboardPollDelayMs: 80,
    maxItems: 10,
    instantTranslation: true,
    translationMaxLength: 5000
  }
}

function normalizeMcpServerSettings(input: Partial<McpServerSettings> | undefined): McpServerSettings {
  const defaults = DEFAULT_SETTINGS.mcpServer
  const current = {
    ...defaults,
    ...(input || {})
  }

  // 端口范围校验
  let port = Number(current.port)
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    port = defaults.port
  }

  // Token 保留用户值（空字符串表示首次启用时自动生成）
  const token = typeof current.token === 'string' ? current.token : ''

  return {
    enabled: current.enabled === true,
    port,
    token
  }
}

function normalizeOpenClawSettings(input: Partial<OpenClawSettings> | undefined): OpenClawSettings {
  const defaults = DEFAULT_SETTINGS.openclaw
  const current = {
    ...defaults,
    ...(input || {})
  }

  const gateway = {
    ...defaults.gateway,
    ...(current.gateway || {})
  }
  // 端口范围校验
  if (typeof gateway.port !== 'number' || gateway.port < 1 || gateway.port > 65535) {
    gateway.port = defaults.gateway.port
  }

  const auth = {
    ...defaults.auth,
    ...(current.auth || {})
  }

  const node = {
    ...defaults.node,
    ...(current.node || {})
  }
  if (!node.displayName || typeof node.displayName !== 'string') {
    node.displayName = defaults.node.displayName
  }

  const securityInput = current.security || {}
  const security = {
    ...defaults.security,
    ...securityInput
  }
  // 验证枚举值
  const validExecModes = ['deny', 'allowlist', 'full'] as const
  if (!validExecModes.includes(security.execMode as typeof validExecModes[number])) {
    security.execMode = defaults.security.execMode
  }
  const validAskModes = ['off', 'on-miss', 'always'] as const
  if (!validAskModes.includes(security.execAsk as typeof validAskModes[number])) {
    security.execAsk = defaults.security.execAsk
  }
  if (!Array.isArray(security.allowedCommands)) {
    security.allowedCommands = []
  }

  return {
    enabled: current.enabled === true,
    gateway,
    auth,
    node,
    security
  }
}

function normalizeSuperPanelTrigger(input: Partial<SuperPanelTriggerSettings> | undefined): SuperPanelTriggerSettings {
  const defaults = DEFAULT_SETTINGS.superPanel.trigger
  const current = {
    ...defaults,
    ...(input || {})
  }

  const validTypes = ['mouse_click', 'mouse_longpress', 'keyboard', 'double_tap'] as const
  const type = validTypes.includes(current.type as typeof validTypes[number])
    ? current.type as typeof validTypes[number]
    : defaults.type

  const validButtons = ['middle', 'back', 'forward', 'right'] as const
  const mouseButton = validButtons.includes(current.mouseButton as typeof validButtons[number])
    ? current.mouseButton as typeof validButtons[number]
    : defaults.mouseButton

  const longPressMs = Math.max(200, Math.min(Number(current.longPressMs || defaults.longPressMs), 3000))

  const validModifiers = ['Command', 'Ctrl', 'Alt', 'Shift'] as const
  const modifier = current.modifier && validModifiers.includes(current.modifier as typeof validModifiers[number])
    ? current.modifier as typeof validModifiers[number]
    : defaults.modifier

  const accelerator = typeof current.accelerator === 'string' ? current.accelerator.trim() : undefined

  return {
    type,
    mouseButton,
    longPressMs,
    accelerator: accelerator || undefined,
    modifier
  }
}

function normalizeSuperPanelSettings(input: Partial<SuperPanelSettings> | undefined): SuperPanelSettings {
  const defaults = DEFAULT_SETTINGS.superPanel
  const current = {
    ...defaults,
    ...(input || {})
  }

  // 归一化黑名单列表：直接使用用户配置，不再每次合并默认值
  // 默认值仅在初始化时生效（通过 DEFAULT_SETTINGS.superPanel.blockedApps 展开）
  const blockedApps = normalizeStringList(
    current.blockedApps ?? defaults.blockedApps,
    500
  )

  return {
    enabled: current.enabled === true,
    trigger: normalizeSuperPanelTrigger(current.trigger),
    blockedApps,
    clipboardPollDelayMs: Math.max(30, Math.min(Number(current.clipboardPollDelayMs || defaults.clipboardPollDelayMs), 500)),
    maxItems: Math.max(3, Math.min(Number(current.maxItems || defaults.maxItems), 30)),
    instantTranslation: current.instantTranslation !== false,
    translationMaxLength: Math.max(100, Math.min(Number(current.translationMaxLength || defaults.translationMaxLength || 5000), 50000))
  }
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

function normalizeMouseTriggerSettings(input: Partial<MouseTriggerSettings> | undefined): MouseTriggerSettings {
  const current = {
    ...DEFAULT_SETTINGS.mouseTrigger,
    ...(input || {})
  }

  const validButtons = ['middle', 'back', 'forward'] as const
  const validActions = ['click', 'longpress'] as const

  return {
    enabled: current.enabled === true,
    button: validButtons.includes(current.button as typeof validButtons[number])
      ? current.button as typeof validButtons[number]
      : DEFAULT_SETTINGS.mouseTrigger.button,
    action: validActions.includes(current.action as typeof validActions[number])
      ? current.action as typeof validActions[number]
      : DEFAULT_SETTINGS.mouseTrigger.action,
    longPressMs: Math.max(200, Math.min(Number(current.longPressMs || DEFAULT_SETTINGS.mouseTrigger.longPressMs), 3000))
  }
}

function normalizeDoubleTapSettings(input: Partial<DoubleTapSettings> | undefined): DoubleTapSettings {
  const current = {
    ...DEFAULT_SETTINGS.doubleTap,
    ...(input || {})
  }

  const validModifiers = ['Command', 'Ctrl', 'Alt', 'Shift'] as const

  return {
    enabled: current.enabled === true,
    modifier: validModifiers.includes(current.modifier as typeof validModifiers[number])
      ? current.modifier as typeof validModifiers[number]
      : DEFAULT_SETTINGS.doubleTap.modifier
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

  // 归一化用户已持久化的能力列表
  // 不限定 maxItems，使用 normalizeStringList 的默认上限（200），避免随默认列表变动而截断
  const userCapabilities = normalizeStringList(
    current.defaultAppCapabilities
  )

  // 设置迁移：只自动追加「此版本真正新增」的能力，不影响用户主动移除过的旧能力。
  // LEGACY_KNOWN 是在引入 web.search / web.fetch 之前就存在的所有能力名，
  // 如果用户的列表中缺少这些旧能力，说明是用户主动移除的，不应自动恢复。
  const LEGACY_KNOWN = new Set([
    'shell.exec', 'shell.script', 'fs.read', 'fs.list', 'fs.search',
    'patch.apply', 'http.fetch', 'git.status', 'git.diff', 'skill.activate',
    'web.search', 'web.fetch' // 网络搜索默认关闭，不自动追加给已有用户
  ])
  const userSet = new Set(userCapabilities.map((c) => c.toLowerCase()))
  const defaults = DEFAULT_SETTINGS.aiTooling.capabilityPolicy.defaultAppCapabilities
  // 只追加不在 LEGACY_KNOWN 中且用户列表中不存在的能力（即真正的新功能）
  const newCapabilities = defaults.filter(
    (c) => !userSet.has(c.toLowerCase()) && !LEGACY_KNOWN.has(c)
  )
  const mergedCapabilities = [...userCapabilities, ...newCapabilities]

  return {
    defaultAppCapabilities: mergedCapabilities,
    globalGrants: normalizedGlobalGrants
  }
}

/**
 * webSearch 归一化 + 旧数据迁移
 *
 * 旧格式: { provider: 'jina'|'tavily', jinaApiKey, tavilyApiKey }
 * 新格式: { activeProvider, providerKeys: { jina, tavily }, localEngines, customApis }
 */
function isObjectWithStringId(value: unknown): value is { id: string } & Record<string, unknown> {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string'
}

function isCustomSearchApiLike(value: unknown): value is CustomSearchApiConfig {
  if (!value || typeof value !== 'object') return false
  const api = value as Record<string, unknown>
  return typeof api.id === 'string' &&
    typeof api.name === 'string' &&
    typeof api.apiHost === 'string'
}

function normalizeWebSearchSettings(
  raw: Partial<AiToolWebSearchSettings> & Record<string, unknown>
): AiToolWebSearchSettings {
  const defaults = DEFAULT_SETTINGS.aiTooling.webSearch

  // ---- 迁移旧 providerKeys ----
  const providerKeys: { tavily?: string; jina?: string } = {}
  const rawKeys = (raw.providerKeys || {}) as Record<string, unknown>
  const jinaKey = String(rawKeys.jina || raw.jinaApiKey || '').trim() || undefined
  const tavilyKey = String(rawKeys.tavily || raw.tavilyApiKey || '').trim() || undefined
  if (jinaKey) providerKeys.jina = jinaKey
  if (tavilyKey) providerKeys.tavily = tavilyKey

  // ---- 迁移 activeProvider ----
  let activeProvider = String(raw.activeProvider || '').trim()
  if (!activeProvider) {
    // 旧格式: provider 字段
    const oldProvider = String(raw.provider || '').trim()
    if (oldProvider === 'tavily' && tavilyKey) {
      activeProvider = 'tavily'
    } else if (oldProvider === 'jina' && jinaKey) {
      activeProvider = 'jina'
    } else {
      // 无 Key 的旧用户 → 回退到免费本地搜索
      activeProvider = 'local-ddg'
    }
  }

  // ---- 归一化本地引擎列表 ----
  const rawEngines = Array.isArray(raw.localEngines) ? raw.localEngines : []
  // 确保内置引擎始终存在（用户可能删除了）
  const builtinIds = new Set(DEFAULT_LOCAL_ENGINES.map(e => e.id))
  const userEngines = rawEngines.filter(
    (e: unknown) => isObjectWithStringId(e) && !builtinIds.has(e.id)
  ) as LocalSearchEngineConfig[]
  const localEngines = [...DEFAULT_LOCAL_ENGINES, ...userEngines]

  // ---- 归一化自定义 API 列表 ----
  const customApis = (Array.isArray(raw.customApis) ? raw.customApis : []).filter(
    (a: unknown) => isCustomSearchApiLike(a)
  ) as CustomSearchApiConfig[]

  // ---- 校验 activeProvider 是否有效 ----
  const allProviderIds = new Set([
    ...localEngines.map(e => e.id),
    'tavily',
    'jina',
    ...customApis.map(a => `custom-${a.id}`)
  ])
  if (!allProviderIds.has(activeProvider)) {
    activeProvider = 'local-ddg'
  }

  // ---- tavilyApiHost ----
  const tavilyApiHost = String(raw.tavilyApiHost || '').trim() || undefined

  return {
    activeProvider,
    maxResults: Math.max(1, Math.min(Number(raw.maxResults || defaults.maxResults), 20)),
    maxContentLength: Math.max(500, Math.min(Number(raw.maxContentLength || defaults.maxContentLength), 50_000)),
    timeoutMs: Math.max(5000, Math.min(Number(raw.timeoutMs || defaults.timeoutMs), 120_000)),
    providerKeys,
    tavilyApiHost,
    localEngines,
    customApis,
    fetchContent: raw.fetchContent !== false,
    maxContentPerResult: Math.max(200, Math.min(Number(raw.maxContentPerResult || defaults.maxContentPerResult || 2000), 10_000)),
    resultDenyHosts: normalizeStringList(raw.resultDenyHosts, 200)
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
  const webSearch = current.webSearch || DEFAULT_SETTINGS.aiTooling.webSearch
  const capabilityPolicy = normalizeCapabilityPolicySettings(current.capabilityPolicy)
  const scriptEntries = Array.isArray(runScript.entries)
    ? runScript.entries
      .map((entry, index) => normalizeScriptEntry(entry, index))
      .filter((entry): entry is AiToolScriptEntry => !!entry)
    : []

  // ---- webSearch 归一化 + 旧数据迁移 ----
  const normalizedWebSearch = normalizeWebSearchSettings(webSearch as Partial<AiToolWebSearchSettings> & Record<string, unknown>)

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
    webSearch: normalizedWebSearch,
    capabilityPolicy,
    disabledPluginTools: Array.isArray(current.disabledPluginTools)
      ? current.disabledPluginTools.filter((k) => typeof k === 'string' && k.includes(':'))
      : undefined
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
    maxQueueSize: Math.max(4, Math.min(Number(current.maxQueueSize || DEFAULT_SETTINGS.commandRunner.maxQueueSize), 100)),
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
    mouseTrigger: normalizeMouseTriggerSettings({
      ...current.mouseTrigger,
      ...(next.mouseTrigger || {})
    }),
    doubleTap: normalizeDoubleTapSettings({
      ...current.doubleTap,
      ...(next.doubleTap || {})
    }),
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
      ...(current.window || { width: APP_SETTINGS_DEFAULT_WINDOW_WIDTH }),
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
    onboardingCompleted: next.onboardingCompleted ?? current.onboardingCompleted ?? false,
    mcpServer: normalizeMcpServerSettings({
      ...current.mcpServer,
      ...(next.mcpServer || {})
    }),
    openclaw: normalizeOpenClawSettings({
      ...current.openclaw,
      ...(next.openclaw || {})
    }),
    superPanel: normalizeSuperPanelSettings({
      ...current.superPanel,
      ...(next.superPanel || {})
    })
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
