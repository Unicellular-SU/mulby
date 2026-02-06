import { createProviderRegistry } from 'ai'
import type { AiProviderConfig } from '../../shared/types/ai'
import { getProviderAdapter, shouldUseChatCompletions, type ProviderAdapter } from './providerAdapterCatalog'
import { buildProvider, getProviderType } from './providers'

export interface ProviderRuntime {
  config?: AiProviderConfig
  type: string
  adapter: ProviderAdapter
  provider: any | null
}

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

export function resolveLanguageModelKey(runtime: ProviderRuntime, modelId: string): any | null {
  if (!runtime.provider) return null
  if (
    runtime.adapter.openAICompatible &&
    shouldUseChatCompletions(runtime.type, runtime.config?.baseURL) &&
    (runtime.provider as any).chat
  ) {
    return (runtime.provider as any).chat(modelId)
  }
  const scoped = createProviderRegistry({ scoped: runtime.provider as any })
  return scoped.languageModel(`scoped:${modelId}`)
}

export function resolveImageModelKey(runtime: ProviderRuntime, modelId: string): any | null {
  if (!runtime.provider) return null
  const imageModelFactory = (runtime.provider as any).imageModel || (runtime.provider as any).image
  if (typeof imageModelFactory === 'function') {
    return imageModelFactory.call(runtime.provider, modelId)
  }
  try {
    const scoped = createProviderRegistry({ scoped: runtime.provider as any })
    return scoped.imageModel(`scoped:${modelId}`)
  } catch {
    return null
  }
}

