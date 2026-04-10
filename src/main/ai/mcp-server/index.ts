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
import { join } from 'node:path'
import { MulbyMcpServer, type MulbyMcpServerDeps } from './server'
import { McpHttpTransport } from './transport'

/** MCP Server 运行状态 */
export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error'

/** MCP Server 运行时状态信息 */
export interface McpServerState {
  status: McpServerStatus
  /** 实际运行中的端口（运行时）或配置端口（停止时） */
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
  /** 是否为打包后的应用（用于定位 extraResources） */
  isPackaged: boolean
  /** process.resourcesPath（打包后）或项目根目录（开发时） */
  resourcesPath: string
}

export class McpServerManager {
  private deps: McpServerManagerDeps
  private mcpServer: MulbyMcpServer
  private transport: McpHttpTransport | null = null
  private status: McpServerStatus = 'stopped'
  private lastError: string | undefined
  private startedAt: number | undefined
  /** 实际正在监听的端口（仅运行中有效） */
  private runningPort: number | undefined

  constructor(deps: McpServerManagerDeps) {
    this.deps = deps
    this.mcpServer = new MulbyMcpServer(deps)
  }

  /**
   * 启动 MCP Server
   *
   * 会自动将 enabled 设为 true 并持久化，确保下次启动时恢复。
   */
  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      console.warn('[MCP-Server] 已在运行或正在启动中')
      return
    }

    // 持久化启用标志（解决 [P1]：从 UI 首次启用 MCP Server）
    this.deps.updateMcpServerConfig({ enabled: true })

    const config = this.deps.getMcpServerConfig()
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
      // 记录实际绑定的端口（解决 [P2]：端口不一致问题）
      this.runningPort = config.port

      console.info('[MCP-Server] 启动完成', {
        port: config.port,
        tools: this.mcpServer.getToolCount(),
        address: this.transport.getAddress()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.status = 'error'
      this.lastError = message
      this.runningPort = undefined
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
   *
   * 会自动将 enabled 设为 false 并持久化。
   */
  async stop(): Promise<void> {
    if (this.status === 'stopped') return

    // 持久化禁用标志（解决 [P1]：从 UI 关闭后重启 app 不会自动重启）
    this.deps.updateMcpServerConfig({ enabled: false })

    try {
      if (this.transport) {
        await this.transport.stop()
        this.transport = null
      }
      // 工厂模式下无需 close()，每个 per-request Server 自动清理
      // 只需重建 mcpServer 实例以确保干净状态
      this.mcpServer.destroy()
      this.mcpServer = new MulbyMcpServer(this.deps)
    } catch (error) {
      console.warn('[MCP-Server] 停止时出错:', error)
    }

    this.status = 'stopped'
    this.startedAt = undefined
    this.lastError = undefined
    this.runningPort = undefined
    console.info('[MCP-Server] 已停止')
  }

  /**
   * 重启 MCP Server
   */
  async restart(): Promise<void> {
    // stop() 会将 enabled 设为 false，所以要在 start() 前标记
    const wasRunning = this.status === 'running' || this.status === 'starting'
    await this.stop()
    if (wasRunning) {
      // start() 会自动设置 enabled: true
      await this.start()
    }
  }

  /**
   * 获取运行时状态
   *
   * 运行中时返回实际绑定的端口，停止时返回配置端口。
   */
  getState(): McpServerState {
    const config = this.deps.getMcpServerConfig()
    return {
      status: this.status,
      // 解决 [P2]：运行中返回实际端口，避免 updatePort 后 UI 显示未生效的端口
      port: this.runningPort ?? config.port,
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
   *
   * 运行中时使用实际端口，停止时使用配置端口。
   */
  getClientConfigExample(): {
    claudeDesktop: object
    cursor: object
    cherryStudio: object
    generic: object
  } {
    const config = this.deps.getMcpServerConfig()
    // 使用实际运行端口，避免端口不一致
    const port = this.runningPort ?? config.port
    const url = `http://127.0.0.1:${port}/mcp`

    return {
      claudeDesktop: {
        mcpServers: {
          mulby: {
            type: 'streamable-http',
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
            type: 'streamable-http',
            url,
            headers: {
              Authorization: `Bearer ${config.token}`
            }
          }
        }
      },
      cherryStudio: {
        mcpServers: {
          mulby: {
            type: 'streamable-http',
            url,
            headers: {
              Authorization: `Bearer ${config.token}`
            },
            isActive: true
          }
        }
      },
      generic: {
        name: 'Mulby',
        type: 'streamable-http',
        url,
        token: config.token
      }
    }
  }

  /**
   * 获取当前配置（供 UI 展示）
   */
  getConfig(): McpServerConfig {
    return this.deps.getMcpServerConfig()
  }

  /**
   * 更新端口号（仅修改配置，需要重启 MCP Server 生效）
   *
   * 返回 getState()，让 UI 看到实际运行端口没有变化。
   */
  updatePort(port: number): void {
    this.deps.updateMcpServerConfig({ port })
  }

  /**
   * 获取 stdio bridge 脚本路径（供 UI 显示给用户）
   *
   * - 开发模式：源码目录下的 .cjs 文件
   * - 打包模式：extraResources 中的文件
   */
  getStdioBridgePath(): string {
    if (this.deps.isPackaged) {
      // 打包后：{app.asar}/../resources/mcp/stdio-bridge.cjs
      return join(this.deps.resourcesPath, 'mcp', 'stdio-bridge.cjs')
    }
    // 开发模式：直接使用源码路径
    return join(__dirname, 'mcp-server', 'stdio-bridge.cjs')
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

