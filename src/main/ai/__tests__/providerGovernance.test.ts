import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getProviderCapabilityConstraint, getProviderCapabilityRuleRows, getProviderProfile } from '../../../shared/ai/providerProfiles'
import { buildProviderIdCounts, validateProviderConfig } from '../../../shared/ai/providerValidation'
import { getProviderProtocolCapabilityRule } from '../../../shared/ai/providerCapabilityGovernance'
import { resolveProviderBaseURL } from '../../../shared/ai/providerDefaults'

describe('provider governance', () => {
  it('validation: duplicate provider instance IDs are rejected', () => {
    const providers = [
      { id: 'v3-openai', type: 'openai-compatible', enabled: true, apiKey: 'k1', baseURL: 'https://a.test/v1' },
      { id: 'v3-openai', type: 'openai-compatible', enabled: true, apiKey: 'k2', baseURL: 'https://b.test/v1' }
    ]
    const counts = buildProviderIdCounts(providers as any)
    const result = validateProviderConfig(providers[0] as any, counts)
    assert.equal(result.canTestConnection, false)
    assert.match(result.issues.join(' '), /重复/)
  })

  it('validation: openai-compatible provider is blocked when baseURL missing', () => {
    const provider = {
      id: 'my-compat',
      type: 'openai-compatible',
      enabled: true,
      apiKey: 'abc'
    }
    const result = validateProviderConfig(provider as any, buildProviderIdCounts([provider as any]))
    assert.equal(result.canTestConnection, false)
    assert.match(result.issues.join(' '), /Base URL/)
  })

  it('validation: deepseek allows empty baseURL and uses official default baseURL', () => {
    const provider = {
      id: 'deepseek-main',
      type: 'deepseek',
      enabled: true,
      apiKey: 'abc'
    }
    const result = validateProviderConfig(provider as any, buildProviderIdCounts([provider as any]))
    assert.equal(result.canTestConnection, true)
    assert.deepEqual(result.issues, [])
    assert.equal(resolveProviderBaseURL({ providerType: 'deepseek', baseURL: '' }), 'https://api.deepseek.com')
  })

  it('profiles: anthropic hard-denies embedding and rerank capabilities', () => {
    assert.equal(getProviderCapabilityConstraint('anthropic', 'embedding'), false)
    assert.equal(getProviderCapabilityConstraint('anthropic', 'rerank'), false)
    assert.equal(getProviderCapabilityConstraint('openai', 'embedding'), undefined)
  })

  it('profiles: supportsModelFetch comes from declarative provider profile', () => {
    assert.equal(getProviderProfile('openai').supportsModelFetch, true)
    assert.equal(getProviderProfile('anthropic').supportsModelFetch, false)
    assert.equal(getProviderProfile('ollama').supportsModelFetch, true)
  })

  it('profiles: capability rule rows include blocked reason', () => {
    const rows = getProviderCapabilityRuleRows('anthropic')
    const embedding = rows.find((row) => row.capability === 'embedding')
    assert.equal(embedding?.status, 'blocked')
    assert.equal(embedding?.source, 'profile')
    assert.match(embedding?.reason || '', /embedding/)
  })

  it('protocol capability: models-fetch is profile-blocked for anthropic', () => {
    const provider = {
      id: 'anthropic-1',
      type: 'anthropic',
      enabled: true,
      apiKey: 'k'
    }
    const rule = getProviderProtocolCapabilityRule(
      provider as any,
      'models-fetch',
      buildProviderIdCounts([provider as any])
    )
    assert.equal(rule.enabled, false)
    assert.equal(rule.source, 'profile')
    assert.match(rule.reason, /Anthropic/)
  })

  it('protocol capability: chat is config-blocked when apiKey missing', () => {
    const provider = {
      id: 'v3-openai',
      type: 'openai-compatible',
      enabled: true,
      baseURL: 'https://api.v3.cm/v1'
    }
    const rule = getProviderProtocolCapabilityRule(
      provider as any,
      'chat',
      buildProviderIdCounts([provider as any])
    )
    assert.equal(rule.enabled, false)
    assert.equal(rule.source, 'config')
    assert.match(rule.reason, /API Key/)
  })

  it('protocol capability: chat is model-sourced when provider config is valid', () => {
    const provider = {
      id: 'v3-openai',
      type: 'openai-compatible',
      enabled: true,
      apiKey: 'k',
      baseURL: 'https://api.v3.cm/v1'
    }
    const rule = getProviderProtocolCapabilityRule(
      provider as any,
      'chat',
      buildProviderIdCounts([provider as any])
    )
    assert.equal(rule.enabled, true)
    assert.equal(rule.source, 'model')
  })

  it('validation: ollama allows empty apiKey with default baseURL', () => {
    const provider = {
      id: 'ollama-local',
      type: 'ollama',
      enabled: true
    }
    const result = validateProviderConfig(provider as any, buildProviderIdCounts([provider as any]))
    assert.equal(result.canTestConnection, true)
    assert.deepEqual(result.issues, [])
  })

  it('validation: disabled provider does not block save when apiKey is empty', () => {
    const provider = {
      id: 'moonshot',
      type: 'openai-compatible',
      enabled: false,
      baseURL: 'https://api.moonshot.cn/v1'
    }
    const result = validateProviderConfig(provider as any, buildProviderIdCounts([provider as any]))
    assert.deepEqual(result.issues, [])
    assert.equal(result.canTestConnection, false)
    assert.match(result.testConnectionHint || '', /停用/)
  })
})
