import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getProviderPreset } from '../../../shared/ai/providerPresets'
import { getProviderDefaultBaseURL } from '../../../shared/ai/providerDefaults'

describe('provider presets', () => {
  it('provides cherry-style official default baseURLs for built-in providers', () => {
    assert.equal(getProviderPreset('openai').defaultBaseURL, 'https://api.openai.com/v1')
    assert.equal(getProviderPreset('openai-response').defaultBaseURL, 'https://api.openai.com/v1')
    assert.equal(getProviderPreset('deepseek').defaultBaseURL, 'https://api.deepseek.com')
    assert.equal(getProviderPreset('openrouter').defaultBaseURL, 'https://openrouter.ai/api/v1')
    assert.equal(getProviderPreset('anthropic').defaultBaseURL, 'https://api.anthropic.com/v1')
    assert.equal(getProviderPreset('gemini').defaultBaseURL, 'https://generativelanguage.googleapis.com/v1beta')
    assert.equal(getProviderPreset('new-api').defaultBaseURL, 'http://localhost:3000/v1')
    assert.equal(getProviderPreset('cherryin').defaultBaseURL, 'https://open.cherryin.net/v1')
    assert.equal(getProviderPreset('ollama').defaultBaseURL, 'http://localhost:11434')
  })

  it('keeps openai-compatible and azure-openai without forced default baseURL', () => {
    assert.equal(getProviderPreset('openai-compatible').defaultBaseURL, undefined)
    assert.equal(getProviderPreset('azure-openai').defaultBaseURL, undefined)
    assert.equal(getProviderDefaultBaseURL('openai-compatible'), undefined)
  })
})
