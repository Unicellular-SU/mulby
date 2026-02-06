import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSystemDefaultModels, mergeWithSystemDefaultModels } from '../../../shared/ai/systemModels'

describe('system default models', () => {
  it('contains default models for requested built-in providers', () => {
    const models = getSystemDefaultModels()
    const providers = new Set(models.map((model) => String(model.providerRef || model.id.split(':', 1)[0])))
    const expectedProviders = [
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
    expectedProviders.forEach((providerId) => {
      assert.equal(providers.has(providerId), true, `missing default models for provider: ${providerId}`)
    })
  })

  it('merges defaults without duplicating existing model ids', () => {
    const merged = mergeWithSystemDefaultModels([
      {
        id: 'openai:gpt-5',
        label: 'gpt-5',
        description: 'custom',
        providerRef: 'openai'
      }
    ] as any)
    const matches = merged.filter((model) => model.id === 'openai:gpt-5')
    assert.equal(matches.length, 1)
    assert.equal(matches[0]?.description, 'custom')
  })
})
