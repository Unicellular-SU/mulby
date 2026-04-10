/**
 * Mulby MCP Server HTTP 传输层
 *
 * 使用 Node.js 原生 http 模块实现 Streamable HTTP MCP 传输，
 * 零新增依赖，与项目现有风格保持一致。
 *
 * 功能：
 * - Streamable HTTP 端点 (POST /mcp)
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
 */
export class McpHttpTransport {
  private httpServer: http.Server | null = null
  private transport: StreamableHTTPServerTransport | null = null
  private options: Required<McpHttpTransportOptions>

  constructor(options: McpHttpTransportOptions) {
    this.options = {
      port: options.port,
      token: options.token || '',
      host: options.host || '127.0.0.1'
    }
  }

  /**
   * 启动 HTTP 传输服务并连接到 MulbyMcpServer
   */
  async start(mcpServer: MulbyMcpServer): Promise<void> {
    if (this.httpServer) {
      throw new Error('MCP HTTP Transport 已在运行')
    }

    // 创建 Streamable HTTP Transport
    // enableJsonResponse 启用后，当客户端 Accept: application/json 时返回纯 JSON
    // （否则默认返回 text/event-stream，stdio bridge 等简单代理无法解析 SSE）
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 无状态模式
      enableJsonResponse: true
    })

    // 创建 HTTP Server
    this.httpServer = http.createServer(async (req, res) => {
      await this.handleRequest(req, res)
    })

    // 连接底层 Server 到 Transport
    await mcpServer.connect(this.transport)

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
    if (this.transport) {
      try {
        await this.transport.close()
      } catch (error) {
        console.warn('[MCP-Server] Transport 关闭失败:', error)
      }
      this.transport = null
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve())
        // 强制关闭超时
        setTimeout(() => resolve(), 3000)
      })
      this.httpServer = null
    }

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

      if (!this.transport) {
        this.setCorsHeaders(res)
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'MCP transport not available' }))
        return
      }

      // 设置 CORS 然后委托给 transport 处理
      this.setCorsHeaders(res)
      try {
        await this.transport.handleRequest(req, res)
      } catch (error) {
        console.error('[MCP-Server] 请求处理失败:', error)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
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
    // 安全兆底：空 token 不应到这里（start 时已自动生成），但仍然拒绝
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
  }
}
