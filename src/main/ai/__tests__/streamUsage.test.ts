import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const electronModulePath = require.resolve('electron')
const originalElectronExport = require.cache[electronModulePath]?.exports
const userDataPath = mkdtempSync(join(tmpdir(), 'mulby-ai-stream-usage-'))

function installElectronMock() {
  ;(require.cache as Record<string, NodeJS.Module | undefined>)[electronModulePath] = {
    id: electronModulePath,
    filename: electronModulePath,
    loaded: true,
    exports: {
      app: {
        getPath: () => userDataPath
      }
    },
    children: [],
    paths: [],
    parent: null,
    path: '',
    require,
    isPreloading: false
  } as unknown as NodeJS.Module
}

installElectronMock()

function createSseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    }
  })

  return new Response(body, { status: 200, statusText: 'OK' })
}

type OpenAICompatModule = typeof import('../service/openai-compat-stream')
type UtilsModule = typeof import('../service/utils')
type OpenAICompatContext = import('../service/openai-compat-stream').OpenAICompatContext

let openAICompatModulePromise: Promise<OpenAICompatModule> | null = null
let utilsModulePromise: Promise<UtilsModule> | null = null

async function loadOpenAICompatModule(): Promise<OpenAICompatModule> {
  openAICompatModulePromise ??= import('../service/openai-compat-stream')
  return openAICompatModulePromise
}

async function loadUtilsModule(): Promise<UtilsModule> {
  utilsModulePromise ??= import('../service/utils')
  return utilsModulePromise
}

function createOpenAICompatContext(): OpenAICompatContext {
  return {
    resolveCompatBaseURL: () => 'https://example.test/v1',
    resolveGenerationParams: () => ({}),
    assertNotAborted: (abortSignal?: AbortSignal) => {
      if (abortSignal?.aborted) throw new Error('aborted')
    },
    emitReasoningChunk: () => {},
    emitTextChunk: () => {},
    emitToolCallChunk: () => {},
    emitToolProgressChunk: () => {},
    emitToolResultChunk: () => {},
    emitUsageChunk: () => {},
    trackMcpCall: () => {},
    untrackMcpCall: () => {}
  }
}

describe('AI stream usage', () => {
  it('preserves OpenAI-compatible stream usage from the provider response', async (t) => {
    const { streamOpenAICompatChat } = await loadOpenAICompatModule()
    const originalFetch = globalThis.fetch
    t.after(() => {
      globalThis.fetch = originalFetch
    })

    let requestBody: Record<string, unknown> | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return createSseResponse([
        { choices: [{ delta: { content: 'hello' } }] },
        { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } }
      ])
    }) as typeof fetch

    const result = await streamOpenAICompatChat(createOpenAICompatContext(), {
      model: 'gpt-test',
      providerType: 'openai-compatible',
      messages: [{ role: 'user', content: 'hi' }],
      params: {}
    })

    assert.deepEqual(requestBody?.stream_options, { include_usage: true })
    assert.equal(result.content, 'hello')
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7 })
  })

  it('resolves async AI SDK stream usage before falling back to estimates', async () => {
    const { extractUsageAsync } = await loadUtilsModule()

    const usage = await extractUsageAsync({
      usage: Promise.resolve({ inputTokens: 3, outputTokens: 2 }),
      totalUsage: Promise.resolve({ inputTokens: 31, outputTokens: 13 })
    })

    assert.deepEqual(usage, { inputTokens: 31, outputTokens: 13 })
  })
})

process.on('exit', () => {
  if (originalElectronExport !== undefined && require.cache[electronModulePath]) {
    require.cache[electronModulePath]!.exports = originalElectronExport
  }
  rmSync(userDataPath, { recursive: true, force: true })
})
