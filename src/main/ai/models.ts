import type { AiModel, AiModelCapability } from '../../shared/types/ai'
import { getAiSettings } from './config'
import { getEffectiveCapabilities } from './modelCapabilities'
import { inferProviderType } from './providerCatalog'

export interface ModelInfo extends AiModel {
  providerId: string
  modelId: string
  capabilities: AiModelCapability[]
  pricing: {
    inputPer1k: number
    outputPer1k: number
    imageInput?: number
    imageOutput?: number
  }
}

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'openai:gpt-4o-mini',
    label: 'gpt-4o-mini',
    description: 'OpenAI small multimodal model',
    icon: '',
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    capabilities: [{ type: 'vision' }, { type: 'function_calling' }],
    pricing: { inputPer1k: 0, outputPer1k: 0 }
  }
]

function resolveProviderForModel(
  model: AiModel,
  providers: ReturnType<typeof getAiSettings>['providers'],
  fallbackProviderId?: string
) {
  if (model.providerRef) {
    const byRef = providers.find((item) => String(item.id) === String(model.providerRef))
    if (byRef) return byRef
  }
  if (model.providerLabel) {
    const byLabel = providers.find((item) => (item.label || item.id) === model.providerLabel)
    if (byLabel) return byLabel
  }
  if (fallbackProviderId) {
    const byId = providers.find((item) => String(item.id) === String(fallbackProviderId))
    if (byId) return byId
    const byType = providers.find((item) => inferProviderType(item) === String(fallbackProviderId))
    if (byType) return byType
  }
  return providers[0]
}

function parseModelKey(raw: string): { providerToken: string; modelToken: string } {
  if (raw.includes(':')) {
    const [providerToken, modelToken] = raw.split(':', 2)
    return { providerToken, modelToken }
  }
  if (raw.includes('/')) {
    const [providerToken, modelToken] = raw.split('/', 2)
    return { providerToken, modelToken }
  }
  return { providerToken: raw, modelToken: raw }
}

function toFallbackModelInfo(inputRaw: string): ModelInfo {
  const { providerToken, modelToken } = parseModelKey(inputRaw)
  return {
    id: inputRaw,
    label: modelToken || inputRaw,
    description: '',
    providerId: providerToken || 'openai',
    modelId: modelToken || inputRaw,
    capabilities: [],
    pricing: { inputPer1k: 0, outputPer1k: 0 }
  }
}

export function getAllModels(): ModelInfo[] {
  const settings = getAiSettings()
  const providers = settings.providers || []
  if (settings.models && settings.models.length > 0) {
    return settings.models
      .map((model) => {
        const { providerToken, modelToken } = parseModelKey(model.id)
        const providerConfig = resolveProviderForModel(model, providers, providerToken)
        if (providerConfig && providerConfig.enabled === false) {
          return null
        }
        const providerId = providerConfig ? inferProviderType(providerConfig) : providerToken || 'openai-compatible'
        const effectiveCapabilities = getEffectiveCapabilities(model.id, providerConfig)
        return {
          ...model,
          providerId,
          modelId: modelToken || model.id,
          capabilities: effectiveCapabilities,
          pricing: { inputPer1k: 0, outputPer1k: 0 }
        }
      })
      .filter((model): model is ModelInfo => model !== null)
  }
  return DEFAULT_MODELS.filter((model) => {
    const providerConfig = providers.find((provider) => {
      const providerId = String(provider.id || '')
      return providerId === model.providerId || inferProviderType(provider) === model.providerId
    })
    if (!providerConfig) return true
    return providerConfig.enabled !== false
  })
}

export function getModelById(id: string): ModelInfo | null {
  const models = getAllModels()
  return models.find((model) => model.id === id) || null
}

export function resolveModelId(input?: string): { providerId: string; modelId: string; model: ModelInfo } {
  const models = getAllModels()
  const defaultModel = models[0]
  const settings = getAiSettings()
  const providerDefault = settings.providers.find((provider) => provider.defaultModel)?.defaultModel
  const raw = input || providerDefault || defaultModel?.id
  if (!raw) {
    throw new Error('AI model is not configured')
  }

  const { providerToken, modelToken } = parseModelKey(raw)
  const model = getModelById(raw) || models.find((m) => m.modelId === modelToken && (m.id === raw || m.providerId === providerToken))
  if (!model) {
    const fallback = defaultModel || toFallbackModelInfo(raw)
    const providerConfig =
      settings.providers.find((provider) => String(provider.id) === providerToken) ||
      settings.providers.find((provider) => inferProviderType(provider) === providerToken)
    const providerId = providerConfig ? inferProviderType(providerConfig) : providerToken || fallback.providerId
    return {
      providerId,
      modelId: modelToken || fallback.modelId,
      model: fallback
    }
  }
  return { providerId: model.providerId, modelId: model.modelId, model }
}
