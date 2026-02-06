import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildEndpointRoutedProviderConfig, resolveEndpointRoutedProviderType } from '../../../shared/ai/providerEndpointRouting'

describe('provider endpoint routing', () => {
  it('maps new-api model endpoint types to concrete provider types', () => {
    const providerType = resolveEndpointRoutedProviderType({
      providerType: 'new-api',
      model: {
        id: 'new-api:gpt-4o',
        label: 'gpt-4o',
        description: '',
        endpointType: 'openai-response'
      }
    })
    assert.equal(providerType, 'openai-response')
  })

  it('uses provider-specific anthropic/gemini baseURL when routed', () => {
    const config = buildEndpointRoutedProviderConfig(
      {
        id: 'cherryin-main',
        type: 'cherryin',
        enabled: true,
        apiKey: 'k',
        baseURL: 'https://open.cherryin.net/v1',
        anthropicBaseURL: 'https://open.cherryin.net/anthropic/v1',
        geminiBaseURL: 'https://open.cherryin.net/v1beta/models'
      },
      'anthropic'
    )
    assert.equal(config?.type, 'anthropic')
    assert.equal(config?.baseURL, 'https://open.cherryin.net/anthropic/v1')
  })

  it('keeps non endpoint-routed providers unchanged', () => {
    const providerType = resolveEndpointRoutedProviderType({
      providerType: 'openai-compatible',
      model: {
        id: 'v3-openai:gpt-4o-mini',
        label: 'gpt-4o-mini',
        description: '',
        endpointType: 'anthropic'
      }
    })
    assert.equal(providerType, 'openai-compatible')
  })
})
