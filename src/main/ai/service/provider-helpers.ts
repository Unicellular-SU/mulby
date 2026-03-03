import type { AiModel, AiProviderConfig } from '../../../shared/types/ai'
import { buildEndpointRoutedProviderConfig, resolveEndpointRoutedProviderType } from '../../../shared/ai/providerEndpointRouting'
import { getAiSettings } from '../config'
import { resolveModelId } from '../models'
import { getProviderType } from '../providers'

export function resolveProviderById(providerId?: string): AiProviderConfig | undefined {
  if (!providerId) return undefined
  const settings = getAiSettings()
  const matches = settings.providers.filter((provider) => String(provider.id) === String(providerId))
  if (matches.length === 1) return matches[0]
  if (matches.length > 0) return matches[0]
  const byLabel = settings.providers.find((provider) => (provider.label || provider.id) === providerId)
  if (byLabel) return byLabel
  const byType = settings.providers.find((provider) => getProviderType(provider) === String(providerId))
  return byType
}

export function resolveEffectiveModelId(modelId?: string): string | undefined {
  if (modelId) return modelId
  try {
    return resolveModelId().model.id
  } catch {
    return undefined
  }
}

export function resolveModelConfig(modelId?: string): AiModel | undefined {
  const resolvedModelId = resolveEffectiveModelId(modelId)
  if (!resolvedModelId) return undefined
  const settings = getAiSettings()
  return settings.models?.find((model) => model.id === resolvedModelId)
}

export function resolveProviderConfig(input: {
  modelId?: string
  providerIdOverride?: string
}): AiProviderConfig | undefined {
  const settings = getAiSettings()
  if (!settings.providers || settings.providers.length === 0) return undefined
  const modelConfig = resolveModelConfig(input.modelId)
  if (modelConfig?.providerRef) {
    const byRef = settings.providers.find((provider) => String(provider.id) === String(modelConfig.providerRef))
    if (byRef) return byRef
  }
  if (modelConfig?.providerLabel) {
    const match = settings.providers.find((provider) => (provider.label || provider.id) === modelConfig.providerLabel)
    if (match) return match
  }
  const providerId = input.providerIdOverride || (input.modelId?.includes(':') ? input.modelId.split(':', 2)[0] : undefined)
  if (providerId) {
    const matches = settings.providers.filter((provider) =>
      String(provider.id) === String(providerId) || getProviderType(provider) === String(providerId)
    )
    if (matches.length === 1) return matches[0]
    if (matches.length > 1 && input.modelId) {
      const byDefaultModel = matches.find((provider) => provider.defaultModel === input.modelId)
      if (byDefaultModel) return byDefaultModel
    }
    if (matches.length > 0) return matches[0]
  }
  return settings.providers[0]
}

export function resolveExecutionProviderContext(input: {
  modelId?: string
  providerIdOverride?: string
}): { providerType: string; providerConfig?: AiProviderConfig } {
  const resolved = resolveModelId(input.modelId)
  const providerConfig = resolveProviderConfig({
    modelId: input.modelId,
    providerIdOverride: input.providerIdOverride || resolved.providerId
  })
  const declaredProviderType = getProviderType(providerConfig) || input.providerIdOverride || resolved.providerId
  const modelConfig = resolveModelConfig(input.modelId)
  const providerType = resolveEndpointRoutedProviderType({
    providerType: declaredProviderType,
    provider: providerConfig,
    model: modelConfig
  })
  return {
    providerType,
    providerConfig: buildEndpointRoutedProviderConfig(providerConfig, providerType)
  }
}
