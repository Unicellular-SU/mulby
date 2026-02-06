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

  it('uses provider-specific anthropic baseURL when routed', () => {
    const config = buildEndpointRoutedProviderConfig(
      {
        id: 'cherryin-main',
        type: 'cherryin',
        enabled: true,
        apiKey: 'k',
        baseURL: 'https://open.cherryin.net/v1',
        anthropicBaseURL: 'https://open.cherryin.net/anthropic/v1'
      },
      'anthropic'
    )
    assert.equal(config?.type, 'anthropic')
    assert.equal(config?.baseURL, 'https://open.cherryin.net/anthropic/v1')
  })

  it('routes openai-compatible providers when model endpoint type is specified', () => {
    const providerType = resolveEndpointRoutedProviderType({
      providerType: 'openai-compatible',
      model: {
        id: 'v3-openai:gpt-4o-mini',
        label: 'gpt-4o-mini',
        description: '',
        endpointType: 'anthropic'
      }
    })
    assert.equal(providerType, 'anthropic')
  })

  it('keeps provider type unchanged when endpoint type is not specified', () => {
    const providerType = resolveEndpointRoutedProviderType({
      providerType: 'openai-compatible',
      model: {
        id: 'v3-openai:gpt-4o-mini',
        label: 'gpt-4o-mini',
        description: ''
      }
    })
    assert.equal(providerType, 'openai-compatible')
  })

  it('supports endpoint routing via system default provider id even when provider type is openai', () => {
    const providerType = resolveEndpointRoutedProviderType({
      providerType: 'openai',
      provider: {
        id: 'minimax',
        type: 'openai',
        enabled: true,
        baseURL: 'https://api.minimaxi.com/v1'
      },
      model: {
        id: 'minimax:text-model',
        label: 'text-model',
        description: '',
        endpointType: 'anthropic'
      }
    })
    assert.equal(providerType, 'anthropic')

    const config = buildEndpointRoutedProviderConfig(
      {
        id: 'minimax',
        type: 'openai',
        enabled: true,
        apiKey: 'k',
        baseURL: 'https://api.minimaxi.com/v1'
      },
      'anthropic'
    )
    assert.equal(config?.baseURL, 'https://api.minimaxi.com/anthropic')
  })
})
