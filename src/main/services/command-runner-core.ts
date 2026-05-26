import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import treeKill from 'tree-kill'
import type {
  CommandAuditItem,
  CommandCallerIdentity,
  CommandSandboxBackendName,
  CommandExecutionProfile,
  PluginDirectoryAccessMode,
  CommandRule,
  CommandRunnerSettings,
  CommandSandboxLevel,
  CommandTrustRecord
} from '../../shared/types/settings'
import {
  prepareCommandSandbox,
  type CommandSandboxPreparer
} from './command-sandbox-backend'

export interface RunCommandInput {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  shell?: boolean
  executionProfile?: CommandExecutionProfile
  network?: boolean
  writableRoots?: string[]
}

export interface RunCommandResult {
  success: boolean
  command: string
  args: string[]
  cwd?: string
  shell: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}

export interface RunCommandContext {
  source: 'app' | 'plugin'
  pluginId?: string
  runCommandAllowed?: boolean
  /**
   * 插件 manifest 中声明的 permissions.envKeys
   *
   * - undefined：仅继承安全基线（默认）
   * - string[]：基线之上额外继承指定变量
   * - '*'：完整继承 process.env（高风险）
   *
   * source === 'app' 时忽略该字段（主应用永远完整继承）。
   */
  envKeys?: string[] | '*'
  caller?: CommandCallerIdentity
  defaultProfile?: CommandExecutionProfile
  maxProfile?: CommandExecutionProfile
  rootAccessMode?: PluginDirectoryAccessMode
  directoryAccessRoots?: {
    read?: string[]
    readwrite?: string[]
  }
  assumeUserApproved?: boolean
  abortSignal?: AbortSignal
}

export interface CommandConsentRequest {
  source: 'app' | 'plugin'
  pluginId?: string
  command: string
  args: string[]
  cwd?: string
  envKeys: string[]
  shell: boolean
  timeoutMs: number
  preview: string
  trustPersistable: boolean
  trustScope: string
  trustScopeKind: 'executable' | 'commandLineExact' | 'none'
  title: string
  message: string
  detail: string
}

export type CommandConsentDecision = 'deny' | 'allow-once' | 'trust'

export interface CommandRunnerDeps {
  getPolicy: () => CommandRunnerSettings
  updatePolicy: (next: CommandRunnerSettings) => CommandRunnerSettings
  requestConsent?: (request: CommandConsentRequest) => Promise<CommandConsentDecision>
  prepareSandbox?: CommandSandboxPreparer
  now?: () => number
  randomId?: () => string
}

interface RuleMatchResult {
  matched: boolean
  rule?: CommandRule
}

interface ShellWrapperInvocation {
  wrapper: string
  innerCommand?: string
}

interface TrustCandidate {
  prefix: string
  matchMode: NonNullable<CommandTrustRecord['matchMode']>
  persistable: boolean
  detail: string
}

interface AllowListEvaluation {
  hasRules: boolean
  matched: boolean
  detail?: string
}

class CommandPolicyError extends Error {
  readonly kind: 'blocked'

  constructor(message: string) {
    super(message)
    this.name = 'CommandPolicyError'
    this.kind = 'blocked'
  }
}

function isCommandPolicyError(error: unknown): boolean {
  return error instanceof CommandPolicyError || (
    !!error &&
    typeof error === 'object' &&
    (error as { kind?: unknown }).kind === 'blocked'
  )
}

function normalizeCommandToken(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function extractExecutableIdentity(command: string): string {
  const normalized = normalizeCommandToken(command)
  if (!normalized) return ''

  const quoted = normalized.match(/^"([^"]+)"(?:\s+|$)|^'([^']+)'(?:\s+|$)/)
  if (quoted) {
    return normalizeCommandToken(quoted[1] ?? quoted[2] ?? '')
  }

  const firstToken = normalized.match(/^\S+/)?.[0] || normalized
  if (firstToken === normalized) return normalized

  // If the first token looks like a path fragment, keep the full value so an
  // unquoted executable path with spaces is not silently widened.
  if (/[\\/]/.test(firstToken) || /^[a-z]:/.test(firstToken)) {
    return normalized
  }

  return firstToken
}

function normalizeCommandLine(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim().toLowerCase()
}

function getExecutableName(command: string): string {
  const normalized = normalizeCommandToken(command)
  const withoutTrailingSlash = normalized.replace(/[\\/]+$/, '')
  return withoutTrailingSlash.split(/[\\/]/).pop() || normalized
}

function stripOuterQuotes(value: string): string {
  const trimmed = String(value || '').trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

function isRuleMatch(rule: CommandRule, executable: string, commandLine: string): boolean {
  if (rule.enabled === false) return false
  const value = normalizeCommandToken(rule.value)
  if (!value) return false
  if (rule.mode === 'prefix') {
    return executable.startsWith(value) || commandLine.startsWith(value)
  }
  return executable === value || commandLine === value
}

function findMatchingRule(rules: CommandRule[], executable: string, commandLine: string): RuleMatchResult {
  for (const rule of rules || []) {
    if (isRuleMatch(rule, executable, commandLine)) {
      return { matched: true, rule }
    }
  }
  return { matched: false }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

const PROFILE_RANK: Record<CommandExecutionProfile, number> = {
  sandbox: 0,
  workspace: 1,
  trusted: 2
}

function normalizeExecutionProfile(value: unknown): CommandExecutionProfile | undefined {
  return value === 'sandbox' || value === 'workspace' || value === 'trusted'
    ? value
    : undefined
}

function compareProfile(a: CommandExecutionProfile, b: CommandExecutionProfile): number {
  return PROFILE_RANK[a] - PROFILE_RANK[b]
}

function inferDefaultProfile(context: RunCommandContext): CommandExecutionProfile {
  const actor = context.caller?.actor
  const kind = context.caller?.kind
  if (actor === 'ai' || kind === 'ai' || kind === 'openclaw') return 'sandbox'
  if (context.source === 'plugin') return 'workspace'
  return 'trusted'
}

function inferMaxProfile(context: RunCommandContext): CommandExecutionProfile {
  const actor = context.caller?.actor
  const kind = context.caller?.kind
  if (actor === 'ai' || kind === 'ai') return context.source === 'plugin' ? 'sandbox' : 'workspace'
  if (kind === 'openclaw') return 'workspace'
  if (context.source === 'plugin') return 'workspace'
  return 'trusted'
}

function resolveExecutionProfile(input: RunCommandInput, context: RunCommandContext): {
  requested: CommandExecutionProfile
  resolved: CommandExecutionProfile
  maxProfile: CommandExecutionProfile
  elevatedFrom?: CommandExecutionProfile
} {
  const defaultProfile = normalizeExecutionProfile(context.defaultProfile) || inferDefaultProfile(context)
  const requested = normalizeExecutionProfile(input.executionProfile) || defaultProfile
  const maxProfile = normalizeExecutionProfile(context.maxProfile) || inferMaxProfile(context)
  if (compareProfile(requested, maxProfile) > 0) {
    throw new CommandPolicyError(`当前调用方最多允许 ${maxProfile} 执行环境，不能请求 ${requested}`)
  }
  return {
    requested,
    resolved: requested,
    maxProfile,
    elevatedFrom: requested !== defaultProfile ? defaultProfile : undefined
  }
}

function resolveSandboxLevel(profile: CommandExecutionProfile, settings: CommandRunnerSettings): CommandSandboxLevel {
  if (profile !== 'sandbox') return 'none'
  return settings.sandbox?.enabled === false ? 'none' : 'policy'
}

function normalizeRootList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of values) {
    const raw = String(item || '').trim()
    if (!raw) continue
    const resolved = path.resolve(raw)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

function pathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveCommandRootScope(
  input: RunCommandInput,
  settings: CommandRunnerSettings,
  profile: CommandExecutionProfile,
  context: RunCommandContext
): string[] {
  if (profile === 'trusted') return []
  const configured = profile === 'sandbox'
    ? settings.sandbox?.writableRoots?.length
      ? settings.sandbox.writableRoots
      : settings.sandbox?.allowedRoots
    : settings.sandbox?.allowedRoots
  const requiredAccessMode = context.rootAccessMode === 'read' ? 'read' : 'readwrite'
  const grantRoots = requiredAccessMode === 'read'
    ? [
        ...(context.directoryAccessRoots?.read || []),
        ...(context.directoryAccessRoots?.readwrite || [])
      ]
    : context.directoryAccessRoots?.readwrite || []
  const roots = normalizeRootList([...(configured || []), ...grantRoots])
  const requested = normalizeRootList(input.writableRoots || [])
  if (requested.length === 0 || roots.length === 0) return roots

  // Per-command roots may narrow the configured scope, but must not expand it.
  // The authoritative boundary is settings.sandbox.{allowedRoots,writableRoots}.
  const scopedRequested = requested.filter((requestedRoot) =>
    roots.some((configuredRoot) => pathInside(configuredRoot, requestedRoot))
  )
  return scopedRequested.length > 0 ? uniqueNonEmpty(scopedRequested) : roots
}

function resolveCommandWriteRootScope(
  input: RunCommandInput,
  settings: CommandRunnerSettings,
  profile: CommandExecutionProfile,
  context: RunCommandContext
): string[] {
  if (profile === 'trusted') return []
  if (context.rootAccessMode !== 'read') {
    return resolveCommandRootScope(input, settings, profile, context)
  }
  const configured = profile === 'sandbox'
    ? settings.sandbox?.writableRoots?.length
      ? settings.sandbox.writableRoots
      : settings.sandbox?.allowedRoots
    : settings.sandbox?.allowedRoots
  const roots = normalizeRootList([
    ...(configured || []),
    ...(context.directoryAccessRoots?.readwrite || [])
  ])
  const requested = normalizeRootList(input.writableRoots || [])
  if (requested.length === 0 || roots.length === 0) return roots
  const scopedRequested = requested.filter((requestedRoot) =>
    roots.some((configuredRoot) => pathInside(configuredRoot, requestedRoot))
  )
  return scopedRequested.length > 0 ? uniqueNonEmpty(scopedRequested) : roots
}

function assertCwdAllowed(cwd: string | undefined, roots: string[], profile: CommandExecutionProfile): void {
  if (profile === 'trusted' || roots.length === 0) return
  const resolvedCwd = path.resolve(cwd || process.cwd())
  if (!roots.some((root) => pathInside(root, resolvedCwd))) {
    throw new CommandPolicyError(`${profile} 执行环境禁止使用白名单外 cwd：${resolvedCwd}`)
  }
}

/**
 * Shell wrapper 命令集合（这些命令本身不是业务命令，仅作为执行容器）
 */
const SHELL_WRAPPERS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh',
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'
])

function parseShellWrapperInvocation(commandLine: string): ShellWrapperInvocation | null {
  const match = String(commandLine || '').trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))(.*)$/)
  if (!match) return null

  const firstToken = normalizeCommandToken(match[1] ?? match[2] ?? match[3] ?? '')
  const wrapper = getExecutableName(firstToken)
  if (!SHELL_WRAPPERS.has(wrapper)) return null

  const rest = match[4] || ''
  let innerMatch: RegExpMatchArray | null = null
  if (wrapper === 'cmd' || wrapper === 'cmd.exe') {
    innerMatch = rest.match(/\s\/c\s+([\s\S]+)$/i)
  } else if (wrapper === 'powershell' || wrapper === 'powershell.exe' || wrapper === 'pwsh' || wrapper === 'pwsh.exe') {
    innerMatch = rest.match(/\s-(?:command|c)\s+([\s\S]+)$/i)
  } else {
    innerMatch = rest.match(/\s-[a-z]*c[a-z]*\s+([\s\S]+)$/i)
  }

  return {
    wrapper,
    innerCommand: innerMatch ? stripOuterQuotes(innerMatch[1] || '') : undefined
  }
}

/**
 * 对 shell 命令字符串做轻量级 token 提取
 *
 * 识别的模式：
 * - sh -c "cmd" / bash -c "cmd" / cmd /c "cmd" 等 shell wrapper（提取内层命令）
 * - 管道 (|)、链接 (&&, ||, ;) 中的各段命令
 * - `$(...)` 与 `` `...` `` 命令替换中的嵌套命令（递归深度 ≤ 3）
 *
 * ⚠️ 安全声明：本函数属于**深度防御层**，不是安全屏障：
 * - 不做完整 shell AST 解析
 * - 无法识别 base64 + eval、PowerShell -EncodedCommand、转义等混淆
 * - 无法处理引号内分隔符（如 `echo "a | b"` 会被误切）
 *
 * 最终安全依赖：用户同意（consent）+ 白名单严格匹配 + 危险字符兜底。
 *
 * @param commandLine 完整命令行（command + args 拼接）
 * @param depth 递归深度（内部使用，防止深度爆炸）
 */
function extractShellTokens(commandLine: string, depth = 0): string[] {
  if (depth > 3) return []
  const tokens: string[] = []

  // 先提取 $(...) 与 `...` 命令替换内容，递归解析
  const substitutionRegex = /\$\(([^()]*)\)|`([^`]*)`/g
  let subMatch: RegExpExecArray | null
  while ((subMatch = substitutionRegex.exec(commandLine)) !== null) {
    const inner = subMatch[1] ?? subMatch[2] ?? ''
    if (inner.trim()) {
      tokens.push(...extractShellTokens(inner, depth + 1))
    }
  }

  // 切分管道/链接中的各段命令
  const segments = commandLine.split(/[|;&]+/).map(s => s.trim()).filter(Boolean)

  for (const segment of segments) {
    // 提取首 token（支持双引号或单引号包裹的带空格路径）
    const match = segment.match(/^(?:"([^"]+)"|'([^']+)'|([^\s"']+))/)
    if (!match) continue
    const firstToken = normalizeCommandToken(match[1] ?? match[2] ?? match[3] ?? '')
    tokens.push(firstToken)

    // 检测 shell wrapper 模式：提取 -c / /c 后面的内层实际命令
    if (SHELL_WRAPPERS.has(getExecutableName(firstToken))) {
      // 支持 "…" / '…' 引号包裹的 -c 参数，完整取出后递归解析
      const wrapperInvocation = parseShellWrapperInvocation(segment)
      if (wrapperInvocation?.innerCommand) {
        tokens.push(...extractShellTokens(wrapperInvocation.innerCommand, depth + 1))
      }
    }
  }

  // 过滤掉 shell wrapper 本身：对策略校验而言，它们不是业务命令
  // 但至少保留一个（用于 denyList 拦截 "禁止使用 sh"）
  return [...new Set(tokens)]
}

/**
 * 检测 shell 命令中是否包含"危险但无法结构化解析"的特征
 *
 * 对于这些命令，即使 token 匹配通过，也应该：
 * - 禁止走 trusted 缓存（每次都需要用户确认）
 *
 * 典型特征：
 * - base64/hex 编码参数
 * - PowerShell -EncodedCommand / -e
 * - 重定向到 /dev/tcp (反弹 shell)
 * - eval / exec 后接动态内容
 */
function hasObfuscatedShellPatterns(commandLine: string): boolean {
  const line = commandLine.toLowerCase()
  return (
    /-encodedcommand|-enc\s/i.test(line) ||
    /\/dev\/tcp\//.test(line) ||
    /\beval\s+["'`$]/.test(line) ||
    /base64\s+(?:-d|--decode)/.test(line)
  )
}

function appendWithLimit(chunks: Buffer[], currentBytes: number, incoming: Buffer, maxBytes: number): {
  chunks: Buffer[]
  bytes: number
  truncated: boolean
} {
  if (maxBytes <= 0) {
    return { chunks, bytes: currentBytes, truncated: true }
  }
  if (currentBytes >= maxBytes) {
    return { chunks, bytes: currentBytes, truncated: true }
  }
  const remaining = maxBytes - currentBytes
  if (incoming.length <= remaining) {
    chunks.push(incoming)
    return { chunks, bytes: currentBytes + incoming.length, truncated: false }
  }
  chunks.push(incoming.subarray(0, remaining))
  return { chunks, bytes: maxBytes, truncated: true }
}

/**
 * 根据来源构建安全的子进程环境变量
 *
 * - source='app'：继承全部 process.env（主应用需要完整环境）
 * - source='plugin'：仅保留安全基线 + manifest 声明的 envKeys
 *   - envKeys: ['JAVA_HOME', 'GOPATH'] → 额外继承指定变量
 *   - envKeys: '*' → 等同于 app 来源，继承全部环境
 *
 * @param context 调用方上下文
 * @param userEnv 用户显式传入的环境变量（覆盖所有基线）
 * @param manifestEnvKeys 插件 manifest 中声明的 permissions.envKeys
 */
function buildSafeEnv(
  context: RunCommandContext,
  userEnv?: Record<string, string>,
  manifestEnvKeys?: string[] | string,
  profile: CommandExecutionProfile = 'trusted',
  denyEnvKeys?: string[]
): Record<string, string> {
  // 非 sandbox 主应用来源：完整继承
  if (context.source === 'app' && profile !== 'sandbox') {
    return {
      ...process.env as Record<string, string>,
      ...(userEnv || {})
    }
  }

  // 非 sandbox 插件 + 通配符 '*'：完整继承
  if (manifestEnvKeys === '*' && profile !== 'sandbox') {
    return {
      ...process.env as Record<string, string>,
      ...(userEnv || {})
    }
  }

  // 插件来源（含 sandbox）：继承 process.env，但排除 denyEnvKeys 黑名单
  // + manifest 声明的额外 key 始终包含
  const denySet = new Set((denyEnvKeys || []).map((k) => k.toUpperCase()))
  const manifestExtra = new Set(
    (Array.isArray(manifestEnvKeys) ? manifestEnvKeys : []).map((k) => k.toUpperCase())
  )
  const baseEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (denySet.has(upper) && !manifestExtra.has(upper)) continue
    baseEnv[key] = value
  }

  // 额外的安全屏障：过滤明确危险的注入类变量（无论黑名单配置如何）
  const INJECTION_KEYS = ['LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'LD_LIBRARY_PATH']
  for (const key of INJECTION_KEYS) {
    if (!manifestExtra.has(key.toUpperCase())) {
      delete baseEnv[key]
    }
  }

  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      const upper = key.toUpperCase()
      if (denySet.has(upper) && !manifestExtra.has(upper)) continue
      if (INJECTION_KEYS.includes(upper) && !manifestExtra.has(upper)) continue
      baseEnv[key] = value
    }
  }

  return baseEnv
}

function createAbortError(): Error {
  const error = new Error('命令执行已中止')
  error.name = 'AbortError'
  return error
}

function normalizeArgs(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => String(item ?? ''))
}

function normalizeEnv(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const entries = Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => [String(key || '').trim(), String(value ?? '')] as const)
    .filter(([key]) => !!key)
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

function normalizeEnvKey(value: string): string {
  return String(value || '').trim().toUpperCase()
}

function listEnvKeys(input: Record<string, string> | undefined): string[] {
  if (!input) return []
  return Object.keys(input).map((item) => normalizeEnvKey(item)).filter(Boolean).sort((a, b) => a.localeCompare(b))
}

function sanitizeEnvKeysForAudit(keys: string[], settings: CommandRunnerSettings): string[] {
  if (keys.length === 0) return []
  const maskSet = new Set((settings.maskEnvKeysInAudit || []).map((item) => normalizeEnvKey(item)))
  return keys.map((key) => (maskSet.has(key) ? `${key}=***` : key))
}

/**
 * 构建信任前缀：仅保留可执行文件名（标准化后），用于前缀匹配。
 * 例如 command="node", args=["-e", "console.log(1)"] => prefix="node"
 */
function buildTrustPrefix(command: string): string {
  return extractExecutableIdentity(command)
}

function buildTrustCandidate(command: string, args: string[], shell: boolean): TrustCandidate {
  const commandLine = normalizeCommandLine(command, args)
  const executable = extractExecutableIdentity(command)
  const wrapperInvocation = parseShellWrapperInvocation(commandLine)

  if (shell) {
    return {
      prefix: commandLine || executable,
      matchMode: 'commandLineExact',
      persistable: false,
      detail: '不可持久信任：shell=true 命令每次都需要确认'
    }
  }

  if (wrapperInvocation) {
    return {
      prefix: commandLine,
      matchMode: 'commandLineExact',
      persistable: !hasObfuscatedShellPatterns(commandLine),
      detail: '完整命令精确匹配（shell wrapper 不会被泛化信任）'
    }
  }

  return {
    prefix: buildTrustPrefix(command),
    matchMode: 'executable',
    persistable: true,
    detail: '可执行文件匹配'
  }
}

function isTrustedCommandMatch(record: CommandTrustRecord, executable: string, commandLine: string): boolean {
  const mode = record.matchMode || 'executable'
  if (mode === 'commandLineExact') {
    return commandLine === record.prefix
  }
  return executable === record.prefix
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))]
}

export class CommandRunnerService {
  private activeCount = 0
  private waitQueue: Array<() => void> = []
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly requestConsent?: (request: CommandConsentRequest) => Promise<CommandConsentDecision>
  private readonly prepareSandbox: CommandSandboxPreparer

  constructor(private readonly deps: CommandRunnerDeps) {
    this.now = deps.now || (() => Date.now())
    this.randomId = deps.randomId || (() => Math.random().toString(36).slice(2, 8))
    this.requestConsent = deps.requestConsent
    this.prepareSandbox = deps.prepareSandbox || prepareCommandSandbox
  }

  getPolicy(): CommandRunnerSettings {
    return this.deps.getPolicy()
  }

  updatePolicy(patch: Partial<CommandRunnerSettings>): CommandRunnerSettings {
    const current = this.getPolicy()
    const next: CommandRunnerSettings = {
      ...current,
      ...patch,
      audit: patch.audit
        ? {
            ...current.audit,
            ...patch.audit
          }
        : current.audit
    }
    return this.deps.updatePolicy(next)
  }

  listAudit(limit = 100, pluginId?: string): CommandAuditItem[] {
    const records = this.getPolicy().audit.records || []
    const normalizedLimit = clamp(Number(limit || 100), 1, 1000)
    const filtered = pluginId
      ? records.filter((item) => item.pluginId === pluginId)
      : records
    return filtered.slice(-normalizedLimit).reverse()
  }

  clearAudit(pluginId?: string): CommandRunnerSettings {
    const policy = this.getPolicy()
    const records = pluginId
      ? (policy.audit.records || []).filter((item) => item.pluginId !== pluginId)
      : []
    return this.updatePolicy({
      audit: {
        ...policy.audit,
        records
      }
    })
  }

  clearTrustedFingerprints(pluginId?: string): CommandRunnerSettings {
    const policy = this.getPolicy()
    const trustedFingerprints = pluginId
      ? (policy.trustedFingerprints || []).filter((item) => item.pluginId !== pluginId)
      : []
    return this.updatePolicy({ trustedFingerprints })
  }

  async runCommand(input: RunCommandInput, context: RunCommandContext): Promise<RunCommandResult> {
    const command = String(input.command || '').trim()
    if (!command) {
      throw new Error('Command is required')
    }
    const args = normalizeArgs(input.args)
    const env = normalizeEnv(input.env)
    const shell = input.shell === true
    const settings = this.getPolicy()
    const timeoutMs = clamp(
      Number(input.timeoutMs || settings.defaultTimeoutMs || 30_000),
      1000,
      settings.maxTimeoutMs || 300_000
    )
    const startAt = this.now()
    const envKeys = listEnvKeys(env)
    const sanitizedEnvKeys = sanitizeEnvKeysForAudit(envKeys, settings)
    let profileResolution: ReturnType<typeof resolveExecutionProfile>
    try {
      profileResolution = resolveExecutionProfile(input, context)
    } catch (error) {
      const durationMs = this.now() - startAt
      const message = error instanceof Error ? error.message : String(error)
      this.appendAudit({
        id: this.makeAuditId(),
        timestamp: startAt,
        source: context.source,
        pluginId: context.pluginId,
        caller: context.caller,
        command,
        args,
        envKeys: sanitizedEnvKeys,
        cwd: input.cwd,
        shell,
        timeoutMs,
        durationMs,
        status: 'blocked',
        reason: message,
        success: false
      })
      throw error
    }
    const executionProfile = profileResolution.resolved
    const rootScope = resolveCommandRootScope(input, settings, executionProfile, context)
    const writeRootScope = resolveCommandWriteRootScope(input, settings, executionProfile, context)
    let sandboxLevel = resolveSandboxLevel(executionProfile, settings)
    let sandboxBackend: CommandSandboxBackendName | undefined = sandboxLevel === 'policy' ? 'policy' : undefined
    let sandboxFallbackReason: string | undefined
    const networkAllowed = executionProfile === 'trusted'
      ? true
      : input.network === true && (executionProfile !== 'sandbox' || settings.sandbox?.networkAllowed === true)

    try {
      await this.acquire(settings.maxConcurrent || 4, settings.maxQueueSize)
    } catch (error) {
      // 队列/并发拒绝路径也需要写入审计，避免异常原因静默丢失
      const durationMs = this.now() - startAt
      const message = error instanceof Error ? error.message : String(error)
      const status: CommandAuditItem['status'] = isCommandPolicyError(error) ? 'blocked' : 'error'
      this.appendAudit({
        id: this.makeAuditId(),
        timestamp: startAt,
        source: context.source,
        pluginId: context.pluginId,
        caller: context.caller,
        executionProfile,
        sandboxLevel,
        sandboxBackend,
        sandboxFallbackReason,
        elevatedFrom: profileResolution.elevatedFrom,
        networkAllowed,
        rootScope,
        command,
        args,
        envKeys: sanitizedEnvKeys,
        cwd: input.cwd,
        shell,
        timeoutMs,
        durationMs,
        status,
        reason: message,
        success: false
      })
      throw error
    }
    try {
      await this.ensureAllowed({
        command,
        args,
        env,
        envKeys,
        sanitizedEnvKeys,
        cwd: input.cwd,
        shell,
        timeoutMs,
        context,
        settings,
        executionProfile,
        rootScope,
        networkRequested: input.network === true,
        networkAllowed
      })

      // 构建安全环境变量：继承 process.env 但排除 denyEnvKeys 黑名单
      const safeEnv = buildSafeEnv(context, env, context.envKeys, executionProfile, settings.denyEnvKeys)
      const spawnPlan = this.prepareSandbox({
        command,
        args,
        cwd: input.cwd,
        env: safeEnv,
        shell,
        executionProfile,
        settings,
        rootScope,
        writeRootScope,
        networkAllowed
      })
      sandboxLevel = spawnPlan.sandboxLevel
      sandboxBackend = spawnPlan.sandboxBackend
      sandboxFallbackReason = spawnPlan.sandboxFallbackReason

      const result = await this.execute({
        command: spawnPlan.command,
        args: spawnPlan.args,
        cwd: spawnPlan.cwd,
        env: spawnPlan.env,
        shell: spawnPlan.shell,
        timeoutMs,
        maxOutputBytes: settings.maxOutputBytes || 1_048_576,
        abortSignal: context.abortSignal,
        onChildSpawned: spawnPlan.onChildSpawned
      })
      const durationMs = this.now() - startAt
      const auditStatus: CommandAuditItem['status'] = result.timedOut ? 'timeout' : 'allowed'
      this.appendAudit({
        id: this.makeAuditId(),
        timestamp: startAt,
        source: context.source,
        pluginId: context.pluginId,
        caller: context.caller,
        executionProfile,
        sandboxLevel,
        sandboxBackend,
        sandboxFallbackReason,
        elevatedFrom: profileResolution.elevatedFrom,
        networkAllowed,
        rootScope,
        command,
        args,
        envKeys: sanitizedEnvKeys,
        cwd: input.cwd,
        shell,
        timeoutMs,
        durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        status: auditStatus,
        success: result.success,
        timedOut: result.timedOut,
        truncated: result.truncated
      })
      return {
        ...result,
        command,
        args,
        cwd: input.cwd,
        shell,
        durationMs
      }
    } catch (error) {
      const durationMs = this.now() - startAt
      const message = error instanceof Error ? error.message : String(error)
      const status: CommandAuditItem['status'] = isCommandPolicyError(error) ? 'blocked' : 'error'
      this.appendAudit({
        id: this.makeAuditId(),
        timestamp: startAt,
        source: context.source,
        pluginId: context.pluginId,
        caller: context.caller,
        executionProfile,
        sandboxLevel,
        sandboxBackend,
        sandboxFallbackReason,
        elevatedFrom: profileResolution.elevatedFrom,
        networkAllowed,
        rootScope,
        command,
        args,
        envKeys: sanitizedEnvKeys,
        cwd: input.cwd,
        shell,
        timeoutMs,
        durationMs,
        status,
        reason: message,
        success: false
      })
      throw error
    } finally {
      this.release()
    }
  }

  private makeAuditId(): string {
    return `audit-${this.now()}-${this.randomId()}`
  }

  private async ensureAllowed(input: {
    command: string
    args: string[]
    env?: Record<string, string>
    envKeys: string[]
    sanitizedEnvKeys: string[]
    cwd?: string
    shell: boolean
    timeoutMs: number
    context: RunCommandContext
    settings: CommandRunnerSettings
    executionProfile: CommandExecutionProfile
    rootScope: string[]
    networkRequested: boolean
    networkAllowed: boolean
  }): Promise<void> {
    const { command, args, envKeys, sanitizedEnvKeys, cwd, shell, context, settings, executionProfile, rootScope, networkRequested, networkAllowed } = input
    if (!settings.enabled) {
      throw new CommandPolicyError('命令执行能力已在设置中禁用')
    }
    if (context.source === 'plugin' && context.runCommandAllowed !== true) {
      throw new CommandPolicyError(`插件 ${context.pluginId || ''} 未声明 runCommand 权限`)
    }
    if (shell && !settings.allowShell) {
      throw new CommandPolicyError('当前策略禁止 shell=true 执行')
    }
    assertCwdAllowed(cwd, rootScope, executionProfile)
    if (executionProfile === 'sandbox' && networkAllowed !== true && networkRequested) {
      throw new CommandPolicyError('sandbox 执行环境默认禁止网络访问')
    }
    if (executionProfile === 'sandbox' && shell) {
      throw new CommandPolicyError('sandbox 执行环境默认禁止 shell=true 执行')
    }

    const commandLine = normalizeCommandLine(command, args)
    const executable = extractExecutableIdentity(command)
    const wrapperInvocation = parseShellWrapperInvocation(commandLine)
    const shellLike = shell || !!wrapperInvocation

    // 对 shell 命令做增强的 denyList 匹配：
    // 提取所有可执行 token（包括管道、链接、sh -c 包装的真实命令、$()/backtick 嵌套）
    if (shellLike) {
      // 兜底：混淆/编码类 shell 命令即使通过 denyList 也不允许继续
      // （base64+eval、PowerShell -EncodedCommand、/dev/tcp 反弹 shell 等）
      if (hasObfuscatedShellPatterns(commandLine)) {
        throw new CommandPolicyError('Shell 命令包含混淆/编码特征，已被安全策略拦截')
      }
      const shellTokens = extractShellTokens(commandLine)
      for (const token of shellTokens) {
        const denyMatch = findMatchingRule(settings.denyList || [], token, commandLine)
        if (denyMatch.matched) {
          throw new CommandPolicyError(`Shell 命令命中黑名单规则：${denyMatch.rule?.value || 'unknown'}`)
        }
      }
    } else {
      const denyMatch = findMatchingRule(settings.denyList || [], executable, commandLine)
      if (denyMatch.matched) {
        throw new CommandPolicyError(`命令命中黑名单规则：${denyMatch.rule?.value || 'unknown'}`)
      }
    }

    const enabledAllowRules = (settings.allowList || []).filter((item) => item.enabled !== false && String(item.value || '').trim())
    let allowListEvaluation: AllowListEvaluation = { hasRules: enabledAllowRules.length > 0, matched: false }
    if (enabledAllowRules.length > 0) {
      if (shellLike) {
        // shell 深度评估：所有提取出的业务 token（非 shell wrapper）都匹配时，
        // 视为命中白名单；未命中不再硬拒绝，而是进入 consent 流程。
        //
        // 注意：内层 token 匹配时不传完整 commandLine（否则 rule.value='sh' 的
        // prefix 规则会因 commandLine 以 "sh " 开头而满足，导致深度校验失效）。
        const tokens = extractShellTokens(commandLine)
        const businessTokens = tokens.filter((t) => !SHELL_WRAPPERS.has(getExecutableName(t)))
        const candidates = businessTokens.length > 0 ? businessTokens : tokens
        const matchedRules: string[] = []
        const unmatchedTokens: string[] = []
        for (const token of candidates) {
          const match = findMatchingRule(enabledAllowRules, token, token)
          if (match.matched) matchedRules.push(match.rule?.value || token)
          else unmatchedTokens.push(token)
        }
        const uniqueMatchedRules = uniqueNonEmpty(matchedRules)
        const uniqueUnmatchedTokens = uniqueNonEmpty(unmatchedTokens)
        allowListEvaluation = {
          hasRules: true,
          matched: candidates.length > 0 && uniqueUnmatchedTokens.length === 0,
          detail: uniqueUnmatchedTokens.length === 0
            ? `命中白名单规则：${uniqueMatchedRules.join(', ') || '(unknown)'}`
            : `未命中白名单：${uniqueUnmatchedTokens.join(', ')}`
        }
      } else {
        const allowMatch = findMatchingRule(enabledAllowRules, executable, commandLine)
        allowListEvaluation = {
          hasRules: true,
          matched: allowMatch.matched,
          detail: allowMatch.matched
            ? `命中白名单规则：${allowMatch.rule?.value || executable || command}`
            : `未命中白名单：${executable || command}`
        }
      }
    }

    const denyEnvSet = new Set((settings.denyEnvKeys || []).map((item) => normalizeEnvKey(item)))
    const blockedEnvKeys = envKeys.filter((key) => denyEnvSet.has(key))
    if (blockedEnvKeys.length > 0) {
      throw new CommandPolicyError(`命令环境变量命中黑名单：${blockedEnvKeys.join(', ')}`)
    }

    if (!settings.requireConsent) return
    if (context.source === 'app' && context.assumeUserApproved === true) return
    if (allowListEvaluation.hasRules && allowListEvaluation.matched) return

    const trustCandidate = buildTrustCandidate(command, args, shell)

    // 信任匹配：精确匹配可执行文件名或安全的完整命令 + source/pluginId + shell 兼容性
    // - 用 executable 精确匹配（非 commandLine 前缀），避免 git 匹配到 git-lfs
    // - shell:true 信任记录已废弃 — 不论是旧记录还是新记录，shell:true 一律不免确认
    // - shell:false 信任不覆盖 shell:true 执行（shell:true 风险面更大）
    const trusted = (settings.trustedFingerprints || []).find((item) => {
      if (item.source !== context.source) return false
      if ((item.pluginId || '') !== (context.pluginId || '')) return false
      if (!isTrustedCommandMatch(item, executable, commandLine)) return false
      // 当前执行使用 shell:true 时，无论信任记录如何，都不跳过确认
      if (shell) return false
      // shell:true 的旧信任记录不再有效（安全收紧）
      if (item.shell) return false
      return true
    })
    if (trusted) {
      this.updateTrustedLastUsed(trusted.prefix, context.source, context.pluginId)
      return
    }

    const preview = [command, ...args].join(' ').trim()
    const request: CommandConsentRequest = {
      source: context.source,
      pluginId: context.pluginId,
      command,
      args,
      cwd,
      envKeys: sanitizedEnvKeys,
      shell,
      timeoutMs: input.timeoutMs,
      preview: preview || command,
      trustPersistable: trustCandidate.persistable,
      trustScope: trustCandidate.prefix,
      trustScopeKind: trustCandidate.persistable ? trustCandidate.matchMode : 'none',
      title: context.source === 'plugin' ? '插件请求执行命令' : '应用请求执行命令',
      message: context.source === 'plugin'
        ? `插件 ${context.pluginId || 'unknown'} 请求执行系统命令`
        : '应用请求执行系统命令',
      detail: [
        `命令: ${preview || command}`,
        allowListEvaluation.hasRules
          ? `白名单: ${allowListEvaluation.detail || (allowListEvaluation.matched ? '命中' : '未命中，将请求本次确认')}`
          : undefined,
        trustCandidate.persistable
          ? `信任范围: ${trustCandidate.prefix}（${trustCandidate.detail}）`
          : `信任范围: ${trustCandidate.detail}`,
        `cwd: ${cwd || process.cwd()}`,
        sanitizedEnvKeys.length > 0 ? `env keys: ${sanitizedEnvKeys.join(', ')}` : 'env keys: (none)',
        `shell: ${shell ? 'true' : 'false'}`,
        `timeout: ${input.timeoutMs}ms`
      ].filter((line): line is string => !!line).join('\n')
    }

    const decision = this.requestConsent
      ? await this.requestConsent(request)
      : 'deny'

    if (decision === 'deny') {
      throw new CommandPolicyError('用户拒绝执行命令')
    }
    if (decision === 'trust') {
      // shell:true 命令禁止持久信任 — 每次执行都必须确认
      // shell 模式风险面过大（可注入任意命令），不适合免确认
      if (trustCandidate.persistable) {
        this.addTrustedPrefix({
          prefix: trustCandidate.prefix,
          matchMode: trustCandidate.matchMode,
          source: context.source,
          pluginId: context.pluginId,
          command,
          args,
          shell
        })
      }
    }
  }

  private execute(input: {
    command: string
    args: string[]
    cwd?: string
    env?: Record<string, string>
    shell: boolean
    timeoutMs: number
    maxOutputBytes: number
    abortSignal?: AbortSignal
    onChildSpawned?: (child: ChildProcess) => void | (() => void)
  }): Promise<Omit<RunCommandResult, 'command' | 'args' | 'cwd' | 'shell' | 'durationMs'>> {
    return new Promise((resolve, reject) => {
      // 严格使用 buildSafeEnv 构造的受限环境，禁止回退到 process.env
      // （防止上游调用链遗漏 safeEnv 构造时，静默降级到完整环境）
      if (!input.env) {
        reject(new Error('内部错误：命令执行缺少受限环境变量（safeEnv 未构造）'))
        return
      }
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        shell: input.shell,
        windowsHide: true
      })
      child.stdin?.end()

      let stdoutBytes = 0
      let stderrBytes = 0
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let truncated = false
      let timedOut = false
      let aborted = false
      let killTimer: NodeJS.Timeout | null = null
      let forceKillTimer: NodeJS.Timeout | null = null
      let settled = false
      let abortListener: (() => void) | null = null
      let processSandboxCleanup: (() => void) | void

      const cleanup = () => {
        if (killTimer) {
          clearTimeout(killTimer)
          killTimer = null
        }
        if (forceKillTimer) {
          clearTimeout(forceKillTimer)
          forceKillTimer = null
        }
        if (abortListener && input.abortSignal) {
          input.abortSignal.removeEventListener('abort', abortListener)
          abortListener = null
        }
        if (processSandboxCleanup) {
          try {
            processSandboxCleanup()
          } catch {
            // ignore cleanup failures
          }
          processSandboxCleanup = undefined
        }
      }

      const finalizeResolve = (value: Omit<RunCommandResult, 'command' | 'args' | 'cwd' | 'shell' | 'durationMs'>) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }

      const finalizeReject = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const scheduleForceKill = () => {
        if (forceKillTimer) return
        forceKillTimer = setTimeout(() => {
          if (!child.killed && child.pid) {
            try {
              // 强制终止整个进程树
              treeKill(child.pid, 'SIGKILL', () => { /* ignore */ })
            } catch {
              // ignore
            }
          }
        }, 2000)
      }

      const terminateProcess = () => {
        if (!child.pid) {
          try { child.kill('SIGTERM') } catch { /* ignore */ }
          scheduleForceKill()
          return
        }
        // 使用 tree-kill 终止整个进程树，防止孤儿进程
        treeKill(child.pid, 'SIGTERM', (err) => {
          if (err) {
            // tree-kill 失败时回退到直接 kill
            try { child.kill('SIGTERM') } catch { /* ignore */ }
          }
        })
        scheduleForceKill()
      }

      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          const next = appendWithLimit(stdoutChunks, stdoutBytes, Buffer.from(data), input.maxOutputBytes)
          stdoutBytes = next.bytes
          truncated = truncated || next.truncated
        })
      }
      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          const next = appendWithLimit(stderrChunks, stderrBytes, Buffer.from(data), input.maxOutputBytes)
          stderrBytes = next.bytes
          truncated = truncated || next.truncated
        })
      }

      try {
        processSandboxCleanup = input.onChildSpawned?.(child)
      } catch (error) {
        terminateProcess()
        finalizeReject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      killTimer = setTimeout(() => {
        timedOut = true
        terminateProcess()
      }, input.timeoutMs)

      abortListener = () => {
        aborted = true
        terminateProcess()
      }
      if (input.abortSignal) {
        if (input.abortSignal.aborted) {
          abortListener()
        } else {
          input.abortSignal.addEventListener('abort', abortListener, { once: true })
        }
      }

      child.on('error', (error) => {
        if (aborted) {
          finalizeReject(createAbortError())
          return
        }
        finalizeReject(error instanceof Error ? error : new Error(String(error)))
      })

      child.on('close', (code, signal) => {
        if (aborted) {
          finalizeReject(createAbortError())
          return
        }
        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderr = Buffer.concat(stderrChunks).toString('utf8')
        const success = !timedOut && code === 0
        finalizeResolve({
          success,
          stdout,
          stderr,
          exitCode: code,
          signal: signal ? String(signal) : null,
          timedOut,
          truncated
        })
      })
    })
  }

  private addTrustedPrefix(input: {
    prefix: string
    matchMode: NonNullable<CommandTrustRecord['matchMode']>
    source: 'app' | 'plugin'
    pluginId?: string
    command: string
    args: string[]
    shell: boolean
  }): void {
    const policy = this.getPolicy()
    const now = this.now()
    const nextRecords = [...(policy.trustedFingerprints || [])]
    // 查找同 source + pluginId + prefix + matchMode 的已有记录
    const existedIndex = nextRecords.findIndex((item) =>
      item.prefix === input.prefix &&
      (item.matchMode || 'executable') === input.matchMode &&
      item.source === input.source &&
      (item.pluginId || '') === (input.pluginId || '')
    )
    if (existedIndex >= 0) {
      nextRecords[existedIndex] = {
        ...nextRecords[existedIndex],
        lastUsedAt: now
      }
    } else {
      const nextRecord: CommandTrustRecord = {
        prefix: input.prefix,
        matchMode: input.matchMode,
        source: input.source,
        pluginId: input.pluginId,
        command: input.command,
        args: [...input.args],
        shell: input.shell,
        createdAt: now,
        lastUsedAt: now
      }
      nextRecords.push(nextRecord)
    }
    this.updatePolicy({
      trustedFingerprints: nextRecords.slice(-1000)
    })
  }

  private updateTrustedLastUsed(prefix: string, source: string, pluginId?: string): void {
    const policy = this.getPolicy()
    const list = [...(policy.trustedFingerprints || [])]
    const index = list.findIndex((item) =>
      item.prefix === prefix &&
      item.source === source &&
      (item.pluginId || '') === (pluginId || '')
    )
    if (index < 0) return
    list[index] = {
      ...list[index],
      lastUsedAt: this.now()
    }
    this.updatePolicy({
      trustedFingerprints: list
    })
  }

  private appendAudit(record: CommandAuditItem): void {
    const policy = this.getPolicy()
    const maxItems = Math.max(10, Number(policy.audit.maxItems || 500))
    const next = [...(policy.audit.records || []), record].slice(-maxItems)
    this.updatePolicy({
      audit: {
        ...policy.audit,
        records: next
      }
    })
  }

  private async acquire(maxConcurrent: number, maxQueueSize?: number): Promise<void> {
    const max = Math.max(1, maxConcurrent || 1)
    if (this.activeCount < max) {
      this.activeCount += 1
      return
    }
    // 队列容量检查：防止资源耗尽
    const queueLimit = maxQueueSize ?? 20
    if (this.waitQueue.length >= queueLimit) {
      throw new CommandPolicyError(`命令等待队列已满（上限 ${queueLimit}），请稍后重试`)
    }
    await new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeCount += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1)
    const next = this.waitQueue.shift()
    if (next) next()
  }
}
