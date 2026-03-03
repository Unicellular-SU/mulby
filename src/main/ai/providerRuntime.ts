import { createProviderRegistry } from 'ai'
import type { AiProviderConfig } from '../../shared/types/ai'
import { getProviderAdapter, shouldUseChatCompletions, type ProviderAdapter } from './providerAdapterCatalog'
import { buildProvider, getProviderType } from './providers'

export interface ProviderRuntime {
  config?: AiProviderConfig
  type: string
  adapter: ProviderAdapter
  provider: unknown | null
}

interface ProviderLanguageModelFactory {
  responses?: (modelId: string) => unknown
  chat?: (modelId: string) => unknown
}

interface ProviderImageModelFactory {
  imageModel?: (modelId: string) => unknown
  image?: (modelId: string) => unknown
}

type ScopedProvider = Parameters<typeof createProviderRegistry>[0]['scoped']

export function createProviderRuntime(config?: AiProviderConfig, fallbackType?: string): ProviderRuntime {
  const inferredType = getProviderType(config)
  const type = inferredType || String(fallbackType || '').trim() || 'openai-compatible'
  return {
    config,
    type,
    adapter: getProviderAdapter(type),
    provider: config ? buildProvider(config) : null
  }
}

export function resolveLanguageModelKey(runtime: ProviderRuntime, modelId: string): unknown | null {
  if (!runtime.provider) return null
  const provider = runtime.provider as ProviderLanguageModelFactory
  if (runtime.adapter.languageModelMode === 'responses' && provider.responses) {
    return provider.responses(modelId)
  }
  if (runtime.adapter.languageModelMode === 'chat' && provider.chat) {
    return provider.chat(modelId)
  }
  if (
    runtime.adapter.openAICompatible &&
    shouldUseChatCompletions(runtime.type, runtime.config?.baseURL) &&
    provider.chat
  ) {
    return provider.chat(modelId)
  }
  const scoped = createProviderRegistry({ scoped: runtime.provider as ScopedProvider })
  return scoped.languageModel(`scoped:${modelId}`)
}

export function resolveImageModelKey(runtime: ProviderRuntime, modelId: string): unknown | null {
  if (!runtime.provider) return null
  const provider = runtime.provider as ProviderImageModelFactory
  const imageModelFactory = provider.imageModel || provider.image
  if (typeof imageModelFactory === 'function') {
    return imageModelFactory.call(runtime.provider, modelId)
  }
  try {
    const scoped = createProviderRegistry({ scoped: runtime.provider as ScopedProvider })
    return scoped.imageModel(`scoped:${modelId}`)
  } catch {
    return null
  }
}
