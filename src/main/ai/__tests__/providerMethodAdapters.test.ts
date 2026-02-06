import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getProviderMethodAdapter } from '../providerMethodAdapters'

function assistantMessage(content: string) {
  return { role: 'assistant' as const, content }
}

describe('providerMethodAdapters', () => {
  it('call: anthropic + multimodal routes to anthropic call method', async () => {
    const adapter = getProviderMethodAdapter('anthropic')
    const calls: string[] = []
    const result = await adapter.call({
      hasTools: false,
      hasMultimodalContent: true,
      shouldUseCompatToolLoop: false,
      executeAnthropicCall: async () => {
        calls.push('anthropic')
        return assistantMessage('anthropic')
      },
      executeCompatToolLoopCall: async () => {
        calls.push('compat-tool-loop')
        return assistantMessage('compat-tool-loop')
      },
      executeSdkCall: async () => {
        calls.push('sdk')
        return assistantMessage('sdk')
      }
    })
    assert.equal(result.content, 'anthropic')
    assert.deepEqual(calls, ['anthropic'])
  })

  it('call: openai-compatible + tools + compat loop routes to compat tool loop', async () => {
    const adapter = getProviderMethodAdapter('deepseek')
    const calls: string[] = []
    const result = await adapter.call({
      hasTools: true,
      hasMultimodalContent: false,
      shouldUseCompatToolLoop: true,
      executeAnthropicCall: async () => {
        calls.push('anthropic')
        return assistantMessage('anthropic')
      },
      executeCompatToolLoopCall: async () => {
        calls.push('compat-tool-loop')
        return assistantMessage('compat-tool-loop')
      },
      executeSdkCall: async () => {
        calls.push('sdk')
        return assistantMessage('sdk')
      }
    })
    assert.equal(result.content, 'compat-tool-loop')
    assert.deepEqual(calls, ['compat-tool-loop'])
  })

  it('stream: openai-compatible + no tools routes to compat chat stream', async () => {
    const adapter = getProviderMethodAdapter('openai-compatible')
    const calls: string[] = []
    const result = await adapter.stream({
      hasTools: false,
      hasMultimodalContent: false,
      shouldUseCompatToolLoop: false,
      executeAnthropicStream: async () => {
        calls.push('anthropic-stream')
        return assistantMessage('anthropic-stream')
      },
      executeCompatChatStream: async () => {
        calls.push('compat-chat-stream')
        return assistantMessage('compat-chat-stream')
      },
      executeCompatToolLoopStream: async () => {
        calls.push('compat-tool-loop-stream')
        return assistantMessage('compat-tool-loop-stream')
      },
      executeSdkStream: async () => {
        calls.push('sdk-stream')
        return assistantMessage('sdk-stream')
      }
    })
    assert.equal(result.content, 'compat-chat-stream')
    assert.deepEqual(calls, ['compat-chat-stream'])
  })

  it('stream: openai-compatible + tools without compat loop falls back to sdk stream', async () => {
    const adapter = getProviderMethodAdapter('openrouter')
    const calls: string[] = []
    const result = await adapter.stream({
      hasTools: true,
      hasMultimodalContent: false,
      shouldUseCompatToolLoop: false,
      executeAnthropicStream: async () => {
        calls.push('anthropic-stream')
        return assistantMessage('anthropic-stream')
      },
      executeCompatChatStream: async () => {
        calls.push('compat-chat-stream')
        return assistantMessage('compat-chat-stream')
      },
      executeCompatToolLoopStream: async () => {
        calls.push('compat-tool-loop-stream')
        return assistantMessage('compat-tool-loop-stream')
      },
      executeSdkStream: async () => {
        calls.push('sdk-stream')
        return assistantMessage('sdk-stream')
      }
    })
    assert.equal(result.content, 'sdk-stream')
    assert.deepEqual(calls, ['sdk-stream'])
  })

  it('fetchModels: unsupported provider type returns guarded message', async () => {
    const adapter = getProviderMethodAdapter('google')
    let called = false
    const result = await adapter.fetchModels({
      executeOpenAICompatFetch: async () => {
        called = true
        return { models: [] }
      }
    })
    assert.equal(called, false)
    assert.equal(result.models.length, 0)
    assert.match(result.message || '', /暂不支持自动拉取模型/)
  })

  it('fetchModels: openai-compatible provider passes endpoint to fetch executor', async () => {
    const adapter = getProviderMethodAdapter('openai-compatible')
    let endpoint = ''
    const result = await adapter.fetchModels({
      executeOpenAICompatFetch: async (inputEndpoint) => {
        endpoint = inputEndpoint
        return { models: [{ id: 'demo:model-a', label: 'model-a', description: '', providerRef: 'demo' }] }
      }
    })
    assert.equal(endpoint, '/models')
    assert.equal(result.models.length, 1)
    assert.equal(result.models[0]?.id, 'demo:model-a')
  })
})

