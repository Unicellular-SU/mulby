import type { AiModelParameters, AiOption } from '../../../shared/types/ai'
import { getAiSettings } from '../config'
import { resolveModelConfig, resolveProviderConfig } from './provider-helpers'
import { mergeModelParams, normalizeModelParams } from './utils'

export function resolveGenerationParams(option: AiOption, modelId?: string): AiModelParameters {
  const settings = getAiSettings()
  const modelConfig = resolveModelConfig(modelId)
  const providerConfig = resolveProviderConfig({ modelId })
  const merged = mergeModelParams(
    settings.defaultParams,
    providerConfig?.defaultParams,
    modelConfig?.params,
    option.params
  )
  return normalizeModelParams(merged)
}
