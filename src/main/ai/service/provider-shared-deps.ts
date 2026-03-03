import { resolveCompatBaseURL as resolveCompatBaseURLHelper } from './compat-base-url'
import { resolveLanguageModel as resolveLanguageModelResolver } from './provider-model-resolvers'
import {
  resolveExecutionProviderContext as resolveExecutionProviderContextHelper,
  resolveModelConfig as resolveModelConfigHelper,
  resolveProviderById as resolveProviderByIdHelper,
  resolveProviderConfig as resolveProviderConfigHelper
} from './provider-helpers'

export function createTestConnectionSharedDeps() {
  return {
    resolveProviderById: (providerId?: string) => resolveProviderByIdHelper(providerId),
    resolveModelConfig: (modelId?: string) => resolveModelConfigHelper(modelId),
    resolveProviderConfig: (modelId?: string, providerIdOverride?: string) =>
      resolveProviderConfigHelper({ modelId, providerIdOverride }),
    resolveLanguageModel: (modelId?: string) =>
      resolveLanguageModelResolver({
        modelId,
        resolveExecutionProviderContext: (targetModelId?: string, providerIdOverride?: string) =>
          resolveExecutionProviderContextHelper({ modelId: targetModelId, providerIdOverride })
      })
  }
}

export function createFetchModelsDeps() {
  return {
    resolveProviderById: (providerId?: string) => resolveProviderByIdHelper(providerId),
    resolveCompatBaseURL: (explicitBaseURL?: string, providerType?: string) =>
      resolveCompatBaseURLHelper(explicitBaseURL, providerType)
  }
}
