import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import type { AiMcpServer, AiSettings } from '../../../shared/types/ai'
import { AiMcpService } from '../mcp/service'

function createInMemoryService(initialServers: AiMcpServer[] = []): AiMcpService {
  let settings: AiSettings = {
    providers: [],
    models: [],
    mcp: {
      servers: [...initialServers],
      defaults: {
        timeoutMs: 5000,
        longRunningMaxMs: 60_000,
        approvalMode: 'always'
      }
    }
  }

  return new AiMcpService({
    getSettings: () => settings,
    updateSettings: (partial) => {
      settings = {
        ...settings,
        ...partial,
        mcp: partial.mcp ?? settings.mcp
      }
      return settings
    },
    getAppVersion: () => 'test'
  })
}

function extractFirstTextFromToolResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  for (const item of content) {
    if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'text') {
      return String((item as { text?: unknown }).text || '')
    }
  }
  return null
}

async function startStreamableHttpFixture(): Promise<{
  baseUrl: string
  stop: () => Promise<void>
}> {
  const testFilePath = fileURLToPath(import.meta.url)
  const fixturesDir = path.join(path.dirname(testFilePath), 'fixtures')
  const script = path.join(fixturesDir, 'mcp-streamable-http-server.mjs')

  const child = spawn(process.execPath, [script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_TEST_PORT: '0'
    }
  })

  let readyPort: number | null = null
  const stderrChunks: string[] = []
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(String(chunk || ''))
  })

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('streamableHttp fixture start timeout'))
    }, 10_000)

    const onStdout = (chunk: Buffer) => {
      const text = String(chunk || '')
      const match = text.match(/READY:(\d+)/)
      if (!match) return
      readyPort = Number(match[1])
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      resolve()
    }

    child.stdout?.on('data', onStdout)

    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.once('exit', (code, signal) => {
      if (readyPort !== null) return
      clearTimeout(timer)
      reject(
        new Error(
          `streamableHttp fixture exited early (code=${String(code)}, signal=${String(signal)}): ${stderrChunks.join('')}`
        )
      )
    })
  })

  await readyPromise

  const stop = async () => {
    if (child.killed) return
    child.kill('SIGTERM')

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  return {
    baseUrl: `http://127.0.0.1:${readyPort}/mcp`,
    stop
  }
}

describe('mcp integration', { concurrency: 1 }, () => {
  it('real stdio MCP service: check/connect/list/call', async () => {
    const testFilePath = fileURLToPath(import.meta.url)
    const fixturesDir = path.join(path.dirname(testFilePath), 'fixtures')
    const stdioFixtureScript = path.join(fixturesDir, 'mcp-stdio-server.mjs')

    const service = createInMemoryService()
    const server = service.upsertServer({
      id: 'stdio-fixture',
      name: 'stdio-fixture',
      type: 'stdio',
      isActive: false,
      command: process.execPath,
      args: [stdioFixtureScript],
      installSource: 'manual',
      isTrusted: true
    })

    const check = await service.checkServerConnectivity(server.id)
    assert.equal(check.ok, true, check.message)

    await service.activateServer(server.id)
    const tools = await service.listTools(server.id)
    assert.equal(tools.some((tool) => tool.name === 'echo'), true)

    const result = await service.callTool({
      serverId: server.id,
      toolName: 'echo',
      args: { text: 'hello' }
    })

    assert.equal(extractFirstTextFromToolResult(result), 'echo:hello')
    await service.cleanup()
  })

  it('real streamableHttp MCP service: check/connect/list/call', async (t) => {
    let fixture: Awaited<ReturnType<typeof startStreamableHttpFixture>> | null = null
    try {
      fixture = await startStreamableHttpFixture()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('EPERM') || message.includes('operation not permitted')) {
        t.skip('environment blocks local TCP listen; skipping streamableHttp integration')
        return
      }
      throw error
    }

    const service = createInMemoryService()

    try {
      const server = service.upsertServer({
        id: 'http-fixture',
        name: 'http-fixture',
        type: 'streamableHttp',
        isActive: false,
        baseUrl: fixture.baseUrl,
        installSource: 'manual',
        isTrusted: true
      })

      const check = await service.checkServerConnectivity(server.id)
      assert.equal(check.ok, true, check.message)

      await service.activateServer(server.id)
      const tools = await service.listTools(server.id)
      assert.equal(tools.some((tool) => tool.name === 'echo_http'), true)

      const result = await service.callTool({
        serverId: server.id,
        toolName: 'echo_http',
        args: { text: 'hello-http' }
      })
      assert.equal(extractFirstTextFromToolResult(result), 'echo_http:hello-http')
    } finally {
      await service.cleanup()
      await fixture.stop()
    }
  })
})
