import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiProviderConfig } from '../../../shared/types/ai'
import {
  getSystemDefaultProviderById,
  getSystemDefaultProviders,
  isSystemDefaultProviderId,
  mergeWithSystemDefaultProviders
} from '../../../shared/ai/systemProviders'

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
    ] as AiProviderConfig[])
    const openaiItems = merged.filter((provider) => String(provider.id) === 'openai')
    assert.equal(openaiItems.length, 1)
  })

  it('identifies system provider IDs', () => {
    assert.equal(isSystemDefaultProviderId('openai'), true)
    assert.equal(isSystemDefaultProviderId('mimo'), true)
    assert.equal(isSystemDefaultProviderId('custom-provider'), false)
  })

  it('uses cherry-studio-like anthropic baseURL defaults on compatible providers', () => {
    const providers = getSystemDefaultProviders()
    const byId = new Map(providers.map((provider) => [String(provider.id), provider]))
    assert.equal(byId.get('deepseek')?.anthropicBaseURL, 'https://api.deepseek.com/anthropic')
    assert.equal(byId.get('zhipu')?.anthropicBaseURL, 'https://open.bigmodel.cn/api/anthropic')
    assert.equal(byId.get('dashscope')?.anthropicBaseURL, 'https://dashscope.aliyuncs.com/apps/anthropic')
    assert.equal(byId.get('mimo')?.anthropicBaseURL, 'https://api.xiaomimimo.com/anthropic')
  })

  it('returns cloned default provider by id', () => {
    const provider = getSystemDefaultProviderById('deepseek')
    assert.equal(provider?.id, 'deepseek')
    assert.equal(provider?.anthropicBaseURL, 'https://api.deepseek.com/anthropic')
    if (provider) {
      provider.baseURL = 'https://modified.example'
    }
    const next = getSystemDefaultProviderById('deepseek')
    assert.equal(next?.baseURL, 'https://api.deepseek.com')
  })
})
