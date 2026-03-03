import type {
  AiCapabilityDebugInfo,
  AiAttachmentRef,
  AiImageGenerateProgressChunk,
  AiMessage,
  AiModel,
  AiOption,
  AiPolicyDebugInfo,
  AiProviderConfig,
  AiSkillSelectionMeta,
  AiTokenBreakdown,
  AiToolContext,
  AiTool
} from '../../shared/types/ai'
import { attachmentStore } from './attachments'
import { estimateTokens } from './tokens'
import { getAllModels, resolveModelId } from './models'
import { getAiSettings } from './config'
import { getProviderMethodAdapter } from './providerMethodAdapters'
import { buildProviderIdCounts } from '../../shared/ai/providerValidation'
import { getProviderProtocolCapabilityRule } from '../../shared/ai/providerCapabilityGovernance'
import { shouldUseCompatToolLoop } from './toolLoopStrategy'
import { classifyAiStreamError } from '../../shared/ai/streamDiagnostics'
import { getRotatedApiKey } from '../../shared/ai/apiKeyPool'
import {
  createAiStreamMetrics,
  finishAiStreamMetricsError,
  finishAiStreamMetricsSuccess,
  markAiStreamRoute,
  recordAiStreamChunk
} from './streamMetrics'
import { aiMcpService } from './mcp'
import { aiSkillService } from './skills'
import {
  ensureRuntimeCapabilityIntrospectionTool
} from './tools/runtime-capability-introspection-tool'
import {
  type AiToolCapabilityName
} from './tools/capabilities'
import {
  buildApiKeyScope,
  resolveMaxToolSteps
} from './service/utils'
import {
  abortTrackedMcpCalls as abortTrackedMcpCallsHelper,
  emitDebugMetaChunk as emitDebugMetaChunkHelper,
  emitErrorChunk as emitErrorChunkHelper,
  hasMultimodalContent as hasMultimodalContentHelper
} from './service/stream-helpers'
import {
  resolveExecutionProviderContext as resolveExecutionProviderContextHelper,
  resolveProviderById as resolveProviderByIdHelper
} from './service/provider-helpers'
import { resolveCompatBaseURL as resolveCompatBaseURLHelper } from './service/compat-base-url'
import {
  uploadAttachmentToProviderInternal as uploadAttachmentToProviderInternalHelper
} from './service/upload-helpers'
import { resolveGenerationParams as resolveGenerationParamsHelper } from './service/generation-params'
import { createOpenAICompatBridge } from './service/openai-compat-bridge'
import { buildTools as buildToolsHelper } from './service/tool-builders'
import {
  executeImageWithRetry as executeImageWithRetryHelper,
  generateImageWithDecodeFallback as generateImageWithDecodeFallbackHelper,
  generateImageWithProgress as generateImageWithProgressHelper
} from './service/image-pipeline'
import { executeProviderCallOrchestration } from './service/provider-call-orchestration'
import { executeProviderStreamOrchestration } from './service/provider-stream-orchestration'
import {
  createProviderCallOrchestrationDeps,
  createProviderStreamOrchestrationDeps
} from './service/provider-orchestration-deps'
import {
  resolveImageModel as resolveImageModelResolver,
  resolveLanguageModel as resolveLanguageModelResolver
} from './service/provider-model-resolvers'
import {
  createFetchModelsDeps,
  createTestConnectionSharedDeps as createTestConnectionSharedDepsHelper
} from './service/provider-shared-deps'
import {
  executeTestConnection,
  executeTestConnectionStream,
  type TestConnectionInput
} from './service/test-connection'
import { executeFetchModels } from './service/fetch-models'
import {
  injectInternalRuntimeTools as injectInternalRuntimeToolsHelper,
  type CapabilityPolicyResolver,
  type InjectedInternalToolResult
} from './service/capability-injection'
import { resolveMergedTools as resolveMergedToolsHelper } from './service/merged-tools'

interface StreamCallbacks {
  onChunk?: (chunk: AiMessage) => void
  onEnd?: (message: AiMessage) => void
  onError?: (error: Error) => void
}

interface ImageStrategyCapabilityState {
  streamSupported?: boolean
  syncSupported?: boolean
  asyncSupported?: boolean
  preferredStrategy?: 'stream-sse' | 'sync-json' | 'async-job' | 'sdk-direct'
  updatedAt: number
}

export class AiService {
  private controllers = new Map<string, AbortController>()
  private requestMcpCallIds = new Map<string, Set<string>>()
  private imageStrategyCapabilities = new Map<string, ImageStrategyCapabilityState>()
  private toolExecutor?: (input: {
    name: string
    args: unknown
    context?: AiToolContext
    callId?: string
    abortSignal?: AbortSignal
  }) => Promise<unknown>
  private capabilityPolicyResolver?: CapabilityPolicyResolver

  private injectInternalRuntimeTools(input: {
    option: AiOption
    skillCapabilities?: string[]
    skillInternalTools?: string[]
    selectedSkills?: AiSkillSelectionMeta[]
  }): InjectedInternalToolResult {
    return injectInternalRuntimeToolsHelper(input, {
      capabilityPolicyResolver: this.capabilityPolicyResolver
    })
  }

  private buildPolicyDebugInfo(input: {
    requestedOption: AiOption
    effectiveOption: AiOption
    skillResolution: ReturnType<typeof aiSkillService.resolveForAiCall>
  }): AiPolicyDebugInfo {
    const normalizeStringArray = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean)
        : []
    const normalizeMcpSelection = (value: AiOption['mcp']): AiOption['mcp'] | undefined => {
      if (!value) return undefined
      return {
        mode: value.mode,
        serverIds: normalizeStringArray(value.serverIds),
        allowedToolIds: normalizeStringArray(value.allowedToolIds)
      }
    }
    const normalizeToolContext = (value: AiToolContext | undefined): AiToolContext | undefined => {
      if (!value) return undefined
      const next: AiToolContext = {
        ...(value.pluginName ? { pluginName: value.pluginName } : {}),
        ...(value.internalTag ? { internalTag: value.internalTag } : {})
      }
      if (value.mcpScope) {
        next.mcpScope = {
          allowedServerIds: normalizeStringArray(value.mcpScope.allowedServerIds),
          allowedToolIds: normalizeStringArray(value.mcpScope.allowedToolIds)
        }
      }
      return next
    }
    const requestedSkills = input.requestedOption.skills
      ? {
          mode: input.requestedOption.skills.mode,
          skillIds: normalizeStringArray(input.requestedOption.skills.skillIds),
          variables: input.requestedOption.skills.variables
            ? { ...input.requestedOption.skills.variables }
            : undefined
        }
      : undefined

    return {
      skills: {
        requested: requestedSkills,
        selectedSkillIds: normalizeStringArray(input.skillResolution.selectedSkillIds),
        selectedSkillNames: normalizeStringArray(input.skillResolution.selectedSkillNames),
        reasons: normalizeStringArray(input.skillResolution.reasons)
      },
      mcp: {
        requested: normalizeMcpSelection(input.requestedOption.mcp),
        resolved: normalizeMcpSelection(input.effectiveOption.mcp)
      },
      toolContext: {
        requested: normalizeToolContext(input.requestedOption.toolContext),
        resolved: normalizeToolContext(input.effectiveOption.toolContext)
      },
      capabilities: {
        requested: normalizeStringArray(input.requestedOption.capabilities),
        resolved: normalizeStringArray(input.effectiveOption.capabilities)
      },
      internalTools: {
        requested: normalizeStringArray(input.requestedOption.internalTools),
        resolved: normalizeStringArray(input.effectiveOption.internalTools)
      }
    }
  }

  allModels() {
    return getAllModels()
  }

  async call(option: AiOption, onChunk?: (chunk: AiMessage) => void): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    await aiSkillService.ensureCatalogLoaded()
    const skillResolution = aiSkillService.resolveForAiCall(option)
    const resolvedOption = aiSkillService.applyResolutionToOption(option, skillResolution)
    const effective = this.injectInternalRuntimeTools({
      option: resolvedOption,
      skillCapabilities: skillResolution.capabilities,
      skillInternalTools: skillResolution.internalTools,
      selectedSkills: skillResolution.selectedSkills
    })
    const effectiveOption = effective.option
    const policyDebug = this.buildPolicyDebugInfo({
      requestedOption: option,
      effectiveOption,
      skillResolution
    })
    console.log('[AI] call 开始', {
      model: effectiveOption.model,
      messageCount: effectiveOption.messages.length,
      hasTools: !!effectiveOption.tools && effectiveOption.tools.length > 0,
      toolContext: effectiveOption.toolContext,
      hasOnChunk: !!onChunk,
      skills: skillResolution.selectedSkillNames
    })
    const requestId = this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(requestId, controller)

    try {
      if (onChunk) {
        console.log('[AI] call: 使用流式模式')
        return await this.stream(option, { onChunk }, requestId)
      }

      const resolvedTools = await this.resolveMergedTools(effectiveOption)
      const introspectionReadyTools = ensureRuntimeCapabilityIntrospectionTool(resolvedTools)
      const tools = this.buildTools(
        introspectionReadyTools,
        effectiveOption.toolContext,
        effectiveOption.model,
        effective.capabilityDebug,
        policyDebug,
        controller.signal
      )

      const { modelKey } = this.resolveLanguageModel(effectiveOption.model)
      const params = resolveGenerationParamsHelper(effectiveOption, effectiveOption.model)
      const trimmedMessages = this.applyContextWindow(effectiveOption.messages, params.contextWindow)
      const resolved = resolveModelId(effectiveOption.model)
      const { providerType, providerConfig } = resolveExecutionProviderContextHelper({
        modelId: effectiveOption.model,
        providerIdOverride: resolved.providerId
      })
      const requestApiKey = getRotatedApiKey(
        providerConfig?.apiKey,
        buildApiKeyScope({
          providerId: providerConfig?.id ? String(providerConfig.id) : undefined,
          providerType,
          baseURL: providerConfig?.baseURL
        })
      )
      const methodAdapter = getProviderMethodAdapter(providerType)
      const openAICompatBridge = this.createOpenAICompatBridge()
      const providerCallDeps = createProviderCallOrchestrationDeps({
        openAICompat: openAICompatBridge
      })
      const finalMessage = await executeProviderCallOrchestration({
        methodAdapter,
        hasTools: !!tools,
        hasMultimodalContent: hasMultimodalContentHelper(trimmedMessages),
        shouldUseCompatToolLoop: shouldUseCompatToolLoop(effectiveOption.model, providerConfig),
        effectiveOption,
        trimmedMessages,
        resolvedModelId: resolved.modelId,
        providerType,
        providerConfig,
        requestApiKey,
        params,
        modelKey,
        tools,
        introspectionReadyTools,
        requestId,
        controllerSignal: controller.signal,
        capabilityDebug: effective.capabilityDebug,
        policyDebug,
        deps: providerCallDeps
      })
      return {
        ...finalMessage,
        capability_debug: effective.capabilityDebug,
        policy_debug: policyDebug
      }
    } finally {
      this.controllers.delete(requestId)
      this.requestMcpCallIds.delete(requestId)
    }
  }

  async stream(option: AiOption, callbacks: StreamCallbacks, requestId?: string): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    await aiSkillService.ensureCatalogLoaded()
    const skillResolution = aiSkillService.resolveForAiCall(option)
    const resolvedOption = aiSkillService.applyResolutionToOption(option, skillResolution)
    const effective = this.injectInternalRuntimeTools({
      option: resolvedOption,
      skillCapabilities: skillResolution.capabilities,
      skillInternalTools: skillResolution.internalTools,
      selectedSkills: skillResolution.selectedSkills
    })
    const effectiveOption = effective.option
    const policyDebug = this.buildPolicyDebugInfo({
      requestedOption: option,
      effectiveOption,
      skillResolution
    })
    const id = requestId || this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(id, controller)
    let trackedOnChunk: ((chunk: AiMessage) => void) | undefined
    let metrics: ReturnType<typeof createAiStreamMetrics> | undefined

    try {
      console.info('[AI] stream:prepare:start', {
        requestId: id,
        model: effectiveOption.model
      })
      const resolvedTools = await this.resolveMergedTools(effectiveOption)
      const introspectionReadyTools = ensureRuntimeCapabilityIntrospectionTool(resolvedTools)
      const tools = this.buildTools(
        introspectionReadyTools,
        effectiveOption.toolContext,
        effectiveOption.model,
        effective.capabilityDebug,
        policyDebug,
        controller.signal
      )
      console.info('[AI] stream:prepare:tools-ready', {
        requestId: id,
        model: effectiveOption.model,
        resolvedToolCount: introspectionReadyTools?.length || 0,
        hasRuntimeTools: !!tools
      })
      const { modelKey } = this.resolveLanguageModel(effectiveOption.model)
      const params = resolveGenerationParamsHelper(effectiveOption, effectiveOption.model)
      const trimmedMessages = this.applyContextWindow(effectiveOption.messages, params.contextWindow)
      const resolved = resolveModelId(effectiveOption.model)
      const { providerType, providerConfig } = resolveExecutionProviderContextHelper({
        modelId: effectiveOption.model,
        providerIdOverride: resolved.providerId
      })
      const requestApiKey = getRotatedApiKey(
        providerConfig?.apiKey,
        buildApiKeyScope({
          providerId: providerConfig?.id ? String(providerConfig.id) : undefined,
          providerType,
          baseURL: providerConfig?.baseURL
        })
      )
      const methodAdapter = getProviderMethodAdapter(providerType)
      const compatToolLoop = shouldUseCompatToolLoop(effectiveOption.model, providerConfig)
      metrics = createAiStreamMetrics({
        requestId: id,
        providerType,
        model: effectiveOption.model,
        hasTools: !!tools,
        compatToolLoop,
        maxToolSteps: resolveMaxToolSteps(effectiveOption.maxToolSteps)
      })
      trackedOnChunk = (chunk: AiMessage) => {
        recordAiStreamChunk(metrics!, chunk)
        callbacks.onChunk?.(chunk)
      }
      console.info('[AI] stream:boot', {
        requestId: id,
        model: effectiveOption.model,
        providerType,
        resolvedMcpMode: effectiveOption.mcp?.mode || 'off',
        resolvedSkillNames: skillResolution.selectedSkillNames
      })
      console.info('[AI] stream:metrics:start', {
        requestId: id,
        providerType,
        model: effectiveOption.model,
        hasTools: metrics.hasTools,
        compatToolLoop: metrics.compatToolLoop,
        maxToolSteps: metrics.maxToolSteps,
        skills: skillResolution.selectedSkillNames
      })
      emitDebugMetaChunkHelper(trackedOnChunk, {
        capabilityDebug: effective.capabilityDebug,
        policyDebug
      })
      const openAICompatBridge = this.createOpenAICompatBridge()
      const providerStreamDeps = createProviderStreamOrchestrationDeps({
        openAICompat: openAICompatBridge
      })

      const finalMessage = await executeProviderStreamOrchestration({
        methodAdapter,
        hasTools: !!tools,
        hasMultimodalContent: hasMultimodalContentHelper(trimmedMessages),
        shouldUseCompatToolLoop: compatToolLoop,
        effectiveOption,
        trimmedMessages,
        resolvedModelId: resolved.modelId,
        providerType,
        providerConfig,
        requestApiKey,
        params,
        modelKey,
        tools,
        introspectionReadyTools,
        requestId: id,
        controllerSignal: controller.signal,
        trackedOnChunk,
        capabilityDebug: effective.capabilityDebug,
        policyDebug,
        onEnd: callbacks.onEnd,
        markRoute: (route) => markAiStreamRoute(metrics!, route),
        deps: providerStreamDeps
      })
      const successMetrics = finishAiStreamMetricsSuccess(metrics, finalMessage.usage)
      console.info('[AI] stream:metrics:end', successMetrics)
      return finalMessage
    } catch (err) {
      const classification = classifyAiStreamError(err)
      const error = err instanceof Error ? err : new Error(classification.message || 'AI stream failed')
      emitErrorChunkHelper(trackedOnChunk || callbacks.onChunk, error, classification)
      callbacks.onError?.(error)
      if (metrics) {
        const finalizedMetrics = finishAiStreamMetricsError(metrics, classification)
        console.error('[AI] stream:error', {
          requestId: id,
          providerType: metrics.providerType,
          model: effectiveOption.model,
          code: classification.code,
          category: classification.category,
          retryable: classification.retryable,
          statusCode: classification.statusCode,
          message: classification.message
        })
        console.info('[AI] stream:metrics:end', finalizedMetrics)
      } else {
        console.error('[AI] stream:error', {
          requestId: id,
          model: effectiveOption.model,
          code: classification.code,
          category: classification.category,
          retryable: classification.retryable,
          statusCode: classification.statusCode,
          message: classification.message
        })
      }
      throw error
    } finally {
      this.controllers.delete(id)
      this.requestMcpCallIds.delete(id)
    }
  }

  abort(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (controller) {
      console.info('[AI] abort:request', { requestId })
      controller.abort()
      this.controllers.delete(requestId)
    }
    const trackedCount = this.requestMcpCallIds.get(requestId)?.size || 0
    if (trackedCount > 0) {
      console.info('[AI] abort:mcp-calls', { requestId, trackedCount })
    }
    abortTrackedMcpCallsHelper(this.requestMcpCallIds, requestId)
  }

  async estimateTokens(input: { model?: string; messages: AiMessage[]; outputText?: string }): Promise<AiTokenBreakdown> {
    const params = resolveGenerationParamsHelper({ model: input.model, messages: input.messages }, input.model)
    const maxOutputTokens = params.maxOutputTokensEnabled === false ? undefined : params.maxOutputTokens
    return await estimateTokens({ ...input, maxOutputTokens })
  }

  setToolExecutor(executor?: (input: {
    name: string
    args: unknown
    context?: AiToolContext
    callId?: string
    abortSignal?: AbortSignal
  }) => Promise<unknown>): void {
    this.toolExecutor = executor
  }

  setCapabilityPolicyResolver(
    resolver?: (input: {
      option: AiOption
      requestedCapabilities: AiToolCapabilityName[]
      selectedSkills?: AiSkillSelectionMeta[]
    }) => { allowedCapabilities: string[]; deniedCapabilities?: string[]; reasons?: string[] }
  ): void {
    this.capabilityPolicyResolver = resolver
  }

  async uploadAttachment(input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }): Promise<AiAttachmentRef> {
    return await attachmentStore.upload(input)
  }

  async getAttachment(attachmentId: string): Promise<AiAttachmentRef | null> {
    return attachmentStore.get(attachmentId)
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    await attachmentStore.delete(attachmentId)
  }

  async generateImages(input: { prompt: string; model: string; size?: string; count?: number }): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
    const { providerType, providerConfig } = resolveExecutionProviderContextHelper({ modelId: input.model })
    const providerForCapability: AiProviderConfig = providerConfig || {
      id: providerType,
      type: providerType,
      enabled: true
    }
    const providerIdCounts = buildProviderIdCounts(getAiSettings().providers)
    const imageCapability = getProviderProtocolCapabilityRule(providerForCapability, 'image', providerIdCounts)
    console.info('[AI] capability:protocol', {
      stage: 'generateImages',
      providerType,
      model: input.model,
      capability: imageCapability.capability,
      enabled: imageCapability.enabled,
      source: imageCapability.source,
      reason: imageCapability.reason
    })
    if (!imageCapability.enabled) {
      throw new Error(imageCapability.reason)
    }
    const methodAdapter = getProviderMethodAdapter(providerType)
    return await methodAdapter.generateImages({
      executeSdkGenerate: async () => {
        const { modelKey, model } = this.resolveImageModel(input.model)
        console.info('[AI] generateImages:start', {
          modelInput: input.model,
          resolvedModel: model,
          size: input.size,
          count: input.count
        })
        const result = await this.executeImageWithRetry(
          'generateImages',
          async () =>
            await this.generateImageWithProgress({
              modelKey,
              prompt: input.prompt,
              size: input.size,
              n: input.count,
              providerType,
              providerConfig
            }),
          {
            modelInput: input.model,
            resolvedModel: model,
            size: input.size,
            count: input.count
          }
        )

        const images = result.images || []
        const tokens = await this.estimateTokens({ model: input.model, messages: [] })
        return { images, tokens }
      },
      executeSdkEdit: async () => {
        throw new Error('Unsupported path')
      }
    })
  }

  async generateImagesStream(
    input: { prompt: string; model: string; size?: string; count?: number },
    onChunk: (chunk: AiImageGenerateProgressChunk) => void,
    requestId?: string
  ): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
    const id = requestId || this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(id, controller)

    try {
      const { providerType, providerConfig } = resolveExecutionProviderContextHelper({ modelId: input.model })
      const providerForCapability: AiProviderConfig = providerConfig || {
        id: providerType,
        type: providerType,
        enabled: true
      }
      const providerIdCounts = buildProviderIdCounts(getAiSettings().providers)
      const imageCapability = getProviderProtocolCapabilityRule(providerForCapability, 'image', providerIdCounts)
      console.info('[AI] capability:protocol', {
        stage: 'generateImagesStream',
        providerType,
        model: input.model,
        capability: imageCapability.capability,
        enabled: imageCapability.enabled,
        source: imageCapability.source,
        reason: imageCapability.reason
      })
      if (!imageCapability.enabled) {
        throw new Error(imageCapability.reason)
      }

      const methodAdapter = getProviderMethodAdapter(providerType)
      return await methodAdapter.generateImages({
        executeSdkGenerate: async () => {
          const { modelKey, model } = this.resolveImageModel(input.model)
          console.info('[AI] generateImagesStream:start', {
            modelInput: input.model,
            resolvedModel: model,
            size: input.size,
            count: input.count
          })
          onChunk({
            type: 'status',
            stage: 'start',
            message: '开始生成图片...'
          })

          const result = await this.executeImageWithRetry(
            'generateImages',
            async () =>
              await this.generateImageWithProgress({
                modelKey,
                prompt: input.prompt,
                size: input.size,
                n: input.count,
                providerType,
                providerConfig,
                abortSignal: controller.signal,
                onChunk
              }),
            {
              modelInput: input.model,
              resolvedModel: model,
              size: input.size,
              count: input.count
            }
          )

          const tokens = await this.estimateTokens({ model: input.model, messages: [] })
          onChunk({
            type: 'status',
            stage: 'completed',
            message: `生成完成，返回 ${result.images.length} 张`,
            received: result.images.length,
            total: input.count || result.images.length
          })
          return { images: result.images, tokens }
        },
        executeSdkEdit: async () => {
          throw new Error('Unsupported path')
        }
      })
    } finally {
      this.controllers.delete(id)
    }
  }

  async editImage(input: { imageAttachmentId: string; prompt: string; model: string }): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
    const { providerType, providerConfig } = resolveExecutionProviderContextHelper({ modelId: input.model })
    const providerForCapability: AiProviderConfig = providerConfig || {
      id: providerType,
      type: providerType,
      enabled: true
    }
    const providerIdCounts = buildProviderIdCounts(getAiSettings().providers)
    const imageCapability = getProviderProtocolCapabilityRule(providerForCapability, 'image', providerIdCounts)
    console.info('[AI] capability:protocol', {
      stage: 'editImage',
      providerType,
      model: input.model,
      capability: imageCapability.capability,
      enabled: imageCapability.enabled,
      source: imageCapability.source,
      reason: imageCapability.reason
    })
    if (!imageCapability.enabled) {
      throw new Error(imageCapability.reason)
    }
    const methodAdapter = getProviderMethodAdapter(providerType)
    return await methodAdapter.editImage({
      executeSdkGenerate: async () => {
        throw new Error('Unsupported path')
      },
      executeSdkEdit: async () => {
        const { modelKey, model } = this.resolveImageModel(input.model)
        console.info('[AI] editImage:start', {
          modelInput: input.model,
          resolvedModel: model,
          imageAttachmentId: input.imageAttachmentId
        })
        const image = await attachmentStore.read(input.imageAttachmentId)

        const result = await this.executeImageWithRetry(
          'editImage',
          async () =>
            await this.generateImageWithDecodeFallback({
              modelKey,
              prompt: {
                text: input.prompt,
                images: [image]
              }
            }),
          {
            modelInput: input.model,
            resolvedModel: model,
            imageAttachmentId: input.imageAttachmentId
          }
        )

        const images = result.images || []
        const tokens = await this.estimateTokens({ model: input.model, messages: [] })
        return { images, tokens }
      }
    })
  }

  async testConnection(input?: TestConnectionInput): Promise<{ success: boolean; message?: string }> {
    const sharedDeps = createTestConnectionSharedDepsHelper()
    return await executeTestConnection(input, {
      resolveGenerationParams: (option, modelId) => resolveGenerationParamsHelper(option, modelId),
      shared: sharedDeps
    })
  }

  async testConnectionStream(
    input: TestConnectionInput,
    onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
  ): Promise<{ success: boolean; message?: string; reasoning?: string }> {
    const sharedDeps = createTestConnectionSharedDepsHelper()
    const openAICompatBridge = this.createOpenAICompatBridge()
    return await executeTestConnectionStream(input, onChunk, {
      resolveGenerationParams: (option, modelId) => resolveGenerationParamsHelper(option, modelId),
      streamOpenAICompat: async (payload, handler) =>
        await openAICompatBridge.streamOpenAICompat(payload, handler),
      shared: sharedDeps
    })
  }

  private createOpenAICompatBridge() {
    return createOpenAICompatBridge({
      resolveCompatBaseURL: (explicitBaseURL?: string, providerType?: string) =>
        resolveCompatBaseURLHelper(explicitBaseURL, providerType),
      resolveGenerationParams: (option: AiOption, modelId?: string) =>
        resolveGenerationParamsHelper(option, modelId),
      requestMcpCallIds: this.requestMcpCallIds,
      toolExecutor: this.toolExecutor
    })
  }

  private async resolveMergedTools(option: AiOption): Promise<AiTool[] | undefined> {
    return await resolveMergedToolsHelper(option, {
      resolveMcpTools: async (input) => await aiMcpService.resolveToolsForAi(input)
    })
  }

  private buildTools(
    tools?: AiTool[],
    context?: AiToolContext,
    modelId?: string,
    capabilityDebug?: AiCapabilityDebugInfo,
    policyDebug?: AiPolicyDebugInfo,
    abortSignal?: AbortSignal
  ) {
    return buildToolsHelper({
      tools,
      context,
      modelId,
      capabilityDebug,
      policyDebug,
      abortSignal,
      toolExecutor: this.toolExecutor
    })
  }

  async fetchModels(input: { providerId: string; baseURL?: string; apiKey?: string }): Promise<{ models: AiModel[]; message?: string }> {
    return await executeFetchModels(input, createFetchModelsDeps())
  }

  private async executeImageWithRetry<T>(
    stage: 'generateImages' | 'editImage',
    execute: () => Promise<T>,
    context: Record<string, unknown>
  ): Promise<T> {
    return await executeImageWithRetryHelper(stage, execute, context)
  }

  private async generateImageWithProgress(input: {
    modelKey: any
    prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
    size?: string
    n?: number
    providerType?: string
    providerConfig?: AiProviderConfig
    abortSignal?: AbortSignal
    onChunk?: (chunk: AiImageGenerateProgressChunk) => void
  }): Promise<{ images: string[] }> {
    return await generateImageWithProgressHelper({
      ...input,
      imageStrategyCapabilities: this.imageStrategyCapabilities,
      resolveCompatBaseURL: (baseURL?: string, providerType?: string) =>
        resolveCompatBaseURLHelper(baseURL, providerType)
    })
  }

  private async generateImageWithDecodeFallback(input: {
    modelKey: any
    prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
    size?: string
    n?: number
    abortSignal?: AbortSignal
  }): Promise<{ images: string[] }> {
    return await generateImageWithDecodeFallbackHelper(input)
  }

  private resolveLanguageModel(modelId?: string): { model: string; modelKey: unknown } {
    return resolveLanguageModelResolver({
      modelId,
      resolveExecutionProviderContext: (targetModelId?: string, providerIdOverride?: string) =>
        resolveExecutionProviderContextHelper({ modelId: targetModelId, providerIdOverride })
    })
  }

  private resolveImageModel(modelId?: string): { model: string; modelKey: unknown } {
    return resolveImageModelResolver({
      modelId,
      resolveExecutionProviderContext: (targetModelId?: string, providerIdOverride?: string) =>
        resolveExecutionProviderContextHelper({ modelId: targetModelId, providerIdOverride })
    })
  }

  async uploadAttachmentToProvider(
    input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }
  ): Promise<{ providerId: string; fileId: string; uri?: string }> {
    const providerConfig = input.model
      ? resolveExecutionProviderContextHelper({ modelId: input.model }).providerConfig
      : resolveProviderByIdHelper(input.providerId)
    if (!providerConfig) {
      console.error('[AI] uploadAttachmentToProvider:provider_not_found', { input })
      throw new Error('Provider config not found for attachment upload')
    }
    const attachment = attachmentStore.get(input.attachmentId)
    if (!attachment) {
      console.error('[AI] uploadAttachmentToProvider:attachment_not_found', { attachmentId: input.attachmentId })
      throw new Error(`Attachment not found: ${input.attachmentId}`)
    }
    const filename = attachment?.filename || 'attachment'
    const mimeType = attachment?.mimeType || 'application/octet-stream'
    try {
      const remote = await uploadAttachmentToProviderInternalHelper(
        { attachmentId: input.attachmentId, filename, mimeType, purpose: input.purpose },
        providerConfig
      )
      if (!remote?.fileId) {
        console.error('[AI] uploadAttachmentToProvider:missing_file_id', {
          providerId: providerConfig.id,
          attachmentId: input.attachmentId
        })
        throw new Error('Failed to upload attachment to provider: missing file id')
      }
      return { providerId: String(providerConfig.id), fileId: remote.fileId, uri: remote.uri }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[AI] uploadAttachmentToProvider:fail', {
        providerId: providerConfig.id,
        attachmentId: input.attachmentId,
        baseURL: providerConfig.baseURL,
        error: message
      })
      throw new Error(message)
    }
  }

  private createRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  private applyContextWindow(messages: AiMessage[], limit?: number): AiMessage[] {
    if (limit === undefined || limit <= 0 || limit >= 100) return messages
    const systemMessages = messages.filter((message) => message.role === 'system')
    const otherMessages = messages.filter((message) => message.role !== 'system')
    const trimmed = otherMessages.slice(Math.max(0, otherMessages.length - limit))
    return [...systemMessages, ...trimmed]
  }

}
