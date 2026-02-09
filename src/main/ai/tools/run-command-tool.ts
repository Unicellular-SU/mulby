import type { AiTool } from '../../../shared/types/ai'
import type { RunCommandInput, RunCommandResult } from '../../services/command-runner'

export const AI_RUN_COMMAND_TOOL_NAME = 'intools_run_command'

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
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('runCommand args must be an object')
  }
  const input = args as Record<string, unknown>
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
