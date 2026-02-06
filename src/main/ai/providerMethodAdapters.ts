import type { AiMessage, AiModel, AiTokenBreakdown } from '../../shared/types/ai'
import { getProviderAdapter } from './providerAdapterCatalog'

export interface ProviderCallAdapterArgs {
  hasTools: boolean
  hasMultimodalContent: boolean
  shouldUseCompatToolLoop: boolean
  executeAnthropicCall: () => Promise<AiMessage>
  executeCompatToolLoopCall: () => Promise<AiMessage>
  executeSdkCall: () => Promise<AiMessage>
}

export interface ProviderStreamAdapterArgs {
  hasTools: boolean
  hasMultimodalContent: boolean
  shouldUseCompatToolLoop: boolean
  executeAnthropicStream: () => Promise<AiMessage>
  executeCompatChatStream: () => Promise<AiMessage>
  executeCompatToolLoopStream: () => Promise<AiMessage>
  executeSdkStream: () => Promise<AiMessage>
}

export interface ProviderImageAdapterArgs {
  executeSdkGenerate: () => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
  executeSdkEdit: () => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
}

export interface ProviderFetchModelsAdapterArgs {
  executeModelDiscovery: (input: {
    endpoint: string
    parseModelIds: (payload: unknown) => string[]
  }) => Promise<{ models: AiModel[]; message?: string }>
}

export interface ProviderMethodAdapter {
  type: string
  call: (args: ProviderCallAdapterArgs) => Promise<AiMessage>
  stream: (args: ProviderStreamAdapterArgs) => Promise<AiMessage>
  generateImages: (args: ProviderImageAdapterArgs) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
  editImage: (args: ProviderImageAdapterArgs) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
  fetchModels: (args: ProviderFetchModelsAdapterArgs) => Promise<{ models: AiModel[]; message?: string }>
}

function createProviderMethodAdapter(type: string): ProviderMethodAdapter {
  const adapter = getProviderAdapter(type)
  return {
    type: adapter.type,
    async call(args) {
      if (adapter.type === 'anthropic' && args.hasMultimodalContent) {
        return args.executeAnthropicCall()
      }
      if (adapter.openAICompatible && args.hasTools && args.shouldUseCompatToolLoop) {
        return args.executeCompatToolLoopCall()
      }
      return args.executeSdkCall()
    },
    async stream(args) {
      if (adapter.type === 'anthropic' && args.hasMultimodalContent) {
        return args.executeAnthropicStream()
      }
      if (adapter.openAICompatible && adapter.preferCompatTextStream && !args.hasTools) {
        return args.executeCompatChatStream()
      }
      if (adapter.openAICompatible && args.hasTools && args.shouldUseCompatToolLoop) {
        return args.executeCompatToolLoopStream()
      }
      return args.executeSdkStream()
    },
    async generateImages(args) {
      if (!adapter.supportsImageGeneration) {
        throw new Error(`Provider type (${adapter.type}) does not support image generation`)
      }
      return args.executeSdkGenerate()
    },
    async editImage(args) {
      if (!adapter.supportsImageGeneration) {
        throw new Error(`Provider type (${adapter.type}) does not support image editing`)
      }
      return args.executeSdkEdit()
    },
    async fetchModels(args) {
      if (!adapter.supportsModelFetch || !adapter.modelDiscovery || adapter.modelDiscovery.endpoints.length === 0) {
        return { models: [], message: `当前 provider 类型 (${adapter.type}) 暂不支持自动拉取模型列表` }
      }
      let fallback: { models: AiModel[]; message?: string } = { models: [] }
      for (const endpoint of adapter.modelDiscovery.endpoints) {
        const result = await args.executeModelDiscovery({
          endpoint,
          parseModelIds: adapter.modelDiscovery.parseModelIds
        })
        if (result.models.length > 0) return result
        if (result.message) fallback = result
      }
      return fallback
    }
  }
}

const methodAdapterCache = new Map<string, ProviderMethodAdapter>()

export function getProviderMethodAdapter(type?: string): ProviderMethodAdapter {
  const normalized = String(type || '').trim().toLowerCase() || 'openai-compatible'
  const cached = methodAdapterCache.get(normalized)
  if (cached) return cached
  const next = createProviderMethodAdapter(normalized)
  methodAdapterCache.set(normalized, next)
  return next
}
