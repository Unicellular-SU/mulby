import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getProviderAdapter } from '../providerAdapterCatalog'

describe('providerAdapterCatalog model parsers', () => {
  it('provider feature flags: deepseek requires reasoning replay on tool calls', () => {
    const deepseekAdapter = getProviderAdapter('deepseek')
    const openaiAdapter = getProviderAdapter('openai')
    assert.equal(deepseekAdapter.featureFlags.requiresReasoningReplayOnToolCalls, true)
    assert.equal(openaiAdapter.featureFlags.requiresReasoningReplayOnToolCalls, false)
  })

  it('openai-response adapter: uses responses mode and avoids compat text stream route', () => {
    const adapter = getProviderAdapter('openai-response')
    assert.equal(adapter.languageModelMode, 'responses')
    assert.equal(adapter.preferCompatTextStream, false)
  })

  it('openai parser: accepts OpenAI data[].id format', () => {
    const adapter = getProviderAdapter('openai')
    const parser = adapter.modelDiscovery?.parseModelIds
    assert.ok(parser)
    const ids = parser?.({
      data: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }]
    })
    assert.deepEqual(ids, ['gpt-4o', 'gpt-4.1'])
  })

  it('openai-compatible parser: supports non-standard result.list + model field', () => {
    const adapter = getProviderAdapter('openai-compatible')
    const parser = adapter.modelDiscovery?.parseModelIds
    assert.ok(parser)
    const ids = parser?.({
      result: {
        list: [{ model: 'deepseek-chat' }, { model: 'deepseek-reasoner' }]
      }
    })
    assert.deepEqual(ids, ['deepseek-chat', 'deepseek-reasoner'])
  })

  it('deepseek parser: supports mixed id/model/name fields and dedupes', () => {
    const adapter = getProviderAdapter('deepseek')
    const parser = adapter.modelDiscovery?.parseModelIds
    assert.ok(parser)
    const ids = parser?.({
      result: {
        data: [{ model: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { name: 'deepseek-chat' }]
      }
    })
    assert.deepEqual(ids, ['deepseek-chat', 'deepseek-reasoner'])
  })

  it('openrouter parser: supports slug fallback in provider-specific payload', () => {
    const adapter = getProviderAdapter('openrouter')
    const parser = adapter.modelDiscovery?.parseModelIds
    assert.ok(parser)
    const ids = parser?.({
      data: [
        { slug: 'openai/gpt-4o-mini' },
        { id: 'google/gemini-2.0-flash' }
      ]
    })
    assert.deepEqual(ids, ['openai/gpt-4o-mini', 'google/gemini-2.0-flash'])
  })

  it('ollama parser: supports models[] name field in /api/tags style payload', () => {
    const adapter = getProviderAdapter('ollama')
    const parser = adapter.modelDiscovery?.parseModelIds
    assert.ok(parser)
    const ids = parser?.({
      models: [{ name: 'qwen2.5:latest' }, { name: 'llama3.2' }]
    })
    assert.deepEqual(ids, ['qwen2.5:latest', 'llama3.2'])
  })
})
