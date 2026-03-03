import type { AiModel, AiProviderConfig } from '../../../shared/types/ai'
import { getAiSettings } from '../config'
import { getProviderType } from '../providers'
import { getProviderMethodAdapter } from '../providerMethodAdapters'
import { buildProviderIdCounts } from '../../../shared/ai/providerValidation'
import { getProviderProtocolCapabilityRule } from '../../../shared/ai/providerCapabilityGovernance'
import { getSystemDefaultModels } from '../../../shared/ai/systemModels'
import { getRotatedApiKey } from '../../../shared/ai/apiKeyPool'
import { buildApiKeyScope } from './utils'

export type FetchModelsInput = { providerId: string; baseURL?: string; apiKey?: string }

interface FetchModelsDeps {
  resolveProviderById: (providerId?: string) => AiProviderConfig | undefined
  resolveCompatBaseURL: (explicitBaseURL?: string, providerType?: string) => string
}

function resolveModelDiscoveryBaseURL(
  explicitBaseURL: string | undefined,
  providerType: string | undefined,
  resolveCompatBaseURL: (explicitBaseURL?: string, providerType?: string) => string
): string {
  const baseURL = resolveCompatBaseURL(explicitBaseURL, providerType)
  const normalizedType = String(providerType || '').trim().toLowerCase()
  if (normalizedType === 'ollama') {
    return baseURL.replace(/\/v1$/i, '')
  }
  return baseURL
}

function getSystemFallbackModels(providerId: string): AiModel[] {
  const normalizedProviderId = String(providerId || '').trim()
  if (!normalizedProviderId) return []
  return getSystemDefaultModels().filter((model) => String(model.providerRef || '') === normalizedProviderId)
}

export async function executeFetchModels(
  input: FetchModelsInput,
  deps: FetchModelsDeps
): Promise<{ models: AiModel[]; message?: string }> {
  const configuredProvider = deps.resolveProviderById(input.providerId)
  const providerType = getProviderType(
    configuredProvider || {
      id: input.providerId,
      type: input.providerId,
      enabled: true,
      baseURL: input.baseURL,
      apiKey: input.apiKey
    }
  )
  const mergedProvider: AiProviderConfig = {
    id: String(configuredProvider?.id || input.providerId),
    type: providerType,
    enabled: true,
    apiKey: input.apiKey || configuredProvider?.apiKey,
    baseURL: input.baseURL || configuredProvider?.baseURL,
    headers: configuredProvider?.headers
  }
  const providerIdCounts = buildProviderIdCounts(getAiSettings().providers)
  const fetchCapability = getProviderProtocolCapabilityRule(mergedProvider, 'models-fetch', providerIdCounts)
  console.info('[AI] capability:protocol', {
    stage: 'fetchModels',
    providerId: input.providerId,
    providerType,
    capability: fetchCapability.capability,
    enabled: fetchCapability.enabled,
    source: fetchCapability.source,
    reason: fetchCapability.reason
  })
  if (!fetchCapability.enabled) {
    return { models: [], message: fetchCapability.reason }
  }
  const methodAdapter = getProviderMethodAdapter(providerType)
  const providerId = String(configuredProvider?.id || input.providerId)
  const baseURL = resolveModelDiscoveryBaseURL(
    input.baseURL || configuredProvider?.baseURL,
    providerType,
    deps.resolveCompatBaseURL
  )
  const result = await methodAdapter.fetchModels({
    executeModelDiscovery: async ({ endpoint, parseModelIds }) => {
      const url = `${baseURL.replace(/\/$/, '')}${endpoint}`
      try {
        const apiKey = getRotatedApiKey(
          input.apiKey || configuredProvider?.apiKey,
          buildApiKeyScope({
            providerId,
            providerType,
            baseURL
          })
        )
        console.info('[AI] fetchModels:start', { providerId, providerType, url })
        const res = await fetch(url, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.warn('[AI] fetchModels:fail', { status: res.status, statusText: res.statusText, body })
          return { models: [], message: `拉取失败：${res.status} ${res.statusText}${body ? ` - ${body}` : ''}` }
        }
        const payload = await res.json()
        const modelIds = parseModelIds(payload)
        const models = modelIds.map((id) => ({
          id: `${providerId}:${id}`,
          label: id,
          description: '',
          providerRef: providerId
        }))
        console.info('[AI] fetchModels:success', { count: models.length })
        return { models }
      } catch (err) {
        const message = err instanceof Error ? err.message : '拉取模型失败'
        console.error('[AI] fetchModels:error', { error: message })
        return { models: [], message }
      }
    }
  })
  if (result.models.length > 0) {
    return result
  }

  const fallbackModels = getSystemFallbackModels(providerId)
  if (fallbackModels.length === 0) {
    return result
  }

  console.info('[AI] fetchModels:fallback', { providerId, providerType, count: fallbackModels.length })
  const fallbackMessage = `自动发现失败，已回退到内置模型（${fallbackModels.length} 个）`
  return {
    models: fallbackModels,
    message: result.message ? `${result.message}；${fallbackMessage}` : fallbackMessage
  }
}
