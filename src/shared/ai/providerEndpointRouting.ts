import type { AiModel, AiProviderConfig } from '../types/ai'
import { inferProviderType } from './providerType'

export function isEndpointRoutedProviderType(providerType?: string): boolean {
  const type = String(providerType || '').trim().toLowerCase()
  return type === 'new-api' || type === 'cherryin'
}

export function resolveEndpointRoutedProviderType(input: {
  providerType?: string
  model?: AiModel
}): string {
  const providerType = String(input.providerType || '').trim().toLowerCase()
  if (!isEndpointRoutedProviderType(providerType)) return providerType || 'openai-compatible'

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
  const normalizedRoutedType = String(routedType || '').trim().toLowerCase()
  if (!normalizedRoutedType) return provider
  const sourceType = inferProviderType(provider)
  if (!isEndpointRoutedProviderType(sourceType)) return { ...provider, type: normalizedRoutedType }

  let baseURL = provider.baseURL
  if (normalizedRoutedType === 'anthropic' && provider.anthropicBaseURL) {
    baseURL = provider.anthropicBaseURL
  } else if (normalizedRoutedType === 'gemini' && provider.geminiBaseURL) {
    baseURL = provider.geminiBaseURL
  }
  return {
    ...provider,
    type: normalizedRoutedType,
    baseURL
  }
}
