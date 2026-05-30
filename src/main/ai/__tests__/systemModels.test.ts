import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiModel } from '../../../shared/types/ai'
import { getSystemDefaultProviders } from '../../../shared/ai/systemProviders'
import { getSystemDefaultModels, mergeWithSystemDefaultModels } from '../../../shared/ai/systemModels'

describe('system default models', () => {
  it('contains default models for representative Cherry Studio providers', () => {
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
      'mimo'
    ]
    expectedProviders.forEach((providerId) => {
      assert.equal(providers.has(providerId), true, `missing default models for provider: ${providerId}`)
    })
  })

  it('does not include models for unknown providers', () => {
    const providerIds = new Set(getSystemDefaultProviders().map((provider) => String(provider.id)))
    const models = getSystemDefaultModels()
    models.forEach((model) => {
      assert.equal(providerIds.has(String(model.providerRef)), true, `unknown providerRef: ${model.providerRef}`)
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
    ] as AiModel[])
    const matches = merged.filter((model) => model.id === 'openai:gpt-5')
    assert.equal(matches.length, 1)
    assert.equal(matches[0]?.description, 'custom')
  })
})
