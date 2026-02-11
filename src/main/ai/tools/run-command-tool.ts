import type { AiTool } from '../../../shared/types/ai'
import type { RunCommandInput, RunCommandResult } from '../../services/command-runner'

export const AI_RUN_COMMAND_TOOL_NAME = 'mulby_run_command'

function tryParsePossiblyMalformedJson(input: string): unknown {
  const source = String(input || '')
  try {
    return JSON.parse(source)
  } catch {
    // Some providers return non-standard escapes like "\|", which breaks JSON.parse.
    // Recover by escaping only backslashes that are not valid JSON escapes.
    const sanitized = source.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
    if (sanitized !== source) {
      return JSON.parse(sanitized)
    }
    throw new Error('runCommand args must be an object')
  }
}

function parseRunCommandArgsObject(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  if (typeof args !== 'string') {
    throw new Error('runCommand args must be an object')
  }
  const firstRaw = args.trim()
  if (!firstRaw) {
    throw new Error('runCommand args must be an object')
  }

  let firstParsed: unknown
  try {
    firstParsed = tryParsePossiblyMalformedJson(firstRaw)
  } catch {
    throw new Error('runCommand args must be an object')
  }

  if (firstParsed && typeof firstParsed === 'object' && !Array.isArray(firstParsed)) {
    return firstParsed as Record<string, unknown>
  }
  if (typeof firstParsed === 'string') {
    const secondRaw = firstParsed.trim()
    if (!secondRaw) throw new Error('runCommand args must be an object')
    try {
      const secondParsed = tryParsePossiblyMalformedJson(secondRaw)
      if (secondParsed && typeof secondParsed === 'object' && !Array.isArray(secondParsed)) {
        return secondParsed as Record<string, unknown>
      }
    } catch {
      // ignore and throw unified error below
    }
  }

  throw new Error('runCommand args must be an object')
}

export function buildAiRunCommandTool(): AiTool {
  return {
    type: 'function',
    function: {
      name: AI_RUN_COMMAND_TOOL_NAME,
      description: [
        'Execute local shell/system command and return stdout/stderr.',
        'Use only when task requires external command/script execution.',
        'Requires user consent and command policy checks.'
      ].join(' '),
      parameters: {
        type: 'object',
        required: ['command'],
        additionalProperties: false,
        properties: {
          command: {
            type: 'string',
            description: 'Executable command name or path'
          },
          args: {
            type: 'array',
            description: 'Command arguments',
            items: { type: 'string' }
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory'
          },
          env: {
            type: 'object',
            description: 'Optional environment variables'
          },
          timeoutMs: {
            type: 'number',
            description: 'Optional timeout in milliseconds'
          },
          shell: {
            type: 'boolean',
            description: 'Whether to execute through shell'
          }
        }
      }
    }
  }
}

export function parseAiRunCommandArgs(args: unknown): RunCommandInput {
  const input = parseRunCommandArgsObject(args)
  const command = String(input.command || '').trim()
  if (!command) {
    throw new Error('runCommand command is required')
  }
  const parsedArgs = Array.isArray(input.args) ? input.args.map((item) => String(item ?? '')) : undefined
  const cwd = String(input.cwd || '').trim() || undefined

  let env: Record<string, string> | undefined
  if (input.env && typeof input.env === 'object' && !Array.isArray(input.env)) {
    env = Object.fromEntries(
      Object.entries(input.env as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')])
    )
  }
  const timeoutRaw = Number(input.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined

  return {
    command,
    args: parsedArgs,
    cwd,
    env,
    timeoutMs,
    shell: input.shell === true
  }
}

export function normalizeFailedRunCommandResult(input: {
  error: unknown
  command: string
  args?: string[]
  cwd?: string
  shell?: boolean
}): RunCommandResult & { error?: string } {
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  return {
    success: false,
    command: input.command,
    args: input.args || [],
    cwd: input.cwd,
    shell: input.shell === true,
    stdout: '',
    stderr: message,
    exitCode: null,
    signal: null,
    durationMs: 0,
    timedOut: false,
    truncated: false,
    error: message
  }
}
