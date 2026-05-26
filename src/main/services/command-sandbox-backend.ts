import type { ChildProcess } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  CommandExecutionProfile,
  CommandRunnerSettings,
  CommandSandboxBackendName,
  CommandSandboxLevel
} from '../../shared/types/settings'
import {
  assignChildToWindowsJobObject,
  isWindowsJobObjectSandboxAvailable
} from './windows-job-object-sandbox'

export interface CommandSandboxSpawnPlan {
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string>
  shell: boolean
  sandboxLevel: CommandSandboxLevel
  sandboxBackend?: CommandSandboxBackendName
  sandboxFallbackReason?: string
  onChildSpawned?: (child: ChildProcess) => void | (() => void)
}

export interface CommandSandboxPrepareInput {
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string>
  shell: boolean
  executionProfile: CommandExecutionProfile
  settings: CommandRunnerSettings
  rootScope: string[]
  writeRootScope?: string[]
  networkAllowed: boolean
}

export type CommandSandboxPreparer = (input: CommandSandboxPrepareInput) => CommandSandboxSpawnPlan

class CommandSandboxBackendError extends Error {
  readonly kind = 'blocked'

  constructor(message: string) {
    super(message)
    this.name = 'CommandSandboxBackendError'
  }
}

function policyPlan(
  input: CommandSandboxPrepareInput,
  fallbackReason?: string
): CommandSandboxSpawnPlan {
  return {
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    shell: input.shell,
    sandboxLevel: input.executionProfile === 'sandbox' && input.settings.sandbox?.enabled !== false ? 'policy' : 'none',
    sandboxBackend: input.executionProfile === 'sandbox' && input.settings.sandbox?.enabled !== false ? 'policy' : undefined,
    sandboxFallbackReason: fallbackReason
  }
}

function fallbackOrThrow(input: CommandSandboxPrepareInput, reason: string): CommandSandboxSpawnPlan {
  const sandbox = input.settings.sandbox
  if (sandbox?.fallbackToPolicy === false) {
    throw new CommandSandboxBackendError(`OS sandbox backend unavailable: ${reason}`)
  }
  return policyPlan(input, reason)
}

function sandboxString(value: string): string {
  return JSON.stringify(value)
}

function uniqueResolved(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const raw = String(value || '').trim()
    if (!raw) continue
    const resolved = path.resolve(raw)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

function macClause(kind: 'subpath' | 'literal', value: string): string {
  return `(${kind} ${sandboxString(value)})`
}

function buildMacSandboxProfile(input: CommandSandboxPrepareInput): string {
  const readRoots = uniqueResolved([
    ...input.rootScope,
    ...(input.settings.sandbox?.allowedRoots || []),
    input.cwd,
    path.dirname(path.resolve(input.command))
  ])
  const writeRoots = uniqueResolved(input.writeRootScope || input.rootScope)
  const systemReadClauses = [
    macClause('literal', '/dev/null'),
    macClause('literal', '/dev/urandom'),
    macClause('literal', '/dev/random'),
    macClause('subpath', '/bin'),
    macClause('subpath', '/sbin'),
    macClause('subpath', '/usr/bin'),
    macClause('subpath', '/usr/sbin'),
    macClause('subpath', '/usr/lib'),
    macClause('subpath', '/usr/share'),
    macClause('subpath', '/System'),
    macClause('subpath', '/Library'),
    macClause('subpath', '/private/etc'),
    macClause('subpath', '/opt/homebrew'),
    macClause('subpath', '/usr/local')
  ]
  const readClauses = readRoots.map((root) => macClause('subpath', root))
  const writeClauses = writeRoots.map((root) => macClause('subpath', root))

  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow signal (target same-sandbox))',
    `(allow file-read-metadata ${[...systemReadClauses, ...readClauses].join(' ')})`,
    `(allow file-read-data ${[...systemReadClauses, ...readClauses].join(' ')})`,
    writeClauses.length > 0 ? `(allow file-write* ${writeClauses.join(' ')})` : undefined,
    input.networkAllowed ? '(allow network*)' : undefined
  ].filter((line): line is string => !!line).join('\n')
}

let macOsSandboxExecSupported: boolean | undefined

function canUseMacOsSandboxExec(sandboxExec: string): boolean {
  if (macOsSandboxExecSupported !== undefined) return macOsSandboxExecSupported
  const result = spawnSync(sandboxExec, [
    '-p',
    '(version 1)\n(deny default)\n(allow process*)\n(allow file-read* (subpath "/usr/bin"))',
    '/usr/bin/true'
  ], {
    stdio: 'ignore',
    timeout: 1500
  })
  macOsSandboxExecSupported = result.status === 0
  return macOsSandboxExecSupported
}

function prepareMacOsSandbox(input: CommandSandboxPrepareInput): CommandSandboxSpawnPlan | undefined {
  if (process.platform !== 'darwin') return undefined
  const sandboxExec = '/usr/bin/sandbox-exec'
  if (!existsSync(sandboxExec)) {
    return fallbackOrThrow(input, 'sandbox-exec not found')
  }
  if (!canUseMacOsSandboxExec(sandboxExec)) {
    return fallbackOrThrow(input, 'sandbox-exec cannot apply profiles in this process environment')
  }
  const profile = buildMacSandboxProfile(input)
  return {
    command: sandboxExec,
    args: ['-p', profile, input.command, ...input.args],
    cwd: input.cwd,
    env: input.env,
    shell: false,
    sandboxLevel: 'os',
    sandboxBackend: 'macos-sandbox-exec'
  }
}

function prepareWindowsJobObject(input: CommandSandboxPrepareInput): CommandSandboxSpawnPlan | undefined {
  if (process.platform !== 'win32') return undefined
  if (!isWindowsJobObjectSandboxAvailable()) {
    return fallbackOrThrow(input, 'Windows Job Object native binding unavailable')
  }
  return {
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    shell: input.shell,
    sandboxLevel: 'os',
    sandboxBackend: 'windows-job-object',
    onChildSpawned: (child) => assignChildToWindowsJobObject(child)
  }
}

function findLinuxUnshare(): string | undefined {
  for (const candidate of ['/usr/bin/unshare', '/bin/unshare']) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const linuxNamespaceSupportCache = new Map<string, boolean>()

function canUseLinuxNamespace(unshare: string, networkAllowed: boolean): boolean {
  const key = `${unshare}:${networkAllowed ? 'net-allowed' : 'net-denied'}`
  const cached = linuxNamespaceSupportCache.get(key)
  if (cached !== undefined) return cached
  const args = ['--user', '--map-root-user', '--pid', '--fork']
  if (!networkAllowed) args.push('--net')
  args.push('true')
  const result = spawnSync(unshare, args, {
    stdio: 'ignore',
    timeout: 1500
  })
  const ok = result.status === 0
  linuxNamespaceSupportCache.set(key, ok)
  return ok
}

function prepareLinuxNamespace(input: CommandSandboxPrepareInput): CommandSandboxSpawnPlan | undefined {
  if (process.platform !== 'linux') return undefined
  const unshare = findLinuxUnshare()
  if (!unshare) {
    return fallbackOrThrow(input, 'unshare not found')
  }
  if (!canUseLinuxNamespace(unshare, input.networkAllowed)) {
    return fallbackOrThrow(input, 'unprivileged Linux namespace is unavailable')
  }
  const args = ['--user', '--map-root-user', '--mount', '--pid', '--fork']
  if (!input.networkAllowed) args.push('--net')
  args.push('--', input.command, ...input.args)
  return {
    command: unshare,
    args,
    cwd: input.cwd,
    env: input.env,
    shell: false,
    sandboxLevel: 'os',
    sandboxBackend: 'linux-namespace'
  }
}

export const prepareCommandSandbox: CommandSandboxPreparer = (input) => {
  if (input.executionProfile !== 'sandbox' || input.settings.sandbox?.enabled === false) {
    return policyPlan(input)
  }

  const mode = input.settings.sandbox?.backendMode || 'auto'
  if (mode === 'policy') {
    return policyPlan(input)
  }

  const osPlan = prepareMacOsSandbox(input) || prepareWindowsJobObject(input) || prepareLinuxNamespace(input)
  if (osPlan) return osPlan

  return fallbackOrThrow(input, `no OS sandbox backend for ${process.platform}`)
}
