import { generateText, streamText } from 'ai'
import type {
import log from 'electron-log'
  AiModel,
  AiModelParameters,
  AiOption,
  AiProviderConfig
} from '../../../shared/types/ai'
import { supportsReasoning } from '../modelCapabilities'
import { getAiSettings } from '../config'
import { getProviderType } from '../providers'
import { buildProviderIdCounts } from '../../../shared/ai/providerValidation'
import { getProviderProtocolCapabilityRule } from '../../../shared/ai/providerCapabilityGovernance'
import { isOpenAICompatibleProvider, shouldUseChatCompletions } from '../providerAdapterCatalog'
import { createProviderRuntime, resolveLanguageModelKey } from '../providerRuntime'
import { buildEndpointRoutedProviderConfig, resolveEndpointRoutedProviderType } from '../../../shared/ai/providerEndpointRouting'
import { splitThinkTaggedText } from '../thinkTagParser'
import { aggregateSdkStreamResult } from './reply-aggregation'

export type TestConnectionInput = {
  model?: string
  providerId?: string
  apiKey?: string
  baseURL?: string
}

type TestConnectionStreamChunk = { type: 'content' | 'reasoning'; text: string }

interface TestConnectionSharedDeps {
  resolveProviderById: (providerId?: string) => AiProviderConfig | undefined
  resolveModelConfig: (modelId?: string) => AiModel | undefined
  resolveProviderConfig: (modelId?: string, providerIdOverride?: string) => AiProviderConfig | undefined
  resolveLanguageModel: (modelId?: string) => { model: string; modelKey: unknown }
}

interface ExecuteTestConnectionDeps {
  resolveGenerationParams: (option: AiOption, modelId?: string) => AiModelParameters
  shared: TestConnectionSharedDeps
}

interface ExecuteTestConnectionStreamDeps {
  resolveGenerationParams: (option: AiOption, modelId?: string) => AiModelParameters
  streamOpenAICompat: (
    input: TestConnectionInput & { providerType?: string },
    onChunk: (chunk: TestConnectionStreamChunk) => void
  ) => Promise<{ content: string; reasoning: string }>
  shared: TestConnectionSharedDeps
}

export function resolveTestInput(
  input: TestConnectionInput | undefined,
  deps: Pick<TestConnectionSharedDeps, 'resolveProviderConfig'>
): TestConnectionInput | undefined {
  if (!input?.model || input.providerId) return input
  const providerConfig = deps.resolveProviderConfig(input.model)
  if (!providerConfig?.id) return input
  return {
    ...input,
    providerId: providerConfig.id,
    apiKey: input.apiKey ?? providerConfig.apiKey,
    baseURL: input.baseURL ?? providerConfig.baseURL
  }
}

export function resolveTestModel(
  input: TestConnectionInput | undefined,
  deps: TestConnectionSharedDeps
): { modelKey: unknown } {
  if (!input?.providerId) {
    return deps.resolveLanguageModel(input?.model)
  }

  const modelId = input.model?.includes(':') ? input.model.split(':', 2)[1] : input.model
  if (!modelId) {
    throw new Error('Model is required for provider test')
  }

  const configured = deps.resolveProviderById(input.providerId)
  const resolvedType = getProviderType(configured) || String(input.providerId)
  const declaredProvider: AiProviderConfig = {
    id: input.providerId,
    type: resolvedType,
    enabled: true,
    apiKey: input.apiKey ?? configured?.apiKey,
    baseURL: input.baseURL ?? configured?.baseURL,
    apiVersion: configured?.apiVersion,
    anthropicBaseURL: configured?.anthropicBaseURL,
    headers: configured?.headers
  }
  const resolvedModelConfig = deps.resolveModelConfig(input.model)
  const routedType = resolveEndpointRoutedProviderType({
    providerType: resolvedType,
    provider: declaredProvider,
    model: resolvedModelConfig
  })
  const providerConfig = buildEndpointRoutedProviderConfig(declaredProvider, routedType)
  const runtime = createProviderRuntime(providerConfig, routedType)
  if (!runtime.provider) {
    throw new Error(`Provider not supported: ${input.providerId}`)
  }
  const modelKey = resolveLanguageModelKey(runtime, modelId)
  if (!modelKey) {
    throw new Error(`Provider model resolver failed: ${input.providerId}`)
  }
  return { modelKey }
}

export async function executeTestConnection(
  input: TestConnectionInput | undefined,
  deps: ExecuteTestConnectionDeps
): Promise<{ success: boolean; message?: string }> {
  try {
    if (input?.providerId) {
      const provider = deps.shared.resolveProviderById(input.providerId)
      const declaredProviderType = getProviderType(provider) || String(input.providerId)
      const routedProviderType = resolveEndpointRoutedProviderType({
        providerType: declaredProviderType,
        provider,
        model: deps.shared.resolveModelConfig(input.model)
      })
      const mergedProvider: AiProviderConfig = {
        id: String(input.providerId),
        type: routedProviderType,
        enabled: true,
        apiKey: input.apiKey ?? provider?.apiKey,
        baseURL: input.baseURL ?? provider?.baseURL,
        headers: provider?.headers
      }
      const providerIdCounts = buildProviderIdCounts(getAiSettings().providers)
      const chatCapability = getProviderProtocolCapabilityRule(mergedProvider, 'chat', providerIdCounts)
      console.info('[AI] capability:protocol', {
        stage: 'testConnection',
        providerId: input.providerId,
        providerType: routedProviderType,
        capability: chatCapability.capability,
        enabled: chatCapability.enabled,
        source: chatCapability.source,
        reason: chatCapability.reason
      })
      if (!chatCapability.enabled) {
        return { success: false, message: chatCapability.reason }
      }
    }

    const { modelKey } = resolveTestModel(input, deps.shared)
    const params = deps.resolveGenerationParams({ model: input?.model, messages: [] }, input?.model)
    console.info('[AI] testConnection:start', {
      providerId: input?.providerId,
      model: input?.model,
      baseURL: input?.baseURL
    })
    const result = await generateText({
      model: modelKey,
      messages: [{ role: 'user', content: 'ping' }],
      ...params,
      maxOutputTokens: Math.min(params.maxOutputTokens ?? 8, 32)
    } as Parameters<typeof generateText>[0])
    const allowReasoning = supportsReasoning(input?.model)
    const parsed = allowReasoning && typeof result.text === 'string'
      ? splitThinkTaggedText(result.text, input?.model)
      : undefined
    console.info('[AI] testConnection:success', {
      providerId: input?.providerId,
      model: input?.model
    })
    return { success: true, message: parsed ? (parsed.content || 'ok') : (result.text || 'ok') }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI connection failed'
    log.error('[AI] testConnection:fail', {
      providerId: input?.providerId,
      model: input?.model,
      baseURL: input?.baseURL,
      error: message
    })
    return { success: false, message }
  }
}

export async function executeTestConnectionStream(
  input: TestConnectionInput,
  onChunk: (chunk: TestConnectionStreamChunk) => void,
  deps: ExecuteTestConnectionStreamDeps
): Promise<{ success: boolean; message?: string; reasoning?: string }> {
  try {
    const allowReasoning = supportsReasoning(input?.model)
    const resolvedInput = resolveTestInput(input, deps.shared) || {}
    const resolvedProvider = deps.shared.resolveProviderById(resolvedInput?.providerId)
    const declaredProviderType = getProviderType(
      resolvedProvider || {
        id: String(resolvedInput?.providerId || ''),
        type: String(resolvedInput?.providerId || ''),
        enabled: true,
        baseURL: resolvedInput?.baseURL,
        apiKey: resolvedInput?.apiKey
      }
    )
    const resolvedProviderType = resolveEndpointRoutedProviderType({
      providerType: declaredProviderType,
      provider: resolvedProvider,
      model: deps.shared.resolveModelConfig(resolvedInput?.model)
    })
    if (resolvedInput?.providerId) {
      const mergedProvider: AiProviderConfig = {
        id: String(resolvedInput.providerId),
        type: resolvedProviderType,
        enabled: true,
        apiKey: resolvedInput.apiKey ?? resolvedProvider?.apiKey,
        baseURL: resolvedInput.baseURL ?? resolvedProvider?.baseURL,
        headers: resolvedProvider?.headers
      }
      const providerIdCounts = buildProviderIdCounts(getAiSettings().providers)
      const chatCapability = getProviderProtocolCapabilityRule(mergedProvider, 'chat', providerIdCounts)
      console.info('[AI] capability:protocol', {
        stage: 'testConnectionStream',
        providerId: resolvedInput.providerId,
        providerType: resolvedProviderType,
        capability: chatCapability.capability,
        enabled: chatCapability.enabled,
        source: chatCapability.source,
        reason: chatCapability.reason
      })
      if (!chatCapability.enabled) {
        return { success: false, message: chatCapability.reason }
      }
    }
    console.info('[AI] testConnectionStream:start', {
      providerId: resolvedInput?.providerId,
      model: resolvedInput?.model,
      baseURL: resolvedInput?.baseURL
    })

    if (isOpenAICompatibleProvider(resolvedProviderType) && shouldUseChatCompletions(resolvedProviderType, resolvedInput?.baseURL)) {
      const { content, reasoning } = await deps.streamOpenAICompat(
        { ...resolvedInput, providerType: resolvedProviderType },
        (chunk) => {
          if (chunk.type === 'reasoning' && !allowReasoning) return
          onChunk(chunk)
        }
      )
      console.info('[AI] testConnectionStream:success', {
        providerId: resolvedInput?.providerId,
        model: resolvedInput?.model
      })
      return { success: true, message: content || 'ok', reasoning: allowReasoning ? reasoning : '' }
    }

    const { modelKey } = resolveTestModel(resolvedInput, deps.shared)
    const params = deps.resolveGenerationParams({ model: resolvedInput?.model, messages: [] }, resolvedInput?.model)
    const result = await streamText({
      model: modelKey,
      messages: [{ role: 'user', content: 'ping' }],
      ...params,
      maxOutputTokens: Math.min(params.maxOutputTokens ?? 128, 256)
    } as Parameters<typeof streamText>[0])
    const { content: fullText, reasoning } = await aggregateSdkStreamResult({
      result,
      allowReasoning,
      modelId: resolvedInput?.model,
      onPart: (part) => {
        console.info('[AI] testConnectionStream:chunk', {
          type: part?.type,
          delta: typeof part?.delta === 'string' ? part.delta.slice(0, 120) : undefined,
          hasDelta: typeof part?.delta === 'string' ? part.delta.length : 0
        })
      },
      onText: (text) => onChunk({ type: 'content', text }),
      onReasoning: (text) => onChunk({ type: 'reasoning', text })
    })

    console.info('[AI] testConnectionStream:success', {
      providerId: resolvedInput?.providerId,
      model: resolvedInput?.model
    })
    return { success: true, message: fullText || 'ok', reasoning: allowReasoning ? reasoning : '' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI connection failed'
    log.error('[AI] testConnectionStream:fail', {
      providerId: input?.providerId,
      model: input?.model,
      baseURL: input?.baseURL,
      error: message
    })
    return { success: false, message }
  }
}
