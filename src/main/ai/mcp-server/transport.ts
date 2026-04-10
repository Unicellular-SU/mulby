/**
 * Mulby MCP Server HTTP 传输层
 *
 * 使用 Node.js 原生 http 模块实现 Streamable HTTP MCP 传输，
 * 零新增依赖，与项目现有风格保持一致。
 *
 * 架构：每请求 Transport + Server 实例（无状态模式）
 * - HTTP Server 常驻运行
 * - 每个 /mcp 请求创建新的 StreamableHTTPServerTransport + MCP Server 对
 * - 请求结束后自动释放，符合 MCP SDK 无状态模式要求
 * - 支持多客户端并发连接（Cherry Studio + Cursor 同时使用等场景）
 *
 * 其他功能：
 * - Bearer Token 认证
 * - CORS 处理
 * - 健康检查端点 (GET /health)
 */

import http from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { MulbyMcpServer } from './server'

export interface McpHttpTransportOptions {
  /** 监听端口 */
  port: number
  /** Bearer Token（为空则不做认证） */
  token?: string
  /** 监听地址（默认 127.0.0.1，仅本机访问） */
  host?: string
}

/**
 * 基于原生 http 模块的 MCP HTTP 传输服务
 *
 * 采用无状态模式：每个请求创建独立的 Transport + Server 对，
 * 确保多客户端、断线重连等场景下的正确行为。
 */
export class McpHttpTransport {
  private httpServer: http.Server | null = null
  private mcpServer: MulbyMcpServer | null = null
  private options: Required<McpHttpTransportOptions>

  constructor(options: McpHttpTransportOptions) {
    this.options = {
      port: options.port,
      token: options.token || '',
      host: options.host || '127.0.0.1'
    }
  }

  /**
   * 启动 HTTP 传输服务
   *
   * HTTP Server 常驻监听，MulbyMcpServer 引用保留用于每请求创建 Server 实例。
   */
  async start(mcpServer: MulbyMcpServer): Promise<void> {
    if (this.httpServer) {
      throw new Error('MCP HTTP Transport 已在运行')
    }

    this.mcpServer = mcpServer

    // 创建 HTTP Server（常驻）
    this.httpServer = http.createServer(async (req, res) => {
      await this.handleRequest(req, res)
    })

    // 启动 HTTP Server
    await new Promise<void>((resolve, reject) => {
      const server = this.httpServer!
      server.once('error', (error) => {
        console.error('[MCP-Server] HTTP 启动失败:', error)
        reject(error)
      })
      server.listen(this.options.port, this.options.host, () => {
        console.info(`[MCP-Server] HTTP 传输已启动 http://${this.options.host}:${this.options.port}/mcp`)
        resolve()
      })
    })
  }

  /**
   * 停止 HTTP 传输服务
   */
  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve())
        // 强制关闭超时
        setTimeout(() => resolve(), 3000)
      })
      this.httpServer = null
    }

    this.mcpServer = null
    console.info('[MCP-Server] HTTP 传输已停止')
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening
  }

  /**
   * 获取传输层地址
   */
  getAddress(): string {
    return `http://${this.options.host}:${this.options.port}/mcp`
  }

  /**
   * 更新认证 Token
   */
  updateToken(token: string): void {
    this.options.token = token
  }

  /**
   * HTTP 请求处理
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '/'
    const method = (req.method || 'GET').toUpperCase()

    // CORS 预检请求
    if (method === 'OPTIONS') {
      this.setCorsHeaders(res)
      res.writeHead(204)
      res.end()
      return
    }

    // 健康检查
    if (url === '/health' && method === 'GET') {
      this.setCorsHeaders(res)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', service: 'mulby-mcp-server' }))
      return
    }

    // MCP 端点
    if (url === '/mcp' || url.startsWith('/mcp?')) {
      // Token 认证
      if (!this.authenticateRequest(req)) {
        this.setCorsHeaders(res)
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing Bearer token' }))
        return
      }

      if (!this.mcpServer) {
        this.setCorsHeaders(res)
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'MCP server not available' }))
        return
      }

      // 设置 CORS 头
      this.setCorsHeaders(res)

      // 每请求创建新的 Transport + Server 对（无状态模式）
      // 这是 MCP SDK 的推荐做法：确保每个请求获得全新 transport，
      // 避免会话绑定导致后续客户端无法连接的问题
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined // 无状态模式
      })

      let server: { close(): Promise<void> } | null = null
      try {
        server = await this.mcpServer.createConnectedServer(transport)
        await transport.handleRequest(req, res)
      } catch (error) {
        console.error('[MCP-Server] 请求处理失败:', error)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      } finally {
        // 请求处理完成后，清理 transport 和 server
        // 注意：对于 SSE 流式响应，res.on('close') 保证在流结束后触发
        res.on('close', () => {
          void transport.close().catch(() => {})
          void server?.close().catch(() => {})
        })
      }
      return
    }

    // 404
    this.setCorsHeaders(res)
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }

  /**
   * Bearer Token 认证
   */
  private authenticateRequest(req: http.IncomingMessage): boolean {
    // 安全兜底：空 token 不应到这里（start 时已自动生成），但仍然拒绝
    if (!this.options.token) return false

    const auth = req.headers.authorization || ''
    if (!auth.startsWith('Bearer ')) return false

    const token = auth.slice(7).trim()
    return token === this.options.token
  }

  /**
   * 设置 CORS 响应头
   */
  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
  }
}
