import { basename, extname, isAbsolute, resolve, sep } from 'node:path'
import type { RunCommandInput, RunCommandResult } from '../../services/command-runner'
import { normalizeFailedRunCommandResult } from '../tools/run-command-tool'
import {
  AI_SKILL_CREATOR_INTERNAL_TAG,
  type SkillCreatorResourcePack
} from './creator-resources'

const SKILL_CREATOR_SCRIPT_INTERPRETERS = new Set(['python', 'python3', 'node', 'bun', 'deno', 'bash', 'sh', 'zsh'])

function isPathInside(root: string, target: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  if (process.platform === 'win32') {
    const rootLower = normalizedRoot.toLowerCase()
    const targetLower = normalizedTarget.toLowerCase()
    return targetLower === rootLower || targetLower.startsWith(`${rootLower}${sep}`)
  }
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}

function resolveCommandPath(rawPath: string, cwd: string): string {
  return isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath)
}

function extractFailureInput(args: unknown): { command: string; args?: string[]; cwd?: string; shell?: boolean } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { command: 'unknown' }
  }
  const input = args as Record<string, unknown>
  const command = String(input.command || '').trim() || 'unknown'
  const commandArgs = Array.isArray(input.args) ? input.args.map((item) => String(item ?? '')) : undefined
  const cwd = String(input.cwd || '').trim() || undefined
  return {
    command,
    args: commandArgs,
    cwd,
    shell: input.shell === true
  }
}

function hasHelpProbe(args: string[] | undefined): boolean {
  if (!args || args.length === 0) return false
  return args.some((item) => {
    const normalized = String(item || '').trim().toLowerCase()
    return normalized === '--help' || normalized === '-h'
  })
}

function detectScriptBasename(input: RunCommandInput): string | undefined {
  const executableName = basename(input.command).toLowerCase()
  if (SKILL_CREATOR_SCRIPT_INTERPRETERS.has(executableName)) {
    const scriptArg = (input.args || []).find((item) => {
      const value = String(item || '').trim()
      return value && !value.startsWith('-')
    })
    return scriptArg ? basename(String(scriptArg).trim()).toLowerCase() : undefined
  }
  return basename(input.command).toLowerCase()
}

function annotateSkillCreatorResult(result: RunCommandResult, input: RunCommandInput): RunCommandResult {
  const scriptName = detectScriptBasename(input)
  if (scriptName !== 'quick_validate.py') return result
  if (!result.success) return result
  const note = 'Note: quick_validate only checks structure/frontmatter, not prompt quality or workflow completeness.'
  const stdout = String(result.stdout || '')
  if (stdout.includes(note)) return result
  return {
    ...result,
    stdout: stdout ? `${stdout.trimEnd()}\n${note}\n` : `${note}\n`
  }
}

function formatSkillCreatorGuardError(error: unknown, pack: SkillCreatorResourcePack): Error {
  const baseMessage = error instanceof Error ? error.message : String(error)
  const scripts = pack.scriptFiles.map((file) => `scripts/${file}`)
  const examples = [
    scripts.includes('scripts/init_skill.py') ? 'python3 scripts/init_skill.py <skill-name> --path <target-dir>' : '',
    scripts.includes('scripts/quick_validate.py') ? 'python3 scripts/quick_validate.py <skill-dir>' : '',
    scripts.includes('scripts/package_skill.py') ? 'python3 scripts/package_skill.py <skill-dir> <output-dir>' : ''
  ].filter(Boolean)
  const hint = [
    `可用脚本: ${scripts.length > 0 ? scripts.join(', ') : '无'}`,
    examples.length > 0 ? `示例: ${examples.join(' ; ')}` : '',
    '禁止: --help/-h、bash -c/sh -c/zsh -c、ls/cat/find/pwd、python -c'
  ]
    .filter(Boolean)
    .join('。')
  return new Error(`${baseMessage}。${hint}`)
}

export function parseSkillCreatorRunCommandInput(args: unknown): RunCommandInput {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('runCommand 参数必须是对象')
  }
  const input = args as Record<string, unknown>
  const command = String(input.command || '').trim()
  if (!command) {
    throw new Error('runCommand.command 不能为空')
  }
  const commandArgs = Array.isArray(input.args) ? input.args.map((item) => String(item ?? '')) : []
  const cwd = String(input.cwd || '').trim() || undefined
  const timeoutValue = Number(input.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : undefined
  return {
    command,
    args: commandArgs,
    cwd,
    timeoutMs,
    shell: input.shell === true
  }
}

export function enforceSkillCreatorCommandGuard(input: RunCommandInput, rootPath: string): RunCommandInput {
  const cwd = input.cwd ? resolve(input.cwd) : resolve(rootPath)
  if (!isPathInside(rootPath, cwd)) {
    throw new Error('cwd 必须位于 skill-creator 根目录内')
  }
  if (input.shell === true) {
    throw new Error('禁止 shell=true，仅允许直接执行脚本命令')
  }
  if (hasHelpProbe(input.args)) {
    throw new Error('禁止使用 --help/-h 探测，请直接执行具体脚本任务')
  }

  const scriptsRoot = resolve(rootPath, 'scripts')
  const executableName = basename(input.command).toLowerCase()
  let scriptPath: string

  if (SKILL_CREATOR_SCRIPT_INTERPRETERS.has(executableName)) {
    const scriptArg = (input.args || []).find((item) => {
      const value = String(item || '').trim()
      return value && !value.startsWith('-')
    })
    if (!scriptArg) {
      throw new Error('解释器命令必须提供脚本路径参数')
    }
    scriptPath = resolveCommandPath(scriptArg, cwd)
  } else {
    scriptPath = resolveCommandPath(input.command, cwd)
    const extension = extname(scriptPath).toLowerCase()
    if (!extension || !['.py', '.js', '.mjs', '.cjs', '.sh', '.bash'].includes(extension)) {
      throw new Error('仅允许执行 scripts 目录中的脚本文件')
    }
  }

  if (!isPathInside(scriptsRoot, scriptPath)) {
    throw new Error('仅允许执行 skill-creator/scripts 目录内脚本')
  }

  return {
    ...input,
    cwd,
    shell: false
  }
}

export interface SkillCreatorToolExecutionContext {
  pluginName?: string
  internalTag?: string
}

interface ExecuteSkillCreatorToolDeps {
  loadPack: () => Promise<SkillCreatorResourcePack | null>
  runCommand: (input: RunCommandInput) => Promise<RunCommandResult>
}

export async function executeSkillCreatorRunCommandTool(
  args: unknown,
  context: SkillCreatorToolExecutionContext | undefined,
  deps: ExecuteSkillCreatorToolDeps
): Promise<RunCommandResult & { error?: string }> {
  if (context?.pluginName || context?.internalTag !== AI_SKILL_CREATOR_INTERNAL_TAG) {
    throw new Error('skill-creator 命令工具仅允许内部调用')
  }
  const pack = await deps.loadPack()
  if (!pack) {
    throw new Error('未找到内置 skill-creator 资源目录')
  }

  let parsed: RunCommandInput
  try {
    parsed = parseSkillCreatorRunCommandInput(args)
  } catch (error) {
    const fallback = extractFailureInput(args)
    return normalizeFailedRunCommandResult({
      error,
      command: fallback.command,
      args: fallback.args,
      cwd: fallback.cwd,
      shell: fallback.shell
    })
  }

  let guardedInput: RunCommandInput
  try {
    guardedInput = enforceSkillCreatorCommandGuard(parsed, pack.rootPath)
  } catch (error) {
    const enhancedError = formatSkillCreatorGuardError(error, pack)
    return normalizeFailedRunCommandResult({
      error: enhancedError,
      command: parsed.command,
      args: parsed.args,
      cwd: parsed.cwd,
      shell: parsed.shell
    })
  }

  try {
    const result = await deps.runCommand(guardedInput)
    return annotateSkillCreatorResult(result, guardedInput)
  } catch (error) {
    return normalizeFailedRunCommandResult({
      error,
      command: guardedInput.command,
      args: guardedInput.args,
      cwd: guardedInput.cwd,
      shell: guardedInput.shell
    })
  }
}
