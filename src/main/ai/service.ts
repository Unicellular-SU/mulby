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
import type { PluginToolProgress } from '../../shared/types/plugin'
import { attachmentStore } from './attachments'
import { estimateTokens } from './tokens'
import { getAllModels } from './models'
import { getAiSettings } from './config'
import { aiMcpService } from './mcp'
import { aiSkillService } from './skills'
import {
  type AiToolCapabilityName
} from './tools/capabilities'
import {
  abortTrackedMcpCalls as abortTrackedMcpCallsHelper,
  emitDebugMetaChunk as emitDebugMetaChunkHelper
} from './service/stream-helpers'
import {
  resolveExecutionProviderContext as resolveExecutionProviderContextHelper,
  resolveProviderById as resolveProviderByIdHelper
} from './service/provider-helpers'
import { resolveCompatBaseURL as resolveCompatBaseURLHelper } from './service/compat-base-url'
import {
  uploadAttachmentToProviderInternal as uploadAttachmentToProviderInternalHelper
} from './service/upload-helpers'
import {
  executeUploadAttachmentOrchestration,
  resolveUploadAttachmentMeta,
  resolveUploadProviderConfig
} from './service/upload-orchestration'
import { resolveGenerationParams as resolveGenerationParamsHelper } from './service/generation-params'
import { createOpenAICompatBridge } from './service/openai-compat-bridge'
import { buildTools as buildToolsHelper } from './service/tool-builders'
import {
  executeImageWithRetry as executeImageWithRetryHelper,
  generateImageWithDecodeFallback as generateImageWithDecodeFallbackHelper,
  generateImageWithProgress as generateImageWithProgressHelper
} from './service/image-pipeline'
import {
  executeEditImageOrchestration,
  executeGenerateImagesOrchestration,
  executeGenerateImagesStreamOrchestration,
  resolveImageProvider
} from './service/image-orchestration'
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
  prepareChatRequest,
  type PreparedChatRequest
} from './service/request-preparation'
import {
  createStreamRuntime,
  finishStreamRuntimeSuccess,
  handleStreamRuntimeError,
  markStreamRuntimeRoute,
  type StreamRuntimeState
} from './service/stream-runtime-orchestration'
import {
  injectInternalRuntimeTools as injectInternalRuntimeToolsHelper,
  type CapabilityPolicyResolver,
  type InjectedInternalToolResult
} from './service/capability-injection'
import { resolveMergedTools as resolveMergedToolsHelper } from './service/merged-tools'
import { emitToolProgressChunk as emitToolProgressChunkHelper } from './service/stream-helpers'
import log from 'electron-log'

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
    onProgress?: (progress: PluginToolProgress) => void
  }) => Promise<unknown>
  private capabilityPolicyResolver?: CapabilityPolicyResolver
  private pluginToolResolver?: () => AiTool[]
  private skillActivationScopeManager?: {
    create: (requestId: string) => void
    cleanup: (requestId: string) => void
  }

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
        ...(value.internalTag ? { internalTag: value.internalTag } : {}),
        ...(value.caller ? { caller: value.caller } : {}),
        ...(value.requestId ? { requestId: value.requestId } : {})
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
    const requestId = this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(requestId, controller)

    try {
      // Create per-request skill activation scope
      this.skillActivationScopeManager?.create(requestId)
      // Thread requestId into toolContext for per-request tool state scoping
      const scopedOption = {
        ...option,
        toolContext: {
          ...option.toolContext,
          requestId,
          caller: option.toolContext?.caller
            ? { ...option.toolContext.caller, requestId, model: option.model }
            : undefined
        }
      }
      const prepared = await prepareChatRequest({
        option: scopedOption,
        controllerSignal: controller.signal,
        injectInternalRuntimeTools: (input) => this.injectInternalRuntimeTools(input),
        buildPolicyDebugInfo: (input) => this.buildPolicyDebugInfo(input),
        resolveMergedTools: async (effectiveOption) => await this.resolveMergedTools(effectiveOption),
        buildTools: (tools, context, modelId, capabilityDebug, policyDebug, abortSignal) =>
          this.buildTools(tools, context, modelId, capabilityDebug, policyDebug, abortSignal),
        resolveLanguageModel: (modelId) => this.resolveLanguageModel(modelId),
        applyContextWindow: (messages, limit) => this.applyContextWindow(messages, limit)
      })
      log.info('[AI] call 开始', {
        model: prepared.effectiveOption.model,
        messageCount: prepared.effectiveOption.messages.length,
        hasTools: !!prepared.effectiveOption.tools && prepared.effectiveOption.tools.length > 0,
        toolContext: prepared.effectiveOption.toolContext,
        hasOnChunk: !!onChunk,
        skills: prepared.skillResolution.selectedSkillNames
      })

      if (onChunk) {
        log.info('[AI] call: 使用流式模式')
        return await this.stream(option, { onChunk }, requestId)
      }

      const openAICompatBridge = this.createOpenAICompatBridge()
      const providerCallDeps = createProviderCallOrchestrationDeps({
        openAICompat: openAICompatBridge
      })
      const finalMessage = await executeProviderCallOrchestration({
        methodAdapter: prepared.methodAdapter,
        hasTools: prepared.hasTools,
        hasMultimodalContent: prepared.hasMultimodalContent,
        shouldUseCompatToolLoop: prepared.compatToolLoop,
        effectiveOption: prepared.effectiveOption,
        trimmedMessages: prepared.trimmedMessages,
        resolvedModelId: prepared.resolvedModelId,
        providerType: prepared.providerType,
        providerConfig: prepared.providerConfig,
        requestApiKey: prepared.requestApiKey,
        params: prepared.params,
        modelKey: prepared.modelKey,
        tools: prepared.tools,
        introspectionReadyTools: prepared.introspectionReadyTools,
        requestId,
        controllerSignal: controller.signal,
        capabilityDebug: prepared.effective.capabilityDebug,
        policyDebug: prepared.policyDebug,
        deps: providerCallDeps
      })
      return {
        ...finalMessage,
        capability_debug: prepared.effective.capabilityDebug,
        policy_debug: prepared.policyDebug
      }
    } finally {
      this.controllers.delete(requestId)
      this.requestMcpCallIds.delete(requestId)
      this.skillActivationScopeManager?.cleanup(requestId)
    }
  }

  async stream(option: AiOption, callbacks: StreamCallbacks, requestId?: string): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    const id = requestId || this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(id, controller)
    let prepared: PreparedChatRequest | undefined
    let runtime: StreamRuntimeState | undefined

    try {
      console.info('[AI] stream:prepare:start', {
        requestId: id,
        model: option.model
      })
      // Create per-request skill activation scope
      this.skillActivationScopeManager?.create(id)
      // Thread requestId into toolContext for per-request tool state scoping
      const scopedOption = {
        ...option,
        toolContext: {
          ...option.toolContext,
          requestId: id,
          caller: option.toolContext?.caller
            ? { ...option.toolContext.caller, requestId: id, model: option.model }
            : undefined
        }
      }
      prepared = await prepareChatRequest({
        option: scopedOption,
        controllerSignal: controller.signal,
        injectInternalRuntimeTools: (input) => this.injectInternalRuntimeTools(input),
        buildPolicyDebugInfo: (input) => this.buildPolicyDebugInfo(input),
        resolveMergedTools: async (effectiveOption) => await this.resolveMergedTools(effectiveOption),
        buildTools: (tools, context, modelId, capabilityDebug, policyDebug, abortSignal) =>
          this.buildTools(tools, context, modelId, capabilityDebug, policyDebug, abortSignal, (progress) => {
            emitToolProgressChunkHelper(runtime?.trackedOnChunk || callbacks.onChunk, progress)
          }),
        resolveLanguageModel: (modelId) => this.resolveLanguageModel(modelId),
        applyContextWindow: (messages, limit) => this.applyContextWindow(messages, limit)
      })
      console.info('[AI] stream:prepare:tools-ready', {
        requestId: id,
        model: prepared.effectiveOption.model,
        resolvedToolCount: prepared.introspectionReadyTools?.length || 0,
        hasRuntimeTools: prepared.hasTools
      })
      runtime = createStreamRuntime({
        requestId: id,
        providerType: prepared.providerType,
        model: prepared.effectiveOption.model,
        hasTools: prepared.hasTools,
        compatToolLoop: prepared.compatToolLoop,
        maxToolSteps: prepared.effectiveOption.maxToolSteps,
        selectedSkillNames: prepared.skillResolution.selectedSkillNames,
        resolvedMcpMode: prepared.effectiveOption.mcp?.mode || 'off',
        onChunk: callbacks.onChunk
      })
      emitDebugMetaChunkHelper(runtime.trackedOnChunk, {
        capabilityDebug: prepared.effective.capabilityDebug,
        policyDebug: prepared.policyDebug
      })
      const openAICompatBridge = this.createOpenAICompatBridge()
      const providerStreamDeps = createProviderStreamOrchestrationDeps({
        openAICompat: openAICompatBridge
      })

      const finalMessage = await executeProviderStreamOrchestration({
        methodAdapter: prepared.methodAdapter,
        hasTools: prepared.hasTools,
        hasMultimodalContent: prepared.hasMultimodalContent,
        shouldUseCompatToolLoop: prepared.compatToolLoop,
        effectiveOption: prepared.effectiveOption,
        trimmedMessages: prepared.trimmedMessages,
        resolvedModelId: prepared.resolvedModelId,
        providerType: prepared.providerType,
        providerConfig: prepared.providerConfig,
        requestApiKey: prepared.requestApiKey,
        params: prepared.params,
        modelKey: prepared.modelKey,
        tools: prepared.tools,
        introspectionReadyTools: prepared.introspectionReadyTools,
        requestId: id,
        controllerSignal: controller.signal,
        trackedOnChunk: runtime.trackedOnChunk,
        capabilityDebug: prepared.effective.capabilityDebug,
        policyDebug: prepared.policyDebug,
        onEnd: callbacks.onEnd,
        markRoute: (route) => markStreamRuntimeRoute(runtime!, route),
        deps: providerStreamDeps
      })
      finishStreamRuntimeSuccess(runtime, finalMessage.usage)
      return finalMessage
    } catch (err) {
      throw handleStreamRuntimeError({
        error: err,
        requestId: id,
        model: prepared?.effectiveOption.model || option.model,
        providerType: prepared?.providerType,
        runtime,
        onChunk: callbacks.onChunk,
        onError: callbacks.onError
      })
    } finally {
      this.controllers.delete(id)
      this.requestMcpCallIds.delete(id)
      this.skillActivationScopeManager?.cleanup(id)
    }
  }

  abort(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (controller) {
      console.info('[AI] abort:request', { requestId })
      controller.abort()
      this.controllers.delete(requestId)
    } else {
      log.warn('[AI] abort:no-controller', { requestId, knownIds: [...this.controllers.keys()] })
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
    onProgress?: (progress: PluginToolProgress) => void
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

  setPluginToolResolver(resolver?: () => AiTool[]): void {
    this.pluginToolResolver = resolver
  }

  setSkillActivationScopeManager(manager?: {
    create: (requestId: string) => void
    cleanup: (requestId: string) => void
  }): void {
    this.skillActivationScopeManager = manager
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
    const resolved = resolveImageProvider({
      stage: 'generateImages',
      model: input.model,
      providers: getAiSettings().providers,
      resolveExecutionProviderContext: ({ modelId }) => resolveExecutionProviderContextHelper({ modelId })
    })
    return await executeGenerateImagesOrchestration({
      ...input,
      providerType: resolved.providerType,
      providerConfig: resolved.providerConfig,
      methodAdapter: resolved.methodAdapter,
      resolveImageModel: (modelId) => this.resolveImageModel(modelId),
      executeImageWithRetry: (stage, execute, context) => this.executeImageWithRetry(stage, execute, context),
      generateImageWithProgress: (payload) => this.generateImageWithProgress(payload),
      estimateTokens: async ({ model }) => await this.estimateTokens({ model, messages: [] })
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
      const resolved = resolveImageProvider({
        stage: 'generateImagesStream',
        model: input.model,
        providers: getAiSettings().providers,
        resolveExecutionProviderContext: ({ modelId }) => resolveExecutionProviderContextHelper({ modelId })
      })
      return await executeGenerateImagesStreamOrchestration({
        ...input,
        providerType: resolved.providerType,
        providerConfig: resolved.providerConfig,
        methodAdapter: resolved.methodAdapter,
        abortSignal: controller.signal,
        onChunk,
        resolveImageModel: (modelId) => this.resolveImageModel(modelId),
        executeImageWithRetry: (stage, execute, context) => this.executeImageWithRetry(stage, execute, context),
        generateImageWithProgress: (payload) => this.generateImageWithProgress(payload),
        estimateTokens: async ({ model }) => await this.estimateTokens({ model, messages: [] })
      })
    } finally {
      this.controllers.delete(id)
    }
  }

  async editImage(input: { imageAttachmentId: string; prompt: string; model: string }): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
    const resolved = resolveImageProvider({
      stage: 'editImage',
      model: input.model,
      providers: getAiSettings().providers,
      resolveExecutionProviderContext: ({ modelId }) => resolveExecutionProviderContextHelper({ modelId })
    })
    return await executeEditImageOrchestration({
      ...input,
      providerType: resolved.providerType,
      methodAdapter: resolved.methodAdapter,
      resolveImageModel: (modelId) => this.resolveImageModel(modelId),
      readAttachment: async (attachmentId) => await attachmentStore.read(attachmentId),
      executeImageWithRetry: (stage, execute, context) => this.executeImageWithRetry(stage, execute, context),
      generateImageWithDecodeFallback: (payload) => this.generateImageWithDecodeFallback(payload),
      estimateTokens: async ({ model }) => await this.estimateTokens({ model, messages: [] })
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
      resolveMcpTools: async (input) => await aiMcpService.resolveToolsForAi(input),
      resolvePluginTools: this.pluginToolResolver
    })
  }

  private buildTools(
    tools?: AiTool[],
    context?: AiToolContext,
    modelId?: string,
    capabilityDebug?: AiCapabilityDebugInfo,
    policyDebug?: AiPolicyDebugInfo,
    abortSignal?: AbortSignal,
    onToolProgress?: (progress: { id?: string; name: string; progress: number; total?: number; message?: string }) => void
  ) {
    return buildToolsHelper({
      tools,
      context,
      modelId,
      capabilityDebug,
      policyDebug,
      abortSignal,
      onToolProgress,
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
    modelKey: unknown
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
    modelKey: unknown
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
    const providerConfig = resolveUploadProviderConfig({
      model: input.model,
      providerId: input.providerId,
      resolveExecutionProviderContext: ({ modelId }) => resolveExecutionProviderContextHelper({ modelId }),
      resolveProviderById: (providerId) => resolveProviderByIdHelper(providerId)
    })
    const attachmentMeta = resolveUploadAttachmentMeta({
      attachmentId: input.attachmentId,
      getAttachment: (attachmentId) => attachmentStore.get(attachmentId)
    })
    return await executeUploadAttachmentOrchestration({
      attachmentId: input.attachmentId,
      purpose: input.purpose,
      providerConfig,
      filename: attachmentMeta.filename,
      mimeType: attachmentMeta.mimeType,
      uploadAttachmentToProviderInternal: async (payload, config) =>
        await uploadAttachmentToProviderInternalHelper(payload, config)
    })
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
