import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'mulby-test-stdio-server',
  version: '1.0.0'
})

server.registerTool(
  'echo',
  {
    description: 'Echo input text',
    inputSchema: {
      text: z.string()
    }
  },
  async ({ text }) => {
    return {
      content: [
        {
          type: 'text',
          text: `echo:${text}`
        }
      ]
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('[fixture:stdio] failed to start', error)
  process.exit(1)
})

