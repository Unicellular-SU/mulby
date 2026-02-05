import type { AiModel, AiModelCapability } from '../../shared/types/ai'
import { getAiSettings } from './config'
import { getEffectiveCapabilities } from './modelCapabilities'

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

export function getAllModels(): ModelInfo[] {
  const settings = getAiSettings()
  if (settings.models && settings.models.length > 0) {
    const providers = settings.providers || []
    return settings.models.map((model) => {
      const [rawProviderId, rawModelId] = model.id.includes(':') ? model.id.split(':', 2) : [model.id, model.id]
      let providerId = rawProviderId || 'custom'
      if (model.providerLabel) {
        const provider = providers.find((item) => (item.label || item.id) === model.providerLabel)
        if (provider?.id) {
          providerId = provider.id
        }
      }
      const providerConfig = providers.find((item) => String(item.id) === String(providerId)) || providers[0]
      const effectiveCapabilities = getEffectiveCapabilities(model.id, providerConfig)
      return {
        ...model,
        providerId,
        modelId: rawModelId || model.id,
        capabilities: effectiveCapabilities,
        pricing: { inputPer1k: 0, outputPer1k: 0 }
      }
    })
  }
  return DEFAULT_MODELS
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

  const [providerId, modelId] = raw.includes(':') ? raw.split(':', 2) : raw.split('/', 2)
  const model = getModelById(raw) || models.find((m) => m.providerId === providerId && m.modelId === modelId) || defaultModel
  if (!model) {
    throw new Error(`AI model not found: ${raw}`)
  }
  return { providerId: model.providerId, modelId: model.modelId, model }
}
