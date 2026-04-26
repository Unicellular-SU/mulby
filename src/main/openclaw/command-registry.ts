/**
 * OpenClaw Node 命令注册中心
 *
 * 管理 Node 支持的所有命令（标准 + Mulby 自定义），
 * 提供 caps/commands/permissions 给 connect 握手，
 * 将 invoke 帧路由到对应的 handler。
 */

import type { OpenClawSecurityConfig } from '../../shared/types/settings'

/** 命令处理函数签名 */
export type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>

/** 命令元信息 */
interface CommandMeta {
  name: string
  description: string
  cap: string
  handler: CommandHandler
  /** 该命令是否需要在安全策略中额外检查 */
  requiresExecApproval?: boolean
}

export class CommandRegistry {
  private commands = new Map<string, CommandMeta>()

  /** 注册一个命令 */
  register(meta: CommandMeta): void {
    this.commands.set(meta.name, meta)
  }

  /** 获取命令处理器 */
  getHandler(commandName: string): CommandHandler | undefined {
    return this.commands.get(commandName)?.handler
  }

  /** 检查命令是否需要 exec approval */
  requiresApproval(commandName: string): boolean {
    return this.commands.get(commandName)?.requiresExecApproval === true
  }

  /** 根据安全配置生成 connect 握手所需的 commands 列表 */
  getConnectCommands(security: OpenClawSecurityConfig): string[] {
    const result: string[] = []
    for (const name of this.commands.keys()) {
      // 根据安全配置过滤 Mulby 自定义命令
      if (name.startsWith('mulby.plugin.') && !security.exposePlugins) continue
      if (name.startsWith('mulby.clipboard.') && !security.exposeClipboard) continue
      if (name === 'mulby.search' && !security.exposeSearch) continue
      if (name === 'mulby.launch' && !security.exposeSearch) continue
      result.push(name)
    }
    return result
  }

  /** 生成 connect 握手所需的 caps 列表 */
  getConnectCaps(security: OpenClawSecurityConfig): string[] {
    const caps = new Set<string>()
    for (const [name, meta] of this.commands) {
      if (name.startsWith('mulby.plugin.') && !security.exposePlugins) continue
      if (name.startsWith('mulby.clipboard.') && !security.exposeClipboard) continue
      if (name === 'mulby.search' && !security.exposeSearch) continue
      if (name === 'mulby.launch' && !security.exposeSearch) continue
      caps.add(meta.cap)
    }
    return [...caps]
  }

  /** 生成 connect 握手所需的 permissions */
  getConnectPermissions(security: OpenClawSecurityConfig): Record<string, boolean> {
    const permissions: Record<string, boolean> = {}
    for (const cap of this.getConnectCaps(security)) {
      permissions[cap] = true
    }
    return permissions
  }

  /** 检查命令是否在当前安全配置下可用 */
  isCommandAllowed(commandName: string, security: OpenClawSecurityConfig): boolean {
    if (!this.commands.has(commandName)) return false
    if (commandName.startsWith('mulby.plugin.') && !security.exposePlugins) return false
    if (commandName.startsWith('mulby.clipboard.') && !security.exposeClipboard) return false
    if (commandName === 'mulby.search' && !security.exposeSearch) return false
    if (commandName === 'mulby.launch' && !security.exposeSearch) return false
    return true
  }
}
