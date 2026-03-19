import { spawn } from 'node:child_process'
import type {
  CommandAuditItem,
  CommandRule,
  CommandRunnerSettings,
  CommandTrustRecord
} from '../../shared/types/settings'

export interface RunCommandInput {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  shell?: boolean
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
  allowShellOverride?: boolean
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
  title: string
  message: string
  detail: string
}

export type CommandConsentDecision = 'deny' | 'allow-once' | 'trust'

export interface CommandRunnerDeps {
  getPolicy: () => CommandRunnerSettings
  updatePolicy: (next: CommandRunnerSettings) => CommandRunnerSettings
  requestConsent?: (request: CommandConsentRequest) => Promise<CommandConsentDecision>
  now?: () => number
  randomId?: () => string
}

interface RuleMatchResult {
  matched: boolean
  rule?: CommandRule
}

class CommandPolicyError extends Error {
  readonly kind: 'blocked'

  constructor(message: string) {
    super(message)
    this.name = 'CommandPolicyError'
    this.kind = 'blocked'
  }
}

function normalizeCommandToken(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeCommandLine(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim().toLowerCase()
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
  return normalizeCommandToken(command)
}

export class CommandRunnerService {
  private activeCount = 0
  private waitQueue: Array<() => void> = []
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly requestConsent?: (request: CommandConsentRequest) => Promise<CommandConsentDecision>

  constructor(private readonly deps: CommandRunnerDeps) {
    this.now = deps.now || (() => Date.now())
    this.randomId = deps.randomId || (() => Math.random().toString(36).slice(2, 8))
    this.requestConsent = deps.requestConsent
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

    await this.acquire(settings.maxConcurrent || 4)
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
        settings
      })

      const result = await this.execute({
        command,
        args,
        cwd: input.cwd,
        env,
        shell,
        timeoutMs,
        maxOutputBytes: settings.maxOutputBytes || 1_048_576,
        abortSignal: context.abortSignal
      })
      const durationMs = this.now() - startAt
      const auditStatus: CommandAuditItem['status'] = result.timedOut ? 'timeout' : 'allowed'
      this.appendAudit({
        id: this.makeAuditId(),
        timestamp: startAt,
        source: context.source,
        pluginId: context.pluginId,
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
      const status: CommandAuditItem['status'] = error instanceof CommandPolicyError ? 'blocked' : 'error'
      this.appendAudit({
        id: this.makeAuditId(),
        timestamp: startAt,
        source: context.source,
        pluginId: context.pluginId,
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
  }): Promise<void> {
    const { command, args, envKeys, sanitizedEnvKeys, cwd, shell, context, settings } = input
    if (!settings.enabled) {
      throw new CommandPolicyError('命令执行能力已在设置中禁用')
    }
    if (context.source === 'plugin' && context.runCommandAllowed !== true) {
      throw new CommandPolicyError(`插件 ${context.pluginId || ''} 未声明 runCommand 权限`)
    }
    if (shell && !settings.allowShell && context.allowShellOverride !== true) {
      throw new CommandPolicyError('当前策略禁止 shell=true 执行')
    }

    const executable = normalizeCommandToken(command)
    const commandLine = normalizeCommandLine(command, args)
    const denyMatch = findMatchingRule(settings.denyList || [], executable, commandLine)
    if (denyMatch.matched) {
      throw new CommandPolicyError(`命令命中黑名单规则：${denyMatch.rule?.value || 'unknown'}`)
    }

    const enabledAllowRules = (settings.allowList || []).filter((item) => item.enabled !== false && String(item.value || '').trim())
    if (enabledAllowRules.length > 0) {
      const allowMatch = findMatchingRule(enabledAllowRules, executable, commandLine)
      if (!allowMatch.matched) {
        throw new CommandPolicyError('命令不在白名单中')
      }
    }

    const denyEnvSet = new Set((settings.denyEnvKeys || []).map((item) => normalizeEnvKey(item)))
    const blockedEnvKeys = envKeys.filter((key) => denyEnvSet.has(key))
    if (blockedEnvKeys.length > 0) {
      throw new CommandPolicyError(`命令环境变量命中黑名单：${blockedEnvKeys.join(', ')}`)
    }

    if (!settings.requireConsent) return
    if (context.source === 'app' && context.assumeUserApproved === true) return

    // 信任匹配：精确匹配可执行文件名 + source/pluginId + shell 兼容性
    // - 用 executable 精确匹配（非 commandLine 前缀），避免 git 匹配到 git-lfs
    // - shell:false 信任不覆盖 shell:true 执行（shell:true 风险面更大）
    const trusted = (settings.trustedFingerprints || []).find((item) => {
      if (item.source !== context.source) return false
      if ((item.pluginId || '') !== (context.pluginId || '')) return false
      if (executable !== item.prefix) return false
      // shell 兼容性：shell:true 信任覆盖所有；shell:false 仅覆盖非 shell 执行
      if (shell && !item.shell) return false
      return true
    })
    if (trusted) {
      this.updateTrustedLastUsed(trusted.prefix, context.source, context.pluginId)
      return
    }

    const prefix = buildTrustPrefix(command)
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
      title: context.source === 'plugin' ? '插件请求执行命令' : '应用请求执行命令',
      message: context.source === 'plugin'
        ? `插件 ${context.pluginId || 'unknown'} 请求执行系统命令`
        : '应用请求执行系统命令',
      detail: [
        `命令: ${preview || command}`,
        `信任前缀: ${prefix}（信任后，以此开头的命令将自动允许）`,
        `cwd: ${cwd || process.cwd()}`,
        sanitizedEnvKeys.length > 0 ? `env keys: ${sanitizedEnvKeys.join(', ')}` : 'env keys: (none)',
        `shell: ${shell ? 'true' : 'false'}`,
        `timeout: ${input.timeoutMs}ms`
      ].join('\n')
    }

    const decision = this.requestConsent
      ? await this.requestConsent(request)
      : 'deny'

    if (decision === 'deny') {
      throw new CommandPolicyError('用户拒绝执行命令')
    }
    if (decision === 'trust') {
      this.addTrustedPrefix({
        prefix,
        source: context.source,
        pluginId: context.pluginId,
        command,
        args,
        shell
      })
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
  }): Promise<Omit<RunCommandResult, 'command' | 'args' | 'cwd' | 'shell' | 'durationMs'>> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: {
          ...process.env,
          ...(input.env || {})
        },
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
          if (!child.killed) {
            try {
              child.kill('SIGKILL')
            } catch {
              // ignore
            }
          }
        }, 2000)
      }

      const terminateProcess = () => {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore
        }
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
    source: 'app' | 'plugin'
    pluginId?: string
    command: string
    args: string[]
    shell: boolean
  }): void {
    const policy = this.getPolicy()
    const now = this.now()
    const nextRecords = [...(policy.trustedFingerprints || [])]
    // 查找同 source + pluginId + prefix 的已有记录
    const existedIndex = nextRecords.findIndex((item) =>
      item.prefix === input.prefix &&
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

  private async acquire(maxConcurrent: number): Promise<void> {
    const max = Math.max(1, maxConcurrent || 1)
    if (this.activeCount < max) {
      this.activeCount += 1
      return
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
