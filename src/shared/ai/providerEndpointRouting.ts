import type { AiModel, AiProviderConfig } from '../types/ai'
import { inferProviderType } from './providerType'
import { getSystemDefaultProviderById } from './systemProviders'

const ENDPOINT_ROUTABLE_PROVIDER_TYPES = new Set([
  'new-api',
  'cherryin',
  'openai-compatible',
  'deepseek',
  'openrouter'
])

function normalizeType(input?: string): string {
  return String(input || '').trim().toLowerCase()
}

export function supportsProviderEndpointRouting(input?: string | Partial<AiProviderConfig>): boolean {
  if (!input) return false
  if (typeof input === 'string') {
    const normalized = normalizeType(input)
    if (ENDPOINT_ROUTABLE_PROVIDER_TYPES.has(normalized)) return true
    return !!String(getSystemDefaultProviderById(normalized)?.anthropicBaseURL || '').trim()
  }
  const type = inferProviderType(input)
  if (ENDPOINT_ROUTABLE_PROVIDER_TYPES.has(type)) return true
  if (String(input.anthropicBaseURL || '').trim()) return true
  return !!String(getSystemDefaultProviderById(String(input.id || '').trim())?.anthropicBaseURL || '').trim()
}

export function isEndpointRoutedProviderType(providerType?: string): boolean {
  return supportsProviderEndpointRouting(providerType)
}

export function resolveEndpointRoutedProviderType(input: {
  providerType?: string
  provider?: Partial<AiProviderConfig>
  model?: AiModel
}): string {
  const providerType = normalizeType(input.providerType) || 'openai-compatible'
  if (!supportsProviderEndpointRouting(input.provider || providerType)) return providerType

  const endpointType = input.model?.endpointType
  switch (endpointType) {
    case 'anthropic':
      return 'anthropic'
    case 'gemini':
      return 'gemini'
    case 'openai-response':
      return 'openai-response'
    case 'openai':
    case 'image-generation':
    case 'jina-rerank':
    default:
      return 'openai-compatible'
  }
}

export function buildEndpointRoutedProviderConfig(
  provider: AiProviderConfig | undefined,
  routedType: string
): AiProviderConfig | undefined {
  if (!provider) return provider
  const normalizedRoutedType = normalizeType(routedType)
  if (!normalizedRoutedType) return provider
  if (!supportsProviderEndpointRouting(provider)) return { ...provider, type: normalizedRoutedType }

  const defaultAnthropicBaseURL = getSystemDefaultProviderById(String(provider.id || '').trim())?.anthropicBaseURL
  let baseURL = provider.baseURL
  if (normalizedRoutedType === 'anthropic') {
    baseURL = provider.anthropicBaseURL || defaultAnthropicBaseURL || provider.baseURL
  }
  return {
    ...provider,
    type: normalizedRoutedType,
    baseURL
  }
}
