import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSystemDefaultProviders, isSystemDefaultProviderId, mergeWithSystemDefaultProviders } from '../../../shared/ai/systemProviders'

describe('system default providers', () => {
  it('contains requested built-in providers', () => {
    const providers = getSystemDefaultProviders()
    const ids = new Set(providers.map((provider) => String(provider.id)))
    const expected = [
      'openai',
      'deepseek',
      'gemini',
      'anthropic',
      'silicon',
      'zhipu',
      'dmxapi',
      'moonshot',
      'baichuan',
      'dashscope',
      'doubao',
      'minimax',
      'grok',
      'hunyuan',
      'huggingface',
      'mimo'
    ]
    expected.forEach((id) => assert.equal(ids.has(id), true, `missing system provider: ${id}`))
  })

  it('merges defaults without duplicating existing IDs', () => {
    const merged = mergeWithSystemDefaultProviders([
      {
        id: 'openai',
        type: 'openai-response',
        label: 'OpenAI',
        enabled: true,
        apiKey: 'k',
        baseURL: 'https://api.openai.com/v1'
      }
    ] as any)
    const openaiItems = merged.filter((provider) => String(provider.id) === 'openai')
    assert.equal(openaiItems.length, 1)
  })

  it('identifies system provider IDs', () => {
    assert.equal(isSystemDefaultProviderId('openai'), true)
    assert.equal(isSystemDefaultProviderId('mimo'), true)
    assert.equal(isSystemDefaultProviderId('custom-provider'), false)
  })
})
