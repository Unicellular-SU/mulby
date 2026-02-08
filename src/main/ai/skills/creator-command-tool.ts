import { basename, extname, isAbsolute, resolve, sep } from 'node:path'
import type { RunCommandInput, RunCommandResult } from '../../services/command-runner'
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

  const parsed = parseSkillCreatorRunCommandInput(args)
  const guardedInput = enforceSkillCreatorCommandGuard(parsed, pack.rootPath)
  try {
    return await deps.runCommand(guardedInput)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      command: guardedInput.command,
      args: guardedInput.args || [],
      cwd: guardedInput.cwd,
      shell: guardedInput.shell === true,
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
}
