#!/usr/bin/env node
/**
 * Mulby MCP stdio Bridge
 *
 * 为 Claude Desktop 等需要 stdio 传输的客户端提供桥接支持。
 * 本脚本作为独立进程运行，通过 stdin/stdout 接收 MCP 消息，
 * 转发到 Mulby 的 HTTP MCP 端点。
 *
 * 使用方式（Claude Desktop claude_desktop_config.json）：
 * {
 *   "mcpServers": {
 *     "mulby": {
 *       "command": "node",
 *       "args": ["/path/to/mulby/src/main/ai/mcp-server/stdio-bridge.cjs"],
 *       "env": {
 *         "MULBY_MCP_URL": "http://127.0.0.1:18790/mcp",
 *         "MULBY_MCP_TOKEN": "<your-token>"
 *       }
 *     }
 *   }
 * }
 *
 * 环境变量：
 * - MULBY_MCP_URL:   Mulby MCP Server HTTP 端点（默认 http://127.0.0.1:18790/mcp）
 * - MULBY_MCP_TOKEN:  Bearer Token（必须与 Mulby 设置中的一致）
 * - MULBY_MCP_PORT:   端口号快捷设置（优先级低于 MULBY_MCP_URL）
 */

const http = require('http')
const https = require('https')

const DEFAULT_URL = 'http://127.0.0.1:18790/mcp'

function getMcpUrl() {
  if (process.env.MULBY_MCP_URL) return process.env.MULBY_MCP_URL
  if (process.env.MULBY_MCP_PORT) return `http://127.0.0.1:${process.env.MULBY_MCP_PORT}/mcp`
  return DEFAULT_URL
}

const MCP_URL = getMcpUrl()
const MCP_TOKEN = process.env.MULBY_MCP_TOKEN || ''

// 将所有日志输出到 stderr（避免污染 JSON-RPC 的 stdout 流）
function log(...args) {
  process.stderr.write(`[mulby-mcp-stdio] ${args.join(' ')}\n`)
}

log('starting', JSON.stringify({ url: MCP_URL, hasToken: !!MCP_TOKEN }))

/**
 * 将请求转发到 Mulby HTTP MCP 端点
 *
 * 关键：发送 Accept: application/json header，
 * 使 Streamable HTTP transport 返回纯 JSON 而非 SSE（text/event-stream）。
 * stdio 协议需要的是换行分隔的 JSON-RPC 消息，不是 SSE 事件流。
 */
function forwardRequest(jsonBody) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(MCP_URL)
    const requester = parsed.protocol === 'https:' ? https : http

    const headers = {
      'Content-Type': 'application/json',
      // 关键：请求 JSON 响应而非 SSE，确保 stdio 协议兼容
      'Accept': 'application/json'
    }
    if (MCP_TOKEN) {
      headers['Authorization'] = `Bearer ${MCP_TOKEN}`
    }

    const req = requester.request(
      {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers,
        timeout: 300_000 // 5 分钟超时（工具调用可能较慢）
      },
      (res) => {
        const contentType = res.headers['content-type'] || ''
        let data = ''

        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // 兜底处理：如果服务端仍返回了 SSE 格式，解析 data 字段
            if (contentType.includes('text/event-stream')) {
              const jsonMessages = parseSSE(data)
              resolve(jsonMessages)
            } else {
              resolve(data)
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          }
        })
      }
    )

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })

    req.write(jsonBody)
    req.end()
  })
}

/**
 * 解析 SSE 格式的响应，提取 data 字段中的 JSON-RPC 消息
 *
 * SSE 格式示例：
 * event: message
 * data: {"jsonrpc":"2.0","id":1,"result":{...}}
 *
 * id: ...
 * event: message
 * data: {"jsonrpc":"2.0","id":2,"result":{...}}
 */
function parseSSE(sseText) {
  const lines = sseText.split('\n')
  const messages = []

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6).trim()
      if (jsonStr) {
        messages.push(jsonStr)
      }
    }
  }

  return messages.join('\n')
}

// 读取 stdin（按行处理 JSON-RPC 消息）
let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk

  // MCP 协议使用换行分隔 JSON-RPC 消息
  let newlineIndex
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim()
    buffer = buffer.slice(newlineIndex + 1)

    if (!line) continue

    // 转发到 HTTP 端点
    forwardRequest(line)
      .then((response) => {
        if (!response) return

        // 将响应写回 stdout（可能是单条 JSON 或多条被 \n 分隔的 JSON）
        const text = String(response).trim()
        if (text) {
          process.stdout.write(text)
          if (!text.endsWith('\n')) {
            process.stdout.write('\n')
          }
        }
      })
      .catch((error) => {
        log('error forwarding request:', error.message)

        // 尝试解析原始请求以获取 id
        try {
          const parsed = JSON.parse(line)
          if (parsed.id !== undefined) {
            const errorResponse = JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              error: {
                code: -32603,
                message: `Mulby MCP Server unreachable: ${error.message}`
              }
            })
            process.stdout.write(errorResponse + '\n')
          }
        } catch {
          // 无法解析，忽略
        }
      })
  }
})

process.stdin.on('end', () => {
  log('stdin closed, exiting')
  process.exit(0)
})

process.on('SIGINT', () => {
  log('received SIGINT, exiting')
  process.exit(0)
})

process.on('SIGTERM', () => {
  log('received SIGTERM, exiting')
  process.exit(0)
})
