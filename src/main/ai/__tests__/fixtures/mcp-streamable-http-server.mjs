import { createServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

function createMcpServer() {
  const server = new McpServer({
    name: 'mulby-test-streamable-http-server',
    version: '1.0.0'
  })

  server.registerTool(
    'echo_http',
    {
      description: 'Echo input text over streamable http transport',
      inputSchema: {
        text: z.string()
      }
    },
    async ({ text }) => {
      return {
        content: [
          {
            type: 'text',
            text: `echo_http:${text}`
          }
        ]
      }
    }
  )

  return server
}

const host = '127.0.0.1'
const requestedPort = Number(process.env.MCP_TEST_PORT || 0)

const httpServer = createServer(async (req, res) => {
  const url = req.url || ''
  if (!url.startsWith('/mcp')) {
    res.statusCode = 404
    res.end('Not Found')
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.'
      },
      id: null
    }))
    return
  }

  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  })

  try {
    let bodyRaw = ''
    for await (const chunk of req) {
      bodyRaw += String(chunk || '')
    }
    const body = bodyRaw ? JSON.parse(bodyRaw) : undefined

    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (error) {
    console.error('[fixture:http] request error', error)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null
      }))
    }
  } finally {
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
  }
})

httpServer.listen(requestedPort, host, () => {
  const address = httpServer.address()
  const port = typeof address === 'object' && address ? address.port : requestedPort
  console.log(`READY:${port}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => {
    process.exit(0)
  })
})

