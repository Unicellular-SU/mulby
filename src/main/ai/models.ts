import type { AiModel } from '../../shared/types/ai'
import { getAiSettings } from './config'

export interface ModelInfo extends AiModel {
  providerId: string
  modelId: string
  capabilities: string[]
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
    cost: 1,
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    capabilities: ['chat', 'tools', 'vision', 'json_mode'],
    pricing: { inputPer1k: 0, outputPer1k: 0 }
  }
]

export function getAllModels(): ModelInfo[] {
  const settings = getAiSettings()
  if (settings.models && settings.models.length > 0) {
    return settings.models.map((model) => ({
      ...model,
      providerId: model.id.split(':')[0] || 'custom',
      modelId: model.id.split(':')[1] || model.id,
      capabilities: [],
      pricing: { inputPer1k: 0, outputPer1k: 0 }
    }))
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
  const raw = input || defaultModel?.id
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
