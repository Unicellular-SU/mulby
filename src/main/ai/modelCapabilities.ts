import type { AiProviderConfig, AiModel, AiModelCapability, AiModelType } from '../../shared/types/ai'
import { resolveModelId } from './models'
import { getAiSettings } from './config'
import { inferCapability } from './capabilityInference'
import { getProviderAdapter } from './providerAdapterCatalog'
import { getProviderCapabilityConstraint } from '../../shared/ai/providerProfiles'
import { inferProviderType } from '../../shared/ai/providerType'

function modelName(modelId?: string): string {
  if (!modelId) return ''
  const resolved = resolveModelId(modelId)
  return resolved.modelId.toLowerCase()
}

function getModelCapabilities(modelId?: string): AiModelCapability[] | undefined {
  if (!modelId) return undefined
  const settings = getAiSettings()
  return settings.models?.find((model) => model.id === modelId)?.capabilities
}

function resolveCapabilityOverride(modelId: string | undefined, capability: AiModelType): boolean | undefined {
  const caps = getModelCapabilities(modelId)
  if (!caps || caps.length === 0) return undefined
  const match = caps.find((item) => item.type === capability)
  if (!match) return undefined
  if (match.isUserSelected === false) return false
  if (match.isUserSelected === true) return true
  return undefined
}

function getModelConfig(modelId?: string): AiModel | undefined {
  if (!modelId) return undefined
  const settings = getAiSettings()
  return settings.models?.find((model) => model.id === modelId)
}

function resolveProviderConfig(modelId?: string, explicitProvider?: AiProviderConfig): AiProviderConfig | undefined {
  if (explicitProvider) return explicitProvider
  if (!modelId) return undefined
  const settings = getAiSettings()
  const modelConfig = settings.models?.find((model) => model.id === modelId)
  if (modelConfig?.providerRef) {
    const byRef = settings.providers.find((provider) => String(provider.id) === String(modelConfig.providerRef))
    if (byRef) return byRef
  }
  if (modelConfig?.providerLabel) {
    const byLabel = settings.providers.find((provider) => (provider.label || provider.id) === modelConfig.providerLabel)
    if (byLabel) return byLabel
  }
  const providerToken = modelId.includes(':') ? modelId.split(':', 2)[0] : modelId
  const byId = settings.providers.find((provider) => String(provider.id) === providerToken)
  if (byId) return byId
  const byType = settings.providers.find((provider) => inferProviderType(provider) === providerToken)
  if (byType) return byType
  return settings.providers[0]
}

function getDefaultCapability(type: AiModelType): boolean {
  switch (type) {
    case 'function_calling':
    case 'reasoning':
      return true
    default:
      return false
  }
}

function hasCapability(modelId: string | undefined, type: AiModelType, provider?: AiProviderConfig): boolean {
  const resolvedProvider = resolveProviderConfig(modelId, provider)
  const providerConstraint = getProviderCapabilityConstraint(resolvedProvider, type)
  if (providerConstraint === false) return false

  const modelConfig = getModelConfig(modelId) || (modelId ? { id: modelId, label: modelId, description: '' } : undefined)
  let modelCapability: boolean | undefined
  if (modelConfig) {
    const inferred = inferCapability(type, modelConfig, resolvedProvider)
    if (inferred !== undefined) modelCapability = inferred
  }
  const mergedBase = modelCapability ?? getDefaultCapability(type)
  const override = resolveCapabilityOverride(modelId, type)
  if (override !== undefined) return override
  return mergedBase
}

export function supportsPdfInput(modelId?: string, provider?: AiProviderConfig): boolean {
  const providerId = getProviderAdapter(provider).type
  const name = modelName(modelId)
  if (name.includes('qwen-long') || name.includes('qwen-doc')) return true
  return ['openai', 'openai-response', 'anthropic', 'gemini'].includes(providerId)
}

export function supportsImageInput(modelId?: string, provider?: AiProviderConfig): boolean {
  return hasCapability(modelId, 'vision', provider)
}

export function supportsLargeFileUpload(modelId?: string, provider?: AiProviderConfig): boolean {
  const providerId = getProviderAdapter(provider).type
  const name = modelName(modelId)
  if (name.includes('qwen-long') || name.includes('qwen-doc')) return true
  return ['openai', 'openai-response', 'gemini'].includes(providerId)
}

export function supportsFunctionCalling(modelId?: string): boolean {
  return hasCapability(modelId, 'function_calling')
}

export function supportsReasoning(modelId?: string): boolean {
  return hasCapability(modelId, 'reasoning')
}

export function supportsWebSearch(modelId?: string): boolean {
  return hasCapability(modelId, 'web_search')
}

export function supportsEmbedding(modelId?: string): boolean {
  return hasCapability(modelId, 'embedding')
}

export function supportsRerank(modelId?: string): boolean {
  return hasCapability(modelId, 'rerank')
}

export function getEffectiveCapabilities(modelId?: string, provider?: AiProviderConfig): AiModelCapability[] {
  const types: AiModelType[] = ['vision', 'reasoning', 'function_calling', 'web_search', 'embedding', 'rerank']
  return types
    .filter((type) => hasCapability(modelId, type, provider))
    .map((type) => ({ type }))
}

export function getFileSizeLimit(_modelId: string | undefined, provider: AiProviderConfig | undefined, mimeType: string | undefined): number {
  const providerId = getProviderAdapter(provider).type
  if (providerId === 'anthropic' && mimeType === 'application/pdf') {
    return 32 * 1024 * 1024
  }
  if (['gemini'].includes(providerId)) {
    return 20 * 1024 * 1024
  }
  return Infinity
}
