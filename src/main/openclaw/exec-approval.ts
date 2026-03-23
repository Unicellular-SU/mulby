/**
 * OpenClaw Exec Approval — 执行审批策略
 *
 * 对应 OpenClaw 的 exec-approvals 机制：
 * - deny: 拒绝所有执行
 * - allowlist: 仅允许白名单中的命令
 * - full: 允许所有命令
 * - ask 模式: 弹窗询问用户
 */

import { dialog, type BrowserWindow } from 'electron'
import type { OpenClawSecurityConfig } from '../../shared/types/settings'

/** 审批决策结果 */
export type ApprovalDecision = 'allow' | 'deny'

/** 审批请求上下文 */
export interface ApprovalContext {
  command: string
  args?: string[]
  rawCommand?: string
  agentId?: string
}

/**
 * 根据安全配置评估命令是否允许执行
 *
 * @returns 'allow' | 'deny' | 'ask'（需要弹窗询问）
 */
export function evaluateExecPolicy(
  context: ApprovalContext,
  security: OpenClawSecurityConfig
): 'allow' | 'deny' | 'ask' {
  // deny 模式：拒绝所有
  if (security.execMode === 'deny') {
    return 'deny'
  }

  // full 模式：允许所有
  if (security.execMode === 'full') {
    if (security.execAsk === 'always') return 'ask'
    return 'allow'
  }

  // allowlist 模式：检查白名单
  // 构建完整命令行用于匹配（如 "git status"、"ls -la"）
  const fullCommand = context.rawCommand
    || (context.args?.length ? `${context.command} ${context.args.join(' ')}` : context.command)

  const isAllowed = security.allowedCommands.some((pattern) => {
    // 精确匹配可执行文件名或完整命令行
    if (pattern === context.command || pattern === fullCommand) return true
    // 通配符匹配（如 "git *"、"ls *"）
    if (pattern.endsWith(' *')) {
      const prefix = pattern.slice(0, -1) // 保留空格："git "
      return fullCommand.startsWith(prefix)
    }
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1)
      return context.command.startsWith(prefix) || fullCommand.startsWith(prefix)
    }
    return false
  })

  if (isAllowed) {
    if (security.execAsk === 'always') return 'ask'
    return 'allow'
  }

  // 白名单未命中
  if (security.execAsk === 'off') return 'deny'
  return 'ask'
}

/**
 * 向用户弹窗询问是否允许执行命令
 */
export async function askUserApproval(
  context: ApprovalContext,
  parentWindow?: BrowserWindow | null
): Promise<ApprovalDecision> {
  const commandDisplay = context.rawCommand || context.command

  const options = {
    type: 'question' as const,
    title: 'OpenClaw 执行审批',
    message: 'OpenClaw Agent 请求执行命令',
    detail: commandDisplay,
    buttons: ['允许', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }

  try {
    const result = parentWindow
      ? await dialog.showMessageBox(parentWindow, options)
      : await dialog.showMessageBox(options)
    return result.response === 0 ? 'allow' : 'deny'
  } catch {
    return 'deny'
  }
}
