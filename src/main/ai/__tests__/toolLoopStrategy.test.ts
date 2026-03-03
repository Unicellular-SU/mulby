import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiProviderConfig } from '../../../shared/types/ai'
import { shouldUseCompatToolLoop } from '../toolLoopStrategy'

describe('toolLoopStrategy', () => {
  it('enables compat tool loop for deepseek provider + reasoner model', () => {
    const enabled = shouldUseCompatToolLoop('deepseek:deepseek-reasoner', {
      id: 'deepseek-main',
      type: 'deepseek',
      enabled: true,
      baseURL: 'https://api.deepseek.com'
    } as AiProviderConfig)
    assert.equal(enabled, true)
  })

  it('disables compat tool loop for standard openai model', () => {
    const enabled = shouldUseCompatToolLoop('openai:gpt-4o-mini', {
      id: 'openai-main',
      type: 'openai',
      enabled: true,
      baseURL: 'https://api.openai.com/v1'
    } as AiProviderConfig)
    assert.equal(enabled, false)
  })

  it('keeps compatibility fallback when provider type is generic but model is deepseek reasoner', () => {
    const enabled = shouldUseCompatToolLoop('v3-openai:deepseek-r1', {
      id: 'v3-openai',
      type: 'openai-compatible',
      enabled: true,
      baseURL: 'https://api.v3.cm/v1'
    } as AiProviderConfig)
    assert.equal(enabled, true)
  })
})
