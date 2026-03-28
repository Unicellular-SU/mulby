import type { AiTool } from '../../../shared/types/ai'
import type { RunCommandInput, RunCommandResult } from '../../services/command-runner'
import { sanitizeControlCharsInJsonStrings } from '../service/utils'

export const AI_RUN_COMMAND_TOOL_NAME = 'mulby_run_command'

function tryParsePossiblyMalformedJson(input: string): unknown {
  const source = String(input || '')
  try {
    return JSON.parse(source)
  } catch {
    // Most common cause: LLM produces literal newline/tab/CR chars inside JSON
    // string values. Use context-aware sanitizer that only escapes control chars
    // inside string literals, preserving structural whitespace in pretty-printed JSON.
    const controlFixed = sanitizeControlCharsInJsonStrings(source)
    if (controlFixed) {
      try {
        return JSON.parse(controlFixed)
      } catch {
        // fall through
      }
    }
    // Some providers return non-standard escapes like "\|", which breaks JSON.parse.
    // Recover by escaping only backslashes that are not valid JSON escapes.
    const base = controlFixed ?? source
    const escapeSanitized = base.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
    if (escapeSanitized !== base) {
      try {
        return JSON.parse(escapeSanitized)
      } catch {
        // fall through to embedded object extraction
      }
    }
    // Last resort: try extracting an embedded JSON object from within the string.
    // Some models produce args like: 'Here is the command: {"command":"...","args":[...]}'
    const extractBase = controlFixed ?? source
    const firstBrace = extractBase.indexOf('{')
    const lastBrace = extractBase.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = extractBase.slice(firstBrace, lastBrace + 1)
      try {
        return JSON.parse(slice)
      } catch {
        // ignore
      }
    }
    const preview = source.length > 120 ? source.slice(0, 120) + '...' : source
    throw new Error(`runCommand args must be an object (got unparseable string: ${preview})`)
  }
}

function parseRunCommandArgsObject(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  if (typeof args !== 'string') {
    const typeName = args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args
    throw new Error(`runCommand args must be an object (got ${typeName})`)
  }
  const firstRaw = args.trim()
  if (!firstRaw) {
    throw new Error('runCommand args must be an object (got empty string)')
  }

  let firstParsed: unknown
  try {
    firstParsed = tryParsePossiblyMalformedJson(firstRaw)
  } catch {
    const preview = firstRaw.length > 120 ? firstRaw.slice(0, 120) + '...' : firstRaw
    throw new Error(`runCommand args must be an object (failed to parse: ${preview})`)
  }

  if (firstParsed && typeof firstParsed === 'object' && !Array.isArray(firstParsed)) {
    return firstParsed as Record<string, unknown>
  }
  if (typeof firstParsed === 'string') {
    const secondRaw = firstParsed.trim()
    if (!secondRaw) throw new Error('runCommand args must be an object (double-stringified empty)')
    try {
      const secondParsed = tryParsePossiblyMalformedJson(secondRaw)
      if (secondParsed && typeof secondParsed === 'object' && !Array.isArray(secondParsed)) {
        return secondParsed as Record<string, unknown>
      }
      // Handle triple-stringified edge case
      if (typeof secondParsed === 'string') {
        const thirdRaw = secondParsed.trim()
        if (thirdRaw) {
          try {
            const thirdParsed = tryParsePossiblyMalformedJson(thirdRaw)
            if (thirdParsed && typeof thirdParsed === 'object' && !Array.isArray(thirdParsed)) {
              return thirdParsed as Record<string, unknown>
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore and throw unified error below
    }
  }

  const preview = firstRaw.length > 120 ? firstRaw.slice(0, 120) + '...' : firstRaw
  throw new Error(`runCommand args must be an object (parsed to ${typeof firstParsed}, raw: ${preview})`)
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
