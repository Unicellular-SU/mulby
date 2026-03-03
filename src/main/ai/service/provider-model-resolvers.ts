import type { AiProviderConfig } from '../../../shared/types/ai'
import { resolveModelId } from '../models'
import { getProviderRegistry, hasProvider } from '../providers'
import { createProviderRuntime, resolveImageModelKey, resolveLanguageModelKey } from '../providerRuntime'

interface ResolveProviderModelInput {
  modelId?: string
  resolveExecutionProviderContext: (
    modelId?: string,
    providerIdOverride?: string
  ) => { providerType: string; providerConfig?: AiProviderConfig }
}

export function resolveLanguageModel(input: ResolveProviderModelInput): { model: string; modelKey: unknown } {
  const { providerId, modelId: resolvedId } = resolveModelId(input.modelId)
  if (!hasProvider(providerId)) {
    throw new Error(`AI provider not available: ${providerId}`)
  }

  const { providerType, providerConfig } = input.resolveExecutionProviderContext(input.modelId, providerId)
  const runtime = createProviderRuntime(providerConfig, providerType)
  const runtimeType = runtime.type
  const resolvedKey = resolveLanguageModelKey(runtime, resolvedId)
  if (resolvedKey) {
    return { model: `${runtimeType}:${resolvedId}`, modelKey: resolvedKey }
  }

  const registry = getProviderRegistry()
  const modelKey = registry.languageModel(`${runtimeType}:${resolvedId}`)
  return { model: `${runtimeType}:${resolvedId}`, modelKey }
}

export function resolveImageModel(input: ResolveProviderModelInput): { model: string; modelKey: unknown } {
  const { providerId, modelId: resolvedId } = resolveModelId(input.modelId)
  if (!hasProvider(providerId)) {
    throw new Error(`AI provider not available: ${providerId}`)
  }

  const { providerType, providerConfig } = input.resolveExecutionProviderContext(input.modelId, providerId)
  const runtime = createProviderRuntime(providerConfig, providerType)
  const runtimeType = runtime.type
  console.info('[AI] resolveImageModel', {
    modelInput: input.modelId,
    resolvedModel: `${runtimeType}:${resolvedId}`,
    providerId: runtimeType,
    providerLabel: providerConfig?.label || providerConfig?.id,
    baseURL: providerConfig?.baseURL
  })
  const resolvedKey = resolveImageModelKey(runtime, resolvedId)
  if (resolvedKey) {
    return { model: `${runtimeType}:${resolvedId}`, modelKey: resolvedKey }
  }

  const registry = getProviderRegistry()
  const modelKey = registry.imageModel(`${runtimeType}:${resolvedId}`)
  return { model: `${runtimeType}:${resolvedId}`, modelKey }
}
