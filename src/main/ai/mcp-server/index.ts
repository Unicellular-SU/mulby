/**
 * Mulby MCP Server 模块入口
 *
 * 整合 MulbyMcpServer + McpHttpTransport，提供完整的生命周期管理：
 * - start / stop / restart
 * - 状态查询
 * - 设置变更响应
 * - 插件工具变更动态同步
 */

import { randomUUID } from 'node:crypto'
import { MulbyMcpServer, type MulbyMcpServerDeps } from './server'
import { McpHttpTransport } from './transport'

/** MCP Server 运行状态 */
export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error'

/** MCP Server 运行时状态信息 */
export interface McpServerState {
  status: McpServerStatus
  port: number
  address?: string
  toolCount: number
  error?: string
  startedAt?: number
}

/** MCP Server 配置 */
export interface McpServerConfig {
  enabled: boolean
  port: number
  token: string
}

/** MCP Server 管理器依赖 */
export interface McpServerManagerDeps extends MulbyMcpServerDeps {
  /** 获取 MCP Server 配置 */
  getMcpServerConfig: () => McpServerConfig
  /** 更新 MCP Server 配置 */
  updateMcpServerConfig: (partial: Partial<McpServerConfig>) => McpServerConfig
}

export class McpServerManager {
  private deps: McpServerManagerDeps
  private mcpServer: MulbyMcpServer
  private transport: McpHttpTransport | null = null
  private status: McpServerStatus = 'stopped'
  private lastError: string | undefined
  private startedAt: number | undefined

  constructor(deps: McpServerManagerDeps) {
    this.deps = deps
    this.mcpServer = new MulbyMcpServer(deps)
  }

  /**
   * 启动 MCP Server
   */
  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      console.warn('[MCP-Server] 已在运行或正在启动中')
      return
    }

    const config = this.deps.getMcpServerConfig()
    if (!config.enabled) {
      console.info('[MCP-Server] 未启用，跳过启动')
      return
    }

    this.status = 'starting'
    this.lastError = undefined

    try {
      // 安全检查：token 为空时自动生成，不允许无认证启动
      let token = config.token
      if (!token) {
        token = randomUUID()
        this.deps.updateMcpServerConfig({ token })
        console.info('[MCP-Server] Token 为空，已自动生成')
      }

      // 1. 同步工具
      this.mcpServer.syncTools()

      // 2. 创建并启动 HTTP 传输
      this.transport = new McpHttpTransport({
        port: config.port,
        token,
        host: '127.0.0.1'
      })

      await this.transport.start(this.mcpServer)

      this.status = 'running'
      this.startedAt = Date.now()

      console.info('[MCP-Server] 启动完成', {
        port: config.port,
        tools: this.mcpServer.getToolCount(),
        address: this.transport.getAddress()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.status = 'error'
      this.lastError = message
      console.error('[MCP-Server] 启动失败:', message)

      // 清理
      if (this.transport) {
        await this.transport.stop().catch(() => {})
        this.transport = null
      }

      throw error
    }
  }

  /**
   * 停止 MCP Server
   */
  async stop(): Promise<void> {
    if (this.status === 'stopped') return

    try {
      if (this.transport) {
        await this.transport.stop()
        this.transport = null
      }
      await this.mcpServer.close()
      this.mcpServer.destroy()
      // 重新创建 server 实例（transport 和 server 的连接关系需要重建）
      this.mcpServer = new MulbyMcpServer(this.deps)
    } catch (error) {
      console.warn('[MCP-Server] 停止时出错:', error)
    }

    this.status = 'stopped'
    this.startedAt = undefined
    this.lastError = undefined
    console.info('[MCP-Server] 已停止')
  }

  /**
   * 重启 MCP Server
   */
  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  /**
   * 获取运行时状态
   */
  getState(): McpServerState {
    const config = this.deps.getMcpServerConfig()
    return {
      status: this.status,
      port: config.port,
      address: this.transport?.getAddress(),
      toolCount: this.mcpServer.getToolCount(),
      error: this.lastError,
      startedAt: this.startedAt
    }
  }

  /**
   * 获取已注册的工具列表
   */
  getTools(): Array<{
    mcpToolName: string
    pluginId: string
    toolName: string
    pluginName: string
  }> {
    return this.mcpServer.getRegisteredTools()
  }

  /**
   * 刷新工具列表（当 PluginToolRegistry 变更时调用）
   */
  refreshTools(): void {
    if (this.status !== 'running') return
    this.mcpServer.syncTools()
  }

  /**
   * 重新生成认证 Token
   */
  regenerateToken(): string {
    const newToken = randomUUID()
    this.deps.updateMcpServerConfig({ token: newToken })

    // 如果正在运行，更新 transport 的 token
    if (this.transport) {
      this.transport.updateToken(newToken)
    }

    return newToken
  }

  /**
   * 获取客户端配置示例
   */
  getClientConfigExample(): {
    claudeDesktop: object
    cursor: object
    generic: object
  } {
    const config = this.deps.getMcpServerConfig()
    const url = `http://127.0.0.1:${config.port}/mcp`

    return {
      claudeDesktop: {
        mcpServers: {
          mulby: {
            transport: 'streamable-http',
            url,
            headers: {
              Authorization: `Bearer ${config.token}`
            }
          }
        }
      },
      cursor: {
        mcpServers: {
          mulby: {
            url,
            headers: {
              Authorization: `Bearer ${config.token}`
            }
          }
        }
      },
      generic: {
        name: 'Mulby',
        transport: 'streamable-http',
        url,
        token: config.token
      }
    }
  }

  /**
   * 应用退出时清理
   */
  async cleanup(): Promise<void> {
    await this.stop()
  }
}

/**
 * 创建 MCP Server Manager 实例
 */
export function createMcpServerManager(deps: McpServerManagerDeps): McpServerManager {
  return new McpServerManager(deps)
}

// 重新导出类型
export type { MulbyMcpServerDeps } from './server'
