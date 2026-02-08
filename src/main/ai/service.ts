import { generateText, streamText, generateImage, stepCountIs } from 'ai'
import { jsonSchema, tool } from '@ai-sdk/provider-utils'
import type {
  AiAttachmentRef,
  AiImageGenerateProgressChunk,
  AiMessage,
  AiModel,
  AiModelParameters,
  AiOption,
  AiProviderConfig,
  AiTokenBreakdown,
  AiToolContext,
  AiTool
} from '../../shared/types/ai'
import { attachmentStore } from './attachments'
import { FileServiceManager } from './fileServices/FileServiceManager'
import {
  getFileSizeLimit,
  supportsEmbedding,
  supportsFunctionCalling,
  supportsImageInput,
  supportsLargeFileUpload,
  supportsPdfInput,
  supportsReasoning,
  supportsRerank,
  supportsWebSearch
} from './modelCapabilities'
import { countTokensForText, countTokensFromMessages, estimateTokens } from './tokens'
import { getAllModels, resolveModelId } from './models'
import { getAiSettings } from './config'
import { getProviderRegistry, hasProvider, getProviderType } from './providers'
import { isOpenAICompatibleProvider, shouldUseChatCompletions } from './providerAdapterCatalog'
import { createProviderRuntime, resolveImageModelKey, resolveLanguageModelKey } from './providerRuntime'
import { getProviderMethodAdapter } from './providerMethodAdapters'
import { buildProviderIdCounts } from '../../shared/ai/providerValidation'
import { getProviderProtocolCapabilityRule } from '../../shared/ai/providerCapabilityGovernance'
import { getSystemDefaultModels } from '../../shared/ai/systemModels'
import { shouldUseCompatToolLoop } from './toolLoopStrategy'
import { classifyAiStreamError } from '../../shared/ai/streamDiagnostics'
import { classifyAiImageError } from '../../shared/ai/imageDiagnostics'
import { resolveProviderBaseURL } from '../../shared/ai/providerDefaults'
import { buildEndpointRoutedProviderConfig, resolveEndpointRoutedProviderType } from '../../shared/ai/providerEndpointRouting'
import {
  createEndChunk,
  createErrorChunk,
  createReasoningChunk,
  createTextChunk,
  createToolCallChunk,
  createToolResultChunk
} from './streamChunkProtocol'
import {
  createAiStreamMetrics,
  finishAiStreamMetricsError,
  finishAiStreamMetricsSuccess,
  markAiStreamRoute,
  recordAiStreamChunk
} from './streamMetrics'
import {
  createThinkTagStreamState,
  finalizeThinkTagStream,
  parseThinkTaggedChunk,
  splitThinkTaggedText
} from './thinkTagParser'

interface StreamCallbacks {
  onChunk?: (chunk: AiMessage) => void
  onEnd?: (message: AiMessage) => void
  onError?: (error: Error) => void
}

export class AiService {
  private controllers = new Map<string, AbortController>()
  private toolExecutor?: (input: { name: string; args: unknown; context?: AiToolContext }) => Promise<unknown>

  allModels() {
    return getAllModels()
  }

  async call(option: AiOption, onChunk?: (chunk: AiMessage) => void): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    console.log('[AI] call 开始', {
      model: option.model,
      messageCount: option.messages.length,
      hasTools: !!option.tools && option.tools.length > 0,
      toolContext: option.toolContext,
      hasOnChunk: !!onChunk
    })
    const tools = this.buildTools(option.tools, option.toolContext, option.model)
    const requestId = this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(requestId, controller)

    try {
      if (onChunk) {
        console.log('[AI] call: 使用流式模式')
        return await this.stream(option, { onChunk }, requestId)
      }

      const { modelKey } = this.resolveLanguageModel(option.model)
      const params = this.resolveGenerationParams(option, option.model)
      const trimmedMessages = this.applyContextWindow(option.messages, params.contextWindow)
      const resolved = resolveModelId(option.model)
      const { providerType, providerConfig } = this.resolveExecutionProviderContext(option.model, resolved.providerId)
      const methodAdapter = getProviderMethodAdapter(providerType)
      return await methodAdapter.call({
        hasTools: !!tools,
        hasMultimodalContent: this.hasMultimodalContent(trimmedMessages),
        shouldUseCompatToolLoop: shouldUseCompatToolLoop(option.model, providerConfig),
        executeAnthropicCall: async () => {
          console.log('[AI] call: 使用 Anthropic 原生 API')
          const anthropicPayload = await this.toAnthropicMessages(trimmedMessages, option.model, providerConfig)
          const { content, reasoning } = await this.callAnthropicMessages({
            model: resolved.modelId,
            messages: anthropicPayload.messages,
            system: anthropicPayload.system,
            apiKey: providerConfig?.apiKey,
            baseURL: providerConfig?.baseURL,
            params
          })
          const usage = normalizeUsage(
            undefined,
            countTokensFromMessages(trimmedMessages, option.model),
            countTokensForText(`${reasoning || ''}${content || ''}`, option.model)
          )
          return {
            role: 'assistant',
            content,
            reasoning_content: reasoning || undefined,
            usage
          }
        },
        executeCompatToolLoopCall: async () => {
          console.log('[AI] call: 使用 OpenAI 兼容工具调用分支（DeepSeek reasoning 兼容）', {
            model: option.model,
            maxToolSteps: option.maxToolSteps ?? 10
          })
          const chatMessages = await this.toOpenAIChatMessages(trimmedMessages, option.model, { includeReasoningContent: true })
          const { content, reasoning, usage } = await this.runOpenAICompatToolLoop({
            model: resolved.modelId,
            providerType,
            messages: chatMessages,
            apiKey: providerConfig?.apiKey,
            baseURL: providerConfig?.baseURL,
            params,
            tools: option.tools || [],
            maxToolSteps: option.maxToolSteps,
            toolContext: option.toolContext,
            allowReasoning: supportsReasoning(option.model)
          }, undefined, controller.signal)

          return {
            role: 'assistant',
            content,
            reasoning_content: reasoning || undefined,
            usage: normalizeUsage(
              usage,
              countTokensFromMessages(trimmedMessages, option.model),
              countTokensForText(`${reasoning || ''}${content || ''}`, option.model)
            )
          }
        },
        executeSdkCall: async () => {
          console.log('[AI] call: 使用 Vercel AI SDK generateText', { hasTools: !!tools })
          const messages = await this.toSdkMessages(trimmedMessages, option.model)
          const maxSteps = option.maxToolSteps ?? 10
          const result = await generateText({
            model: modelKey,
            messages,
            abortSignal: controller.signal,
            tools,
            stopWhen: tools ? stepCountIs(maxSteps) : undefined,
            ...params
          })

          console.log('[AI] call: generateText 完成', {
            text: result.text?.substring(0, 100),
            hasToolCalls: !!(result as any).toolCalls,
            toolCallsCount: (result as any).toolCalls?.length,
            steps: (result as any).steps?.length,
            finishReason: result.finishReason
          })

          const allowReasoning = supportsReasoning(option.model)
          let contentText = result.text || ''
          let reasoningText = allowReasoning ? String((result as any).reasoning || '') : ''
          if (allowReasoning) {
            const parsed = splitThinkTaggedText(contentText, option.model)
            contentText = parsed.content
            if (!reasoningText && parsed.reasoning) {
              reasoningText = parsed.reasoning
            }
          }
          const usage = normalizeUsage(
            extractUsage(result),
            countTokensFromMessages(trimmedMessages, option.model),
            countTokensForText(`${reasoningText || ''}${contentText || ''}`, option.model)
          )

          return {
            role: 'assistant',
            content: contentText,
            reasoning_content: allowReasoning ? reasoningText || undefined : undefined,
            usage
          }
        }
      })
    } finally {
      this.controllers.delete(requestId)
    }
  }

  async stream(option: AiOption, callbacks: StreamCallbacks, requestId?: string): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    const tools = this.buildTools(option.tools, option.toolContext, option.model)

    const id = requestId || this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(id, controller)
    let trackedOnChunk: ((chunk: AiMessage) => void) | undefined
    let metrics: ReturnType<typeof createAiStreamMetrics> | undefined

    try {
      const { modelKey } = this.resolveLanguageModel(option.model)
      const params = this.resolveGenerationParams(option, option.model)
      const trimmedMessages = this.applyContextWindow(option.messages, params.contextWindow)
      const resolved = resolveModelId(option.model)
      const { providerType, providerConfig } = this.resolveExecutionProviderContext(option.model, resolved.providerId)
      const methodAdapter = getProviderMethodAdapter(providerType)
      const compatToolLoop = shouldUseCompatToolLoop(option.model, providerConfig)
      metrics = createAiStreamMetrics({
        requestId: id,
        providerType,
        model: option.model,
        hasTools: !!tools,
        compatToolLoop,
        maxToolSteps: option.maxToolSteps ?? 10
      })
      trackedOnChunk = (chunk: AiMessage) => {
        recordAiStreamChunk(metrics!, chunk)
        callbacks.onChunk?.(chunk)
      }
      console.info('[AI] stream:metrics:start', {
        requestId: id,
        providerType,
        model: option.model,
        hasTools: metrics.hasTools,
        compatToolLoop: metrics.compatToolLoop,
        maxToolSteps: metrics.maxToolSteps
      })

      const finalMessage = await methodAdapter.stream({
        hasTools: !!tools,
        hasMultimodalContent: this.hasMultimodalContent(trimmedMessages),
        shouldUseCompatToolLoop: compatToolLoop,
        executeAnthropicStream: async () => {
          markAiStreamRoute(metrics!, 'anthropic-native')
          const anthropicPayload = await this.toAnthropicMessages(trimmedMessages, option.model, providerConfig)
          const { content, reasoning } = await this.streamAnthropicMessages({
            model: resolved.modelId,
            messages: anthropicPayload.messages,
            system: anthropicPayload.system,
            apiKey: providerConfig?.apiKey,
            baseURL: providerConfig?.baseURL,
            params
          }, trackedOnChunk, controller.signal)

          const usage = normalizeUsage(
            undefined,
            countTokensFromMessages(trimmedMessages, option.model),
            countTokensForText(`${reasoning || ''}${content || ''}`, option.model)
          )
          const finalMessage: AiMessage = {
            role: 'assistant',
            content,
            reasoning_content: reasoning || undefined,
            usage
          }
          this.emitEndChunk(trackedOnChunk, finalMessage)
          callbacks.onEnd?.(finalMessage)
          return finalMessage
        },
        executeCompatChatStream: async () => {
          markAiStreamRoute(metrics!, 'openai-compat-chat')
          const { content, reasoning } = await this.streamOpenAICompatChat({
            model: resolved.modelId,
            providerType,
            messages: await this.toOpenAIChatMessages(option.messages, option.model),
            apiKey: providerConfig?.apiKey,
            baseURL: providerConfig?.baseURL,
            params,
            tools: option.tools
          }, trackedOnChunk, controller.signal)

          const usage = normalizeUsage(
            undefined,
            countTokensFromMessages(trimmedMessages, option.model),
            countTokensForText(`${reasoning || ''}${content || ''}`, option.model)
          )
          const finalMessage: AiMessage = {
            role: 'assistant',
            content,
            reasoning_content: reasoning || undefined,
            usage
          }
          this.emitEndChunk(trackedOnChunk, finalMessage)
          callbacks.onEnd?.(finalMessage)
          return finalMessage
        },
        executeCompatToolLoopStream: async () => {
          markAiStreamRoute(metrics!, 'openai-compat-tool-loop')
          console.log('[AI] stream: 使用 OpenAI 兼容工具调用分支（DeepSeek reasoning 兼容）', {
            model: option.model,
            maxToolSteps: option.maxToolSteps ?? 10
          })
          const chatMessages = await this.toOpenAIChatMessages(trimmedMessages, option.model, { includeReasoningContent: true })
          const { content, reasoning, usage } = await this.runOpenAICompatToolLoop({
            model: resolved.modelId,
            providerType,
            messages: chatMessages,
            apiKey: providerConfig?.apiKey,
            baseURL: providerConfig?.baseURL,
            params,
            tools: option.tools || [],
            maxToolSteps: option.maxToolSteps,
            toolContext: option.toolContext,
            allowReasoning: supportsReasoning(option.model)
          }, trackedOnChunk, controller.signal)

          const finalMessage: AiMessage = {
            role: 'assistant',
            content,
            reasoning_content: supportsReasoning(option.model) ? reasoning || undefined : undefined,
            usage: normalizeUsage(
              usage,
              countTokensFromMessages(trimmedMessages, option.model),
                countTokensForText(`${reasoning || ''}${content || ''}`, option.model)
            )
          }
          this.emitEndChunk(trackedOnChunk, finalMessage)
          callbacks.onEnd?.(finalMessage)
          return finalMessage
        },
        executeSdkStream: async () => {
          markAiStreamRoute(metrics!, 'ai-sdk-stream')
          if (isOpenAICompatibleProvider(providerType) && shouldUseChatCompletions(providerType, providerConfig?.baseURL) && tools) {
            // 兼容 chat/completions 流式分支当前仅解析文本，不处理 tool_calls。
            // 启用工具时回退到 AI SDK 的 streamText，以支持工具执行与多步调用。
            console.log('[AI] stream: 检测到工具调用，使用 AI SDK streamText 分支', {
              model: option.model,
              maxToolSteps: option.maxToolSteps ?? 10
            })
          }
          const messages = await this.toSdkMessages(trimmedMessages, option.model)
          const result = await streamText({
            model: modelKey,
            messages,
            abortSignal: controller.signal,
            tools,
            stopWhen: tools ? stepCountIs(option.maxToolSteps ?? 10) : undefined,
            ...params
          })

          let fullText = ''
          let reasoningText = ''
          const allowReasoning = supportsReasoning(option.model)
          const thinkTagState = allowReasoning ? createThinkTagStreamState(option.model) : undefined
          let hasStructuredReasoningSignal = false

          if ((result as any).fullStream) {
            for await (const part of (result as any).fullStream) {
              console.log('[AI] stream part:', part?.type, part)
              if (part?.type === 'text-delta') {
                const textDelta = typeof (part as any).delta === 'string'
                  ? (part as any).delta
                  : (typeof (part as any).text === 'string' ? (part as any).text : '')
                if (textDelta) {
                  if (allowReasoning && thinkTagState) {
                    const parsed = parseThinkTaggedChunk(textDelta, thinkTagState)
                    if (parsed.reasoning && !hasStructuredReasoningSignal) {
                      reasoningText += parsed.reasoning
                      this.emitReasoningChunk(trackedOnChunk, parsed.reasoning)
                    }
                    if (parsed.content) {
                      fullText += parsed.content
                      this.emitTextChunk(trackedOnChunk, parsed.content)
                    }
                  } else {
                    fullText += textDelta
                    this.emitTextChunk(trackedOnChunk, textDelta)
                  }
                }
              } else if (part?.type === 'reasoning-delta') {
                const reasoningDelta = typeof (part as any).delta === 'string'
                  ? (part as any).delta
                  : (typeof (part as any).text === 'string' ? (part as any).text : '')
                if (reasoningDelta && allowReasoning) {
                  hasStructuredReasoningSignal = true
                  reasoningText += reasoningDelta
                  this.emitReasoningChunk(trackedOnChunk, reasoningDelta)
                }
              } else if (part?.type === 'tool-call') {
                console.log('[AI] tool-call detected:', part)
                this.emitToolCallChunk(trackedOnChunk, {
                  id: part.toolCallId,
                  name: part.toolName,
                  args: (part as any).input ?? (part as any).args
                })
              } else if (part?.type === 'tool-result') {
                console.log('[AI] tool-result detected:', part)
                this.emitToolResultChunk(trackedOnChunk, {
                  id: part.toolCallId,
                  name: part.toolName,
                  result: (part as any).result ?? (part as any).output
                })
              }
            }
          } else {
            for await (const chunk of result.textStream) {
              if (!chunk) continue
              if (allowReasoning && thinkTagState) {
                const parsed = parseThinkTaggedChunk(chunk, thinkTagState)
                if (parsed.reasoning) {
                  reasoningText += parsed.reasoning
                  this.emitReasoningChunk(trackedOnChunk, parsed.reasoning)
                }
                if (parsed.content) {
                  fullText += parsed.content
                  this.emitTextChunk(trackedOnChunk, parsed.content)
                }
              } else {
                fullText += chunk
                this.emitTextChunk(trackedOnChunk, chunk)
              }
            }
          }

          if (allowReasoning && thinkTagState) {
            const tail = finalizeThinkTagStream(thinkTagState)
            if (tail.reasoning) {
              reasoningText += tail.reasoning
              this.emitReasoningChunk(trackedOnChunk, tail.reasoning)
            }
            if (tail.content) {
              fullText += tail.content
              this.emitTextChunk(trackedOnChunk, tail.content)
            }
          }

          if (!fullText && (result as any).text) {
            const fallbackText = String((await (result as any).text) || '')
            if (allowReasoning) {
              const parsed = splitThinkTaggedText(fallbackText, option.model)
              fullText = parsed.content
              if (!reasoningText && parsed.reasoning) {
                reasoningText = parsed.reasoning
              }
            } else {
              fullText = fallbackText
            }
          }
          if (!reasoningText && (result as any).reasoningText && allowReasoning) {
            reasoningText = (await (result as any).reasoningText) || ''
          }

          const usage = normalizeUsage(
            extractUsage(result),
            countTokensFromMessages(trimmedMessages, option.model),
            countTokensForText(`${reasoningText || ''}${fullText || ''}`, option.model)
          )

          const finalMessage: AiMessage = {
            role: 'assistant',
            content: fullText || '',
            reasoning_content: allowReasoning ? reasoningText || undefined : undefined,
            usage
          }
          this.emitEndChunk(trackedOnChunk, finalMessage)
          callbacks.onEnd?.(finalMessage)
          return finalMessage
        }
      })
      const successMetrics = finishAiStreamMetricsSuccess(metrics, finalMessage.usage)
      console.info('[AI] stream:metrics:end', successMetrics)
      return finalMessage
    } catch (err) {
      const classification = classifyAiStreamError(err)
      const error = err instanceof Error ? err : new Error(classification.message || 'AI stream failed')
      this.emitErrorChunk(trackedOnChunk || callbacks.onChunk, error, classification)
      callbacks.onError?.(error)
      if (metrics) {
        const finalizedMetrics = finishAiStreamMetricsError(metrics, classification)
        console.error('[AI] stream:error', {
          requestId: id,
          providerType: metrics.providerType,
          model: option.model,
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
          model: option.model,
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
    }
  }

  abort(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (controller) {
      controller.abort()
      this.controllers.delete(requestId)
    }
  }

  async estimateTokens(input: { model?: string; messages: AiMessage[]; outputText?: string }): Promise<AiTokenBreakdown> {
    const params = this.resolveGenerationParams({ model: input.model, messages: input.messages }, input.model)
    const maxOutputTokens = params.maxOutputTokensEnabled === false ? undefined : params.maxOutputTokens
    return await estimateTokens({ ...input, maxOutputTokens })
  }

  setToolExecutor(executor?: (input: { name: string; args: unknown; context?: AiToolContext }) => Promise<unknown>): void {
    this.toolExecutor = executor
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
    const { providerType, providerConfig } = this.resolveExecutionProviderContext(input.model)
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
            await this.generateImageWithDecodeFallback({
              modelKey,
              prompt: input.prompt,
              size: input.size,
              n: input.count
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
      const { providerType, providerConfig } = this.resolveExecutionProviderContext(input.model)
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
    const { providerType, providerConfig } = this.resolveExecutionProviderContext(input.model)
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

  async testConnection(input?: { model?: string; providerId?: string; apiKey?: string; baseURL?: string }): Promise<{ success: boolean; message?: string }> {
    try {
      if (input?.providerId) {
        const provider = this.resolveProviderById(input.providerId)
        const declaredProviderType = getProviderType(provider) || String(input.providerId)
        const routedProviderType = resolveEndpointRoutedProviderType({
          providerType: declaredProviderType,
          provider,
          model: this.resolveModelConfig(input.model)
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
      const { modelKey } = this.resolveTestModel(input)
      const params = this.resolveGenerationParams({ model: input?.model, messages: [] }, input?.model)
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
      } as any)
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
      console.error('[AI] testConnection:fail', {
        providerId: input?.providerId,
        model: input?.model,
        baseURL: input?.baseURL,
        error: message
      })
      return { success: false, message }
    }
  }

  async testConnectionStream(
    input: { model?: string; providerId?: string; apiKey?: string; baseURL?: string },
    onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
  ): Promise<{ success: boolean; message?: string; reasoning?: string }> {
    try {
      const allowReasoning = supportsReasoning(input?.model)
      const resolvedInput = this.resolveTestInput(input) || {}
      const resolvedProvider = this.resolveProviderById(resolvedInput?.providerId)
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
        model: this.resolveModelConfig(resolvedInput?.model)
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
        const { content, reasoning } = await this.streamOpenAICompat({ ...resolvedInput, providerType: resolvedProviderType }, (chunk) => {
          if (chunk.type === 'reasoning' && !allowReasoning) return
          onChunk(chunk)
        })
        console.info('[AI] testConnectionStream:success', {
          providerId: resolvedInput?.providerId,
          model: resolvedInput?.model
        })
        return { success: true, message: content || 'ok', reasoning: allowReasoning ? reasoning : '' }
      }

      const { modelKey } = this.resolveTestModel(resolvedInput)
      const params = this.resolveGenerationParams({ model: resolvedInput?.model, messages: [] }, resolvedInput?.model)
      const result = await streamText({
        model: modelKey,
        messages: [{ role: 'user', content: 'ping' }],
        ...params,
        maxOutputTokens: Math.min(params.maxOutputTokens ?? 128, 256)
      } as any)

      let fullText = ''
      let reasoning = ''
      const thinkTagState = allowReasoning ? createThinkTagStreamState(resolvedInput?.model) : undefined
      let hasStructuredReasoningSignal = false

      if ((result as any).fullStream) {
        for await (const part of (result as any).fullStream) {
          console.info('[AI] testConnectionStream:chunk', {
            type: part?.type,
            delta: typeof part?.delta === 'string' ? part.delta.slice(0, 120) : undefined,
            hasDelta: typeof part?.delta === 'string' ? part.delta.length : 0
          })
          if (part?.type === 'text-delta') {
            const textDelta = String(part.delta || '')
            if (allowReasoning && thinkTagState) {
              const parsed = parseThinkTaggedChunk(textDelta, thinkTagState)
              if (parsed.reasoning && !hasStructuredReasoningSignal) {
                reasoning += parsed.reasoning
                onChunk({ type: 'reasoning', text: parsed.reasoning })
              }
              if (parsed.content) {
                fullText += parsed.content
                onChunk({ type: 'content', text: parsed.content })
              }
            } else {
              fullText += textDelta
              onChunk({ type: 'content', text: textDelta })
            }
          } else if (part?.type === 'reasoning-delta') {
            if (!allowReasoning) continue
            hasStructuredReasoningSignal = true
            reasoning += part.delta || ''
            onChunk({ type: 'reasoning', text: part.delta || '' })
          }
        }
      } else {
        for await (const chunk of result.textStream) {
          if (allowReasoning && thinkTagState) {
            const parsed = parseThinkTaggedChunk(chunk, thinkTagState)
            if (parsed.reasoning) {
              reasoning += parsed.reasoning
              onChunk({ type: 'reasoning', text: parsed.reasoning })
            }
            if (parsed.content) {
              fullText += parsed.content
              onChunk({ type: 'content', text: parsed.content })
            }
          } else {
            fullText += chunk
            onChunk({ type: 'content', text: chunk })
          }
        }
      }

      if (allowReasoning && thinkTagState) {
        const tail = finalizeThinkTagStream(thinkTagState)
        if (tail.reasoning) {
          reasoning += tail.reasoning
          onChunk({ type: 'reasoning', text: tail.reasoning })
        }
        if (tail.content) {
          fullText += tail.content
          onChunk({ type: 'content', text: tail.content })
        }
      }

      console.info('[AI] testConnectionStream:success', {
        providerId: resolvedInput?.providerId,
        model: resolvedInput?.model
      })
      return { success: true, message: fullText || 'ok', reasoning: allowReasoning ? reasoning : '' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI connection failed'
      console.error('[AI] testConnectionStream:fail', {
        providerId: input?.providerId,
        model: input?.model,
        baseURL: input?.baseURL,
        error: message
      })
      return { success: false, message }
    }
  }

  private async streamOpenAICompat(
    input: { model?: string; providerId?: string; providerType?: string; apiKey?: string; baseURL?: string },
    onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
  ): Promise<{ content: string; reasoning: string }> {
    const allowReasoning = supportsReasoning(input.model)
    const baseURL = this.resolveCompatBaseURL(input.baseURL, input.providerType || input.providerId)
    const url = `${baseURL.replace(/\/$/, '')}/chat/completions`
    const modelId = input.model?.includes(':') ? input.model.split(':', 2)[1] : input.model
    if (!modelId) {
      throw new Error('Model is required for provider test')
    }

    const params = this.resolveGenerationParams({ model: input?.model, messages: [] }, input?.model)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: modelId,
        stream: true,
        messages: [{ role: 'user', content: 'ping' }],
        temperature: params.temperature,
        top_p: params.topP,
        max_tokens: params.maxOutputTokens ? Math.min(params.maxOutputTokens, 256) : 128,
        presence_penalty: params.presencePenalty,
        frequency_penalty: params.frequencyPenalty,
        stop: params.stopSequences,
        seed: params.seed
      })
    })

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let reasoning = ''
    const thinkTagState = allowReasoning ? createThinkTagStreamState(input.model) : undefined

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          if (allowReasoning && thinkTagState) {
            const tail = finalizeThinkTagStream(thinkTagState)
            if (tail.reasoning) {
              reasoning += tail.reasoning
              onChunk({ type: 'reasoning', text: tail.reasoning })
            }
            if (tail.content) {
              content += tail.content
              onChunk({ type: 'content', text: tail.content })
            }
          }
          return { content, reasoning }
        }
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta || {}
          const reasoningChunk = delta.reasoning_content || delta.reasoning
          const contentChunk = delta.content
          const hasStructuredReasoning = !!reasoningChunk && allowReasoning

          if (reasoningChunk && allowReasoning) {
            reasoning += reasoningChunk
            onChunk({ type: 'reasoning', text: reasoningChunk })
          }
          if (contentChunk) {
            const contentText = String(contentChunk)
            if (allowReasoning && thinkTagState) {
              const parsed = parseThinkTaggedChunk(contentText, thinkTagState)
              if (parsed.reasoning && !hasStructuredReasoning) {
                reasoning += parsed.reasoning
                onChunk({ type: 'reasoning', text: parsed.reasoning })
              }
              if (parsed.content) {
                content += parsed.content
                onChunk({ type: 'content', text: parsed.content })
              }
            } else {
              content += contentText
              onChunk({ type: 'content', text: contentText })
            }
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    if (allowReasoning && thinkTagState) {
      const tail = finalizeThinkTagStream(thinkTagState)
      if (tail.reasoning) {
        reasoning += tail.reasoning
        onChunk({ type: 'reasoning', text: tail.reasoning })
      }
      if (tail.content) {
        content += tail.content
        onChunk({ type: 'content', text: tail.content })
      }
    }

    return { content, reasoning }
  }

  private async streamOpenAICompatChat(
    input: {
      model: string
      providerType?: string
      messages: Array<{
        role: 'system' | 'user' | 'assistant'
        content:
          | string
          | Array<
              | { type: 'text'; text: string }
              | { type: 'image_url'; image_url: { url: string } }
            >
      }>
      apiKey?: string
      baseURL?: string
      params: AiModelParameters
      tools?: AiTool[]
    },
    onChunk?: (chunk: AiMessage) => void,
    abortSignal?: AbortSignal
  ): Promise<{ content: string; reasoning: string }> {
    const allowReasoning = supportsReasoning(`openai:${input.model}`)
    const baseURL = this.resolveCompatBaseURL(input.baseURL, input.providerType)
    const url = `${baseURL}/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      signal: abortSignal,
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: input.model,
        stream: true,
        messages: input.messages,
        tools: input.tools,
        temperature: input.params.temperature,
        top_p: input.params.topP,
        max_tokens: input.params.maxOutputTokens,
        presence_penalty: input.params.presencePenalty,
        frequency_penalty: input.params.frequencyPenalty,
        stop: input.params.stopSequences,
        seed: input.params.seed
      })
    })

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let reasoning = ''
    const thinkTagState = allowReasoning ? createThinkTagStreamState(input.model) : undefined

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          if (allowReasoning && thinkTagState) {
            const tail = finalizeThinkTagStream(thinkTagState)
            if (tail.reasoning) {
              reasoning += tail.reasoning
              this.emitReasoningChunk(onChunk, tail.reasoning)
            }
            if (tail.content) {
              content += tail.content
              this.emitTextChunk(onChunk, tail.content)
            }
          }
          return { content, reasoning }
        }
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta || {}
          const reasoningChunk = delta.reasoning_content || delta.reasoning
          const contentChunk = delta.content
          const hasStructuredReasoning = !!reasoningChunk && allowReasoning

          if (reasoningChunk && allowReasoning) {
            reasoning += reasoningChunk
            this.emitReasoningChunk(onChunk, reasoningChunk)
          }
          if (contentChunk) {
            const contentText = String(contentChunk)
            if (allowReasoning && thinkTagState) {
              const parsed = parseThinkTaggedChunk(contentText, thinkTagState)
              if (parsed.reasoning && !hasStructuredReasoning) {
                reasoning += parsed.reasoning
                this.emitReasoningChunk(onChunk, parsed.reasoning)
              }
              if (parsed.content) {
                content += parsed.content
                this.emitTextChunk(onChunk, parsed.content)
              }
            } else {
              content += contentText
              this.emitTextChunk(onChunk, contentText)
            }
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    if (allowReasoning && thinkTagState) {
      const tail = finalizeThinkTagStream(thinkTagState)
      if (tail.reasoning) {
        reasoning += tail.reasoning
        this.emitReasoningChunk(onChunk, tail.reasoning)
      }
      if (tail.content) {
        content += tail.content
        this.emitTextChunk(onChunk, tail.content)
      }
    }

    return { content, reasoning }
  }

  private async runOpenAICompatToolLoop(
    input: {
      model: string
      providerType?: string
      messages: any[]
      apiKey?: string
      baseURL?: string
      params: AiModelParameters
      tools: AiTool[]
      maxToolSteps?: number
      toolContext?: AiToolContext
      allowReasoning: boolean
    },
    onChunk?: (chunk: AiMessage) => void,
    abortSignal?: AbortSignal
  ): Promise<{ content: string; reasoning: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
    const maxSteps = Math.min(Math.max(Math.floor(input.maxToolSteps ?? 10), 1), 20)
    const conversationMessages = [...input.messages]
    let fullContent = ''
    let fullReasoning = ''
    let inputTokens = 0
    let outputTokens = 0
    let hasInputUsage = false
    let hasOutputUsage = false

    for (let step = 0; step < maxSteps; step += 1) {
      const stepResult = await this.streamOpenAICompatToolStep({
        model: input.model,
        providerType: input.providerType,
        messages: conversationMessages,
        apiKey: input.apiKey,
        baseURL: input.baseURL,
        params: input.params,
        tools: input.tools,
        allowReasoning: input.allowReasoning
      }, onChunk, abortSignal)

      if (stepResult.usage?.inputTokens !== undefined) {
        inputTokens += stepResult.usage.inputTokens
        hasInputUsage = true
      }
      if (stepResult.usage?.outputTokens !== undefined) {
        outputTokens += stepResult.usage.outputTokens
        hasOutputUsage = true
      }

      if (stepResult.content) fullContent += stepResult.content
      if (stepResult.reasoning && input.allowReasoning) fullReasoning += stepResult.reasoning

      const assistantMessage: any = {
        role: 'assistant',
        content: stepResult.content || ''
      }
      if (input.allowReasoning && stepResult.reasoning) {
        assistantMessage.reasoning_content = stepResult.reasoning
      }
      if (stepResult.toolCalls.length > 0) {
        assistantMessage.tool_calls = stepResult.toolCalls
      }
      conversationMessages.push(assistantMessage)

      const needsToolRound = stepResult.finishReason === 'tool_calls' || stepResult.toolCalls.length > 0
      if (!needsToolRound) {
        return {
          content: fullContent,
          reasoning: fullReasoning,
          usage: hasInputUsage || hasOutputUsage
            ? {
                inputTokens: hasInputUsage ? inputTokens : undefined,
                outputTokens: hasOutputUsage ? outputTokens : undefined
              }
            : undefined
        }
      }

      if (!this.toolExecutor) {
        throw new Error('AI tool executor is not configured')
      }

      for (const call of stepResult.toolCalls) {
        const toolName = call.function?.name
        if (!toolName) continue

        const rawArgs = call.function?.arguments || '{}'
        let parsedArgs: unknown = {}
        try {
          parsedArgs = rawArgs ? JSON.parse(rawArgs) : {}
        } catch {
          parsedArgs = rawArgs
        }

        this.emitToolCallChunk(onChunk, {
          id: call.id,
          name: toolName,
          args: parsedArgs
        })

        console.log('[AI] 工具执行开始', { toolName, input: parsedArgs, context: input.toolContext })
        let result: unknown
        try {
          result = await this.toolExecutor({ name: toolName, args: parsedArgs, context: input.toolContext })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`[AI_TOOL_EXECUTION_ERROR] ${toolName}: ${message}`)
        }
        console.log('[AI] 工具执行完成', { toolName, result })

        this.emitToolResultChunk(onChunk, {
          id: call.id,
          name: toolName,
          result
        })

        conversationMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: stringifyToolResult(result)
        })
      }
    }

    throw new Error(`Tool execution exceeded maxToolSteps (${maxSteps})`)
  }

  private async streamOpenAICompatToolStep(
    input: {
      model: string
      providerType?: string
      messages: any[]
      apiKey?: string
      baseURL?: string
      params: AiModelParameters
      tools: AiTool[]
      allowReasoning: boolean
    },
    onChunk?: (chunk: AiMessage) => void,
    abortSignal?: AbortSignal
  ): Promise<{
    content: string
    reasoning: string
    toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    finishReason?: string
    usage?: { inputTokens?: number; outputTokens?: number }
  }> {
    const baseURL = this.resolveCompatBaseURL(input.baseURL, input.providerType)
    const url = `${baseURL}/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      signal: abortSignal,
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: input.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: input.messages,
        tools: input.tools,
        tool_choice: 'auto',
        temperature: input.params.temperature,
        top_p: input.params.topP,
        max_tokens: input.params.maxOutputTokens,
        presence_penalty: input.params.presencePenalty,
        frequency_penalty: input.params.frequencyPenalty,
        stop: input.params.stopSequences,
        seed: input.params.seed
      })
    })

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let reasoning = ''
    let finishReason: string | undefined
    let usage: { inputTokens?: number; outputTokens?: number } | undefined
    const thinkTagState = input.allowReasoning ? createThinkTagStreamState(input.model) : undefined
    const toolCallsMap = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>()

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          if (input.allowReasoning && thinkTagState) {
            const tail = finalizeThinkTagStream(thinkTagState)
            if (tail.reasoning) {
              reasoning += tail.reasoning
              this.emitReasoningChunk(onChunk, tail.reasoning)
            }
            if (tail.content) {
              content += tail.content
              this.emitTextChunk(onChunk, tail.content)
            }
          }
          const toolCalls = [...toolCallsMap.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([index, call]) => ({
              ...call,
              id: call.id || `call_${index}`
            }))

          return {
            content,
            reasoning,
            toolCalls,
            finishReason: finishReason || (toolCalls.length > 0 ? 'tool_calls' : undefined),
            usage
          }
        }

        try {
          const json = JSON.parse(data)
          usage = extractUsage(json) || usage

          const choice = json.choices?.[0]
          if (!choice) continue
          const contentSource = pickOpenAICompatContentSource(choice)
          if (!contentSource) {
            if (choice.finish_reason) {
              finishReason = choice.finish_reason
            }
            continue
          }

          const reasoningChunk = contentSource.reasoning_content || contentSource.reasoning
          const hasStructuredReasoning = !!reasoningChunk && input.allowReasoning
          if (reasoningChunk && input.allowReasoning) {
            const reasoningText = String(reasoningChunk)
            reasoning += reasoningText
            this.emitReasoningChunk(onChunk, reasoningText)
          }

          const contentChunk = extractOpenAICompatContentText(contentSource.content)
          if (contentChunk) {
            if (input.allowReasoning && thinkTagState) {
              const parsed = parseThinkTaggedChunk(contentChunk, thinkTagState)
              if (parsed.reasoning && !hasStructuredReasoning) {
                reasoning += parsed.reasoning
                this.emitReasoningChunk(onChunk, parsed.reasoning)
              }
              if (parsed.content) {
                content += parsed.content
                this.emitTextChunk(onChunk, parsed.content)
              }
            } else {
              content += contentChunk
              this.emitTextChunk(onChunk, contentChunk)
            }
          }

          if (Array.isArray(contentSource.tool_calls)) {
            for (const chunk of contentSource.tool_calls) {
              const index = typeof chunk?.index === 'number' ? chunk.index : 0
              const current = toolCallsMap.get(index) || {
                id: '',
                type: 'function' as const,
                function: { name: '', arguments: '' }
              }
              if (chunk?.id) current.id = chunk.id
              if (chunk?.type === 'function') current.type = 'function'
              if (chunk?.function?.name) current.function.name += chunk.function.name
              if (chunk?.function?.arguments) current.function.arguments += chunk.function.arguments
              toolCallsMap.set(index, current)
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    const toolCalls = [...toolCallsMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, call]) => ({
        ...call,
        id: call.id || `call_${index}`
      }))

    if (input.allowReasoning && thinkTagState) {
      const tail = finalizeThinkTagStream(thinkTagState)
      if (tail.reasoning) {
        reasoning += tail.reasoning
        this.emitReasoningChunk(onChunk, tail.reasoning)
      }
      if (tail.content) {
        content += tail.content
        this.emitTextChunk(onChunk, tail.content)
      }
    }

    return {
      content,
      reasoning,
      toolCalls,
      finishReason: finishReason || (toolCalls.length > 0 ? 'tool_calls' : undefined),
      usage
    }
  }

  private resolveTestModel(input?: { model?: string; providerId?: string; apiKey?: string; baseURL?: string }) {
    if (!input?.providerId) {
      return this.resolveLanguageModel(input?.model)
    }

    const modelId = input.model?.includes(':') ? input.model.split(':', 2)[1] : input.model
    if (!modelId) {
      throw new Error('Model is required for provider test')
    }

    const configured = this.resolveProviderById(input.providerId)
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
    const resolvedModelConfig = this.resolveModelConfig(input.model)
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

  private resolveTestInput(input?: { model?: string; providerId?: string; apiKey?: string; baseURL?: string }) {
    if (!input?.model || input.providerId) return input
    const providerConfig = this.resolveProviderConfig(input.model)
    if (!providerConfig?.id) return input

    return {
      ...input,
      providerId: providerConfig.id,
      apiKey: input.apiKey ?? providerConfig.apiKey,
      baseURL: input.baseURL ?? providerConfig.baseURL
    }
  }

  private async toOpenAIChatMessages(
    messages: AiMessage[],
    modelId?: string,
    options?: { includeReasoningContent?: boolean }
  ) {
    const maxFileBytes = 512 * 1024
    const { providerConfig } = this.resolveExecutionProviderContext(modelId)
    const allowImages = supportsImageInput(modelId, providerConfig)
    const results: Array<{
      role: 'system' | 'user' | 'assistant'
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } }
          >
    }> = []

    for (const message of messages) {
      if (typeof message.content === 'string' || message.content === undefined) {
        const chatMessage: any = { role: message.role, content: message.content || '' }
        if (options?.includeReasoningContent && message.role === 'assistant' && message.reasoning_content) {
          chatMessage.reasoning_content = message.reasoning_content
        }
        results.push(chatMessage)
        continue
      }

      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      > = []

      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text })
          continue
        }
        if (part.type === 'image') {
          if (!allowImages) {
            parts.push({ type: 'text', text: '[image omitted: provider/model does not support image input]' })
            continue
          }
          const data = await attachmentStore.read(part.attachmentId)
          const mimeType = part.mimeType || 'image/png'
          const base64 = Buffer.from(data as any).toString('base64')
          parts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } })
          continue
        }
        if (part.type === 'file') {
          const attachment = attachmentStore.get(part.attachmentId)
          const data = await attachmentStore.read(part.attachmentId)
          const buffer = Buffer.from(data as any)
          const filename = part.filename || attachment?.filename || 'attachment'
          const mimeType = part.mimeType || attachment?.mimeType || 'application/octet-stream'
          if (buffer.length > maxFileBytes) {
            parts.push({
              type: 'text',
              text: `File ${filename} (${mimeType}) is too large to inline (${buffer.length} bytes).`
            })
            continue
          }
          const base64 = buffer.toString('base64')
          parts.push({
            type: 'text',
            text: `File ${filename} (${mimeType}) base64:\\n${base64}`
          })
        }
      }

      const chatMessage: any = { role: message.role, content: parts.length > 0 ? parts : '' }
      if (options?.includeReasoningContent && message.role === 'assistant' && message.reasoning_content) {
        chatMessage.reasoning_content = message.reasoning_content
      }
      results.push(chatMessage)
    }

    return results
  }

  private buildTools(tools?: AiTool[], context?: AiToolContext, modelId?: string) {
    if (!tools || tools.length === 0) return undefined
    if (modelId && !supportsFunctionCalling(modelId)) {
      console.log('[AI] buildTools: 模型不支持 function calling', { modelId })
      return undefined
    }
    if (modelId) {
      const toolNames = tools
        .map((item) => item?.type === 'function' ? item.function?.name : undefined)
        .filter((name): name is string => !!name)
        .map((name) => name.toLowerCase())
      if (toolNames.some((name) => name.includes('web_search') || name.includes('web-search'))) {
        if (!supportsWebSearch(modelId)) {
          throw new Error('Model does not support web_search capability')
        }
      }
      if (toolNames.some((name) => name.includes('embedding') || name.includes('embed'))) {
        if (!supportsEmbedding(modelId)) {
          throw new Error('Model does not support embedding capability')
        }
      }
      if (toolNames.some((name) => name.includes('rerank') || name.includes('re-rank'))) {
        if (!supportsRerank(modelId)) {
          throw new Error('Model does not support rerank capability')
        }
      }
    }
    if (!this.toolExecutor) {
      console.error('[AI] buildTools: toolExecutor 未配置')
      throw new Error('AI tool executor is not configured')
    }
    console.log('[AI] buildTools: 构建工具', {
      toolCount: tools.length,
      toolNames: tools.map(t => t.function?.name),
      hasExecutor: !!this.toolExecutor,
      context
    })
    const toolEntries = tools
      .map((item) => (item?.type === 'function' ? item.function : undefined))
      .filter((item): item is NonNullable<AiTool['function']> => !!item && !!item.name)
      .map((fn) => {
        const schema = fn.parameters || { type: 'object', properties: {} }
        return [
          fn.name,
          tool({
            description: fn.description,
          inputSchema: jsonSchema(schema as any),
          execute: async (input: unknown) => {
            console.log('[AI] 工具执行开始', { toolName: fn.name, input, context })
            let result: unknown
            try {
              result = await this.toolExecutor?.({ name: fn.name, args: input, context })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              throw new Error(`[AI_TOOL_EXECUTION_ERROR] ${fn.name}: ${message}`)
            }
            console.log('[AI] 工具执行完成', { toolName: fn.name, result })
            return result
          }
        })
      ] as const
      })

    if (toolEntries.length === 0) return undefined
    return Object.fromEntries(toolEntries)
  }

  async fetchModels(input: { providerId: string; baseURL?: string; apiKey?: string }): Promise<{ models: AiModel[]; message?: string }> {
    const configuredProvider = this.resolveProviderById(input.providerId)
    const providerType = getProviderType(
      configuredProvider || {
        id: input.providerId,
        type: input.providerId,
        enabled: true,
        baseURL: input.baseURL,
        apiKey: input.apiKey
      }
    )
    const mergedProvider: AiProviderConfig = {
      id: String(configuredProvider?.id || input.providerId),
      type: providerType,
      enabled: true,
      apiKey: input.apiKey || configuredProvider?.apiKey,
      baseURL: input.baseURL || configuredProvider?.baseURL,
      headers: configuredProvider?.headers
    }
    const providerIdCounts = buildProviderIdCounts(getAiSettings().providers)
    const fetchCapability = getProviderProtocolCapabilityRule(mergedProvider, 'models-fetch', providerIdCounts)
    console.info('[AI] capability:protocol', {
      stage: 'fetchModels',
      providerId: input.providerId,
      providerType,
      capability: fetchCapability.capability,
      enabled: fetchCapability.enabled,
      source: fetchCapability.source,
      reason: fetchCapability.reason
    })
    if (!fetchCapability.enabled) {
      return { models: [], message: fetchCapability.reason }
    }
    const methodAdapter = getProviderMethodAdapter(providerType)
    const providerId = String(configuredProvider?.id || input.providerId)
    const baseURL = this.resolveModelDiscoveryBaseURL(input.baseURL || configuredProvider?.baseURL, providerType)
    const result = await methodAdapter.fetchModels({
      executeModelDiscovery: async ({ endpoint, parseModelIds }) => {
        const url = `${baseURL.replace(/\/$/, '')}${endpoint}`
        try {
          const apiKey = input.apiKey || configuredProvider?.apiKey
          console.info('[AI] fetchModels:start', { providerId, providerType, url })
          const res = await fetch(url, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
          })
          if (!res.ok) {
            const body = await res.text().catch(() => '')
            console.warn('[AI] fetchModels:fail', { status: res.status, statusText: res.statusText, body })
            return { models: [], message: `拉取失败：${res.status} ${res.statusText}${body ? ` - ${body}` : ''}` }
          }
          const payload = await res.json()
          const modelIds = parseModelIds(payload)
          const models = modelIds.map((id) => ({
            id: `${providerId}:${id}`,
            label: id,
            description: '',
            providerRef: providerId
          }))
          console.info('[AI] fetchModels:success', { count: models.length })
          return { models }
        } catch (err) {
          const message = err instanceof Error ? err.message : '拉取模型失败'
          console.error('[AI] fetchModels:error', { error: message })
          return { models: [], message }
        }
      }
    })
    if (result.models.length > 0) {
      return result
    }

    const fallbackModels = this.getSystemFallbackModels(providerId)
    if (fallbackModels.length === 0) {
      return result
    }

    console.info('[AI] fetchModels:fallback', { providerId, providerType, count: fallbackModels.length })
    const fallbackMessage = `自动发现失败，已回退到内置模型（${fallbackModels.length} 个）`
    return {
      models: fallbackModels,
      message: result.message ? `${result.message}；${fallbackMessage}` : fallbackMessage
    }
  }

  private async executeImageWithRetry<T>(
    stage: 'generateImages' | 'editImage',
    execute: () => Promise<T>,
    context: Record<string, unknown>
  ): Promise<T> {
    const maxAttempts = 2
    let attempt = 0
    while (attempt < maxAttempts) {
      attempt += 1
      try {
        return await execute()
      } catch (error) {
        const classified = classifyAiImageError(error)
        const finalAttempt = attempt >= maxAttempts
        if (!classified.retryable || finalAttempt) {
          if (classified.retryable && finalAttempt) {
            console.warn('[AI] image:retry:exhausted', {
              stage,
              attempt,
              maxAttempts,
              code: classified.code,
              statusCode: classified.statusCode,
              message: classified.message,
              ...context
            })
          }
          throw error
        }

        const delayMs = attempt * 800
        console.warn('[AI] image:retry', {
          stage,
          attempt,
          maxAttempts,
          delayMs,
          code: classified.code,
          statusCode: classified.statusCode,
          message: classified.message,
          ...context
        })
        await sleep(delayMs)
      }
    }

    throw new Error('Unexpected image retry state')
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
    let streamed: { images: string[] } | null = null
    try {
      streamed = await this.streamOpenAIImageGeneration({
        modelId: getImageModelIdFromModelKey(input.modelKey),
        prompt: typeof input.prompt === 'string' ? input.prompt : input.prompt.text || '',
        size: input.size,
        n: input.n,
        providerType: input.providerType,
        providerConfig: input.providerConfig,
        abortSignal: input.abortSignal,
        onChunk: input.onChunk
      })
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw error
      }
      console.warn('[AI] image:stream:unavailable', {
        message: getErrorMessageForLog(error),
        size: input.size,
        count: input.n
      })
    }

    if (streamed && streamed.images.length > 0) {
      return { images: streamed.images }
    }

    input.onChunk?.({
      type: 'status',
      stage: 'fallback',
      message: '流式进度不可用，回退到普通生成...'
    })

    return await this.generateImageWithDecodeFallback(input)
  }

  private async streamOpenAIImageGeneration(input: {
    modelId?: string
    prompt: string
    size?: string
    n?: number
    providerType?: string
    providerConfig?: AiProviderConfig
    abortSignal?: AbortSignal
    onChunk?: (chunk: AiImageGenerateProgressChunk) => void
  }): Promise<{ images: string[] } | null> {
    if (!input.modelId || !input.prompt) return null

    const type = String(input.providerType || '').trim().toLowerCase()
    if (
      !['openai', 'openai-response', 'openai-compatible', 'new-api', 'cherryin', 'deepseek', 'openrouter', 'azure-openai', 'azure', 'ollama'].includes(type)
    ) {
      return null
    }

    const baseURL = this.resolveCompatBaseURL(input.providerConfig?.baseURL, input.providerType)
    const url = `${baseURL.replace(/\/$/, '')}/images/generations`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(input.providerConfig?.headers || {})
    }
    if (input.providerConfig?.apiKey) {
      headers.Authorization = `Bearer ${input.providerConfig.apiKey}`
    }

    const streamController = new AbortController()
    const relayAbort = () => streamController.abort(input.abortSignal?.reason)
    if (input.abortSignal) {
      if (input.abortSignal.aborted) {
        streamController.abort(input.abortSignal.reason)
      } else {
        input.abortSignal.addEventListener('abort', relayAbort, { once: true })
      }
    }

    const firstByteTimeoutMs = 12000
    let firstByteReceived = false
    const firstByteTimer = setTimeout(() => {
      if (!firstByteReceived) {
        streamController.abort(new Error(`AI_IMAGE_STREAM_FIRST_BYTE_TIMEOUT_${firstByteTimeoutMs}ms`))
      }
    }, firstByteTimeoutMs)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: streamController.signal,
      body: JSON.stringify({
        model: input.modelId,
        prompt: input.prompt,
        n: Math.max(1, Number(input.n || 1)),
        size: input.size,
        response_format: 'b64_json',
        stream: true,
        partial_images: 2
      })
    })

    if (!response.ok) {
      clearTimeout(firstByteTimer)
      if (input.abortSignal) input.abortSignal.removeEventListener('abort', relayAbort)
      const body = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`)
    }
    if (!response.body) {
      clearTimeout(firstByteTimer)
      if (input.abortSignal) input.abortSignal.removeEventListener('abort', relayAbort)
      return null
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const partialImages = new Map<number, string>()
    const finalRaw: string[] = []
    let buffer = ''
    let sawSseData = false
    const heartbeatStartAt = Date.now()
    const heartbeatTimer = setInterval(() => {
      input.onChunk?.({
        type: 'status',
        stage: 'partial',
        message: `生成中... ${Math.floor((Date.now() - heartbeatStartAt) / 1000)}s`
      })
    }, 3000)

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (!firstByteReceived) {
          firstByteReceived = true
          clearTimeout(firstByteTimer)
          input.onChunk?.({
            type: 'status',
            stage: 'partial',
            message: '已建立流式连接，等待分片...'
          })
        }
        buffer += decoder.decode(value, { stream: true })

        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')

          if (!line || !line.startsWith('data:')) continue
          sawSseData = true
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue

          let payload: any
          try {
            payload = JSON.parse(data)
          } catch {
            continue
          }

          const parsed = extractOpenAIImageStreamPayload(payload)
          for (const partial of parsed.partials) {
            const index = partialImages.size
            partialImages.set(index, partial)
            input.onChunk?.({
              type: 'preview',
              stage: 'partial',
              image: partial,
              index,
              received: partialImages.size,
              total: input.n || 1
            })
          }
          for (const item of parsed.finals) {
            finalRaw.push(item)
          }
        }
      }

      if (!sawSseData) {
        const payloadText = buffer.trim()
        if (!payloadText) return null
        let payload: any
        try {
          payload = JSON.parse(payloadText)
        } catch {
          return null
        }
        const parsed = extractOpenAIImageStreamPayload(payload)
        finalRaw.push(...parsed.finals)
      }

      input.onChunk?.({
        type: 'status',
        stage: 'finalizing',
        message: '正在整理最终图片...'
      })

      const normalized = finalRaw.length > 0
        ? await this.normalizeRawGeneratedImages(finalRaw, input.abortSignal)
        : await this.normalizeRawGeneratedImages([...partialImages.values()], input.abortSignal)

      if (normalized.length === 0) return null
      return { images: normalized }
    } finally {
      clearTimeout(firstByteTimer)
      clearInterval(heartbeatTimer)
      if (input.abortSignal) input.abortSignal.removeEventListener('abort', relayAbort)
    }
  }

  private async generateImageWithDecodeFallback(input: {
    modelKey: any
    prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
    size?: string
    n?: number
    abortSignal?: AbortSignal
  }): Promise<{ images: string[] }> {
    const directStart = Date.now()
    try {
      const images = await this.generateImageByDirectModelCall(input)
      console.info('[AI] image:generate:result', {
        stage: 'direct',
        count: images.length,
        firstPreview: images[0] ? String(images[0]).slice(0, 24) : '',
        durationMs: Date.now() - directStart
      })
      return { images }
    } catch (error) {
      console.warn('[AI] image:direct:failed', {
        message: getErrorMessageForLog(error),
        size: input.size,
        count: input.n
      })

      const sdkStart = Date.now()
      try {
        const result = await generateImage({
          model: input.modelKey,
          prompt: input.prompt as any,
          size: input.size as any,
          n: input.n,
          abortSignal: input.abortSignal
        } as any)
        const images = (result as any).images?.map((img: any) => img.base64) || []
        console.info('[AI] image:generate:result', {
          stage: 'sdk',
          count: images.length,
          firstPreview: images[0] ? String(images[0]).slice(0, 24) : '',
          durationMs: Date.now() - sdkStart
        })
        return { images }
      } catch (sdkError) {
        if (!isImageBase64DecodeError(sdkError)) {
          throw sdkError
        }
        console.warn('[AI] image:decode:fallback', {
          message: getErrorMessageForLog(sdkError),
          size: input.size,
          count: input.n
        })
        const images = await this.generateImageByDirectModelCall(input)
        console.info('[AI] image:generate:result', {
          stage: 'fallback',
          count: images.length,
          firstPreview: images[0] ? String(images[0]).slice(0, 24) : '',
          durationMs: Date.now() - sdkStart
        })
        return { images }
      }
    }
  }

  private async generateImageByDirectModelCall(input: {
    modelKey: any
    prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
    size?: string
    n?: number
    abortSignal?: AbortSignal
  }): Promise<string[]> {
    const model = input.modelKey as { doGenerate?: (options: any) => Promise<any> }
    if (!model || typeof model.doGenerate !== 'function') {
      throw new Error('Image model does not support direct doGenerate fallback')
    }

    const promptPayload = this.toDirectImagePrompt(input.prompt)
    const response = await model.doGenerate({
      prompt: promptPayload.prompt,
      files: promptPayload.files,
      mask: promptPayload.mask,
      n: Math.max(1, Number(input.n || 1)),
      size: input.size,
      aspectRatio: undefined,
      seed: undefined,
      providerOptions: {},
      headers: undefined,
      abortSignal: input.abortSignal
    })
    return await this.normalizeRawGeneratedImages(response?.images, input.abortSignal)
  }

  private toDirectImagePrompt(
    prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
  ): { prompt?: string; files?: Array<{ type: 'file' | 'url'; mediaType?: string; data?: string | Uint8Array; url?: string }>; mask?: { type: 'file'; mediaType: string; data: string | Uint8Array } } {
    if (typeof prompt === 'string') {
      return { prompt }
    }

    const files = Array.isArray(prompt.images)
      ? prompt.images.map((item) => this.toDirectImageFile(item))
      : undefined
    const mask = prompt.mask ? this.toDirectImageMask(prompt.mask) : undefined
    return {
      prompt: prompt.text,
      files: files && files.length > 0 ? files : undefined,
      mask
    }
  }

  private toDirectImageFile(
    image: unknown
  ): { type: 'file'; mediaType: string; data: string | Uint8Array } | { type: 'url'; url: string } {
    if (typeof image === 'string') {
      const value = image.trim()
      if (isHttpUrl(value)) {
        return { type: 'url', url: value }
      }
      const dataUrl = parseDataUrl(value)
      if (dataUrl) {
        return {
          type: 'file',
          mediaType: dataUrl.mediaType || 'image/png',
          data: dataUrl.base64
        }
      }
      const normalized = normalizeBase64Text(value)
      if (normalized) {
        return { type: 'file', mediaType: 'image/png', data: normalized }
      }
      throw new Error('Unsupported image input string format for direct image fallback')
    }

    if (Buffer.isBuffer(image)) {
      const bytes = new Uint8Array(image)
      return { type: 'file', mediaType: detectImageMimeTypeFromBytes(bytes), data: bytes }
    }
    if (image instanceof Uint8Array) {
      return { type: 'file', mediaType: detectImageMimeTypeFromBytes(image), data: image }
    }
    if (image instanceof ArrayBuffer) {
      const bytes = new Uint8Array(image)
      return { type: 'file', mediaType: detectImageMimeTypeFromBytes(bytes), data: bytes }
    }

    throw new Error('Unsupported image input payload for direct image fallback')
  }

  private toDirectImageMask(mask: unknown): { type: 'file'; mediaType: string; data: string | Uint8Array } {
    const file = this.toDirectImageFile(mask)
    if (file.type === 'url') {
      throw new Error('Mask URL is not supported in direct image fallback')
    }
    return file
  }

  private async normalizeRawGeneratedImages(images: unknown, abortSignal?: AbortSignal): Promise<string[]> {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Image provider returned empty images payload')
    }

    const results: string[] = []
    for (const item of images) {
      if (item instanceof Uint8Array) {
        results.push(Buffer.from(item).toString('base64'))
        continue
      }

      if (typeof item === 'string') {
        const value = item.trim()
        const dataUrl = parseDataUrl(value)
        if (dataUrl) {
          results.push(dataUrl.base64)
          continue
        }

        const normalized = normalizeBase64Text(value)
        if (normalized) {
          results.push(normalized)
          continue
        }

        if (isHttpUrl(value)) {
          const response = await fetch(value, { signal: abortSignal })
          if (!response.ok) {
            throw new Error(`Failed to fetch image URL payload: ${response.status} ${response.statusText}`)
          }
          const bytes = new Uint8Array(await response.arrayBuffer())
          results.push(Buffer.from(bytes).toString('base64'))
          continue
        }
      }

      throw new Error('Unsupported image output payload for direct image fallback')
    }

    return results
  }

  private resolveLanguageModel(modelId?: string): { model: string; modelKey: any } {
    const { providerId, modelId: resolvedId } = resolveModelId(modelId)
    if (!hasProvider(providerId)) {
      throw new Error(`AI provider not available: ${providerId}`)
    }
    const { providerType, providerConfig } = this.resolveExecutionProviderContext(modelId, providerId)
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

  private resolveImageModel(modelId?: string): { model: string; modelKey: any } {
    const { providerId, modelId: resolvedId } = resolveModelId(modelId)
    if (!hasProvider(providerId)) {
      throw new Error(`AI provider not available: ${providerId}`)
    }

    const { providerType, providerConfig } = this.resolveExecutionProviderContext(modelId, providerId)
    const runtime = createProviderRuntime(providerConfig, providerType)
    const runtimeType = runtime.type
    console.info('[AI] resolveImageModel', {
      modelInput: modelId,
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

  private async toSdkMessages(messages: AiMessage[], modelId?: string) {
    const { providerType, providerConfig } = this.resolveExecutionProviderContext(modelId)
    const results: any[] = []
    for (const message of messages) {
      if (typeof message.content === 'string' || message.content === undefined) {
        results.push({ role: message.role, content: message.content || '' })
        continue
      }

      const parts: any[] = []
      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text })
        } else if (part.type === 'image') {
          if (!supportsImageInput(modelId, providerConfig)) {
            parts.push({ type: 'text', text: '[image omitted: provider/model does not support image input]' })
            continue
          }
          const image = await attachmentStore.read(part.attachmentId)
          let mediaType = part.mimeType
          if (providerType === 'anthropic' && mediaType === 'image/jpg') {
            mediaType = 'image/jpeg'
          }
          parts.push({ type: 'image', image, mediaType })
        } else if (part.type === 'file') {
          const attachment = attachmentStore.get(part.attachmentId)
          const filename = part.filename || attachment?.filename || 'attachment'
          const mimeType = part.mimeType || attachment?.mimeType || 'application/octet-stream'
          const size = attachment?.size ?? 0
          const sizeLimit = getFileSizeLimit(modelId, providerConfig, mimeType)

          if (mimeType === 'application/pdf' && supportsPdfInput(modelId, providerConfig)) {
            if (size > sizeLimit && supportsLargeFileUpload(modelId, providerConfig)) {
              const remote = await this.uploadAttachmentToProviderInternal({
                attachmentId: part.attachmentId,
                filename,
                mimeType,
                purpose: this.getUploadPurpose(modelId)
              }, providerConfig)
              if (remote) {
                if (providerType === 'openai') {
                  parts.push({
                    type: 'file',
                    data: `fileid://${remote.fileId}`,
                    mediaType: mimeType,
                    filename
                  })
                  continue
                }
                if (remote.uri) {
                  parts.push({
                    type: 'file',
                    data: remote.uri,
                    mediaType: mimeType,
                    filename
                  })
                  continue
                }
              }
            }
          }

          const data = await attachmentStore.read(part.attachmentId)
          parts.push({ type: 'file', data, mediaType: mimeType, filename })
        }
      }

      results.push({ role: message.role, content: parts })
    }

    return results
  }

  private hasMultimodalContent(messages: AiMessage[]): boolean {
    return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type !== 'text'))
  }

  private emitChunk(onChunk: ((chunk: AiMessage) => void) | undefined, chunk: AiMessage): void {
    if (!onChunk) return
    onChunk(chunk)
  }

  private emitTextChunk(onChunk: ((chunk: AiMessage) => void) | undefined, text: string): void {
    this.emitChunk(onChunk, createTextChunk(text))
  }

  private emitReasoningChunk(onChunk: ((chunk: AiMessage) => void) | undefined, text: string): void {
    this.emitChunk(onChunk, createReasoningChunk(text))
  }

  private emitToolCallChunk(
    onChunk: ((chunk: AiMessage) => void) | undefined,
    toolCall: { id: string; name: string; args?: unknown }
  ): void {
    this.emitChunk(onChunk, createToolCallChunk(toolCall))
  }

  private emitToolResultChunk(
    onChunk: ((chunk: AiMessage) => void) | undefined,
    toolResult: { id: string; name: string; result?: unknown }
  ): void {
    this.emitChunk(onChunk, createToolResultChunk(toolResult))
  }

  private emitErrorChunk(
    onChunk: ((chunk: AiMessage) => void) | undefined,
    error: Error,
    classification?: Parameters<typeof createErrorChunk>[1]
  ): void {
    this.emitChunk(onChunk, createErrorChunk(error, classification))
  }

  private emitEndChunk(onChunk: ((chunk: AiMessage) => void) | undefined, message: AiMessage): void {
    this.emitChunk(onChunk, createEndChunk(message))
  }

  private resolveCompatBaseURL(explicitBaseURL?: string, providerType?: string): string {
    const normalizedType = String(providerType || '').trim().toLowerCase()
    const resolved = resolveProviderBaseURL({
      providerType,
      baseURL: explicitBaseURL
    })
    if (resolved) {
      const normalizedResolved = resolved.replace(/\/+$/, '')
      if (normalizedType === 'ollama') {
        return /\/v1$/i.test(normalizedResolved) ? normalizedResolved : `${normalizedResolved}/v1`
      }
      return normalizedResolved
    }
    if (normalizedType === 'openai-compatible' || normalizedType === 'azure' || normalizedType === 'azure-openai') {
      throw new Error(`Provider 类型 ${normalizedType} 需要填写 Base URL`)
    }
    const fallback = 'https://api.openai.com/v1'
    return fallback.replace(/\/+$/, '')
  }

  private resolveModelDiscoveryBaseURL(explicitBaseURL?: string, providerType?: string): string {
    const baseURL = this.resolveCompatBaseURL(explicitBaseURL, providerType)
    const normalizedType = String(providerType || '').trim().toLowerCase()
    if (normalizedType === 'ollama') {
      return baseURL.replace(/\/v1$/i, '')
    }
    return baseURL
  }

  private getSystemFallbackModels(providerId: string): AiModel[] {
    const normalizedProviderId = String(providerId || '').trim()
    if (!normalizedProviderId) return []
    return getSystemDefaultModels().filter((model) => String(model.providerRef || '') === normalizedProviderId)
  }

  private async toAnthropicMessages(messages: AiMessage[], modelId: string | undefined, providerConfig?: AiProviderConfig) {
    let systemText = ''
    const results: Array<{
      role: 'user' | 'assistant'
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
        | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } | { type: 'file'; file_id: string }; title?: string }
      >
    }> = []

    for (const message of messages) {
      if (typeof message.content === 'string' || message.content === undefined) {
        if (message.role === 'system') {
          systemText += `${message.content || ''}\n`
          continue
        }
        results.push({ role: message.role, content: [{ type: 'text', text: message.content || '' }] })
        continue
      }

      const parts: Array<any> = []
      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text })
          continue
        }
        if (part.type === 'image') {
          const image = await attachmentStore.read(part.attachmentId)
          let mediaType = part.mimeType || 'image/png'
          if (mediaType === 'image/jpg') mediaType = 'image/jpeg'
          parts.push({
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: Buffer.from(image).toString('base64') }
          })
          continue
        }
        if (part.type === 'file') {
          const attachment = attachmentStore.get(part.attachmentId)
          const filename = part.filename || attachment?.filename || 'document'
          const mimeType = part.mimeType || attachment?.mimeType || 'application/octet-stream'

          if (mimeType === 'application/pdf' || mimeType === 'text/plain') {
            const remote = await this.uploadAttachmentToProviderInternal({
              attachmentId: part.attachmentId,
              filename,
              mimeType,
              purpose: this.getUploadPurpose(modelId)
            }, providerConfig)

            if (remote?.fileId) {
              parts.push({
                type: 'document',
                source: { type: 'file', file_id: remote.fileId },
                title: filename
              })
              continue
            }

            const data = await attachmentStore.read(part.attachmentId)
            if (mimeType === 'text/plain') {
              parts.push({
                type: 'document',
                source: { type: 'base64', media_type: 'text/plain', data: Buffer.from(data).toString('base64') },
                title: filename
              })
              continue
            }
            parts.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(data).toString('base64') },
              title: filename
            })
            continue
          }

          parts.push({ type: 'text', text: `[file omitted: ${filename} (${mimeType}) is not supported by Anthropic]` })
        }
      }

      if (message.role === 'system') {
        const merged = parts
          .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
          .filter(Boolean)
          .join('\n')
        systemText += `${merged}\n`
        continue
      }

      results.push({ role: message.role, content: parts.length > 0 ? parts : [{ type: 'text', text: '' }] })
    }

    return { system: systemText.trim() || undefined, messages: results }
  }

  private async callAnthropicMessages(input: {
    model: string
    messages: Array<any>
    system?: string
    apiKey?: string
    baseURL?: string
    params: AiModelParameters
  }): Promise<{ content: string; reasoning: string }> {
    const baseURL = (input.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '')
    const url = `${baseURL}/messages`
    const apiKey = input.apiKey
    if (!apiKey) {
      throw new Error('Anthropic API key is required')
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14'
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        system: input.system,
        max_tokens: input.params.maxOutputTokens ?? 512,
        temperature: input.params.temperature,
        top_p: input.params.topP,
        stop_sequences: input.params.stopSequences,
        stream: false
      })
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic request failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string; thinking?: string }> }
    let content = ''
    let reasoning = ''
    for (const block of data.content || []) {
      if (block.type === 'text' && block.text) content += block.text
      if (block.type === 'thinking' && block.thinking) reasoning += block.thinking
    }
    return { content, reasoning }
  }

  private async streamAnthropicMessages(
    input: {
      model: string
      messages: Array<any>
      system?: string
      apiKey?: string
      baseURL?: string
      params: AiModelParameters
    },
    onChunk?: (chunk: AiMessage) => void,
    abortSignal?: AbortSignal
  ): Promise<{ content: string; reasoning: string }> {
    const baseURL = (input.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '')
    const url = `${baseURL}/messages`
    const apiKey = input.apiKey
    if (!apiKey) {
      throw new Error('Anthropic API key is required')
    }

    const res = await fetch(url, {
      method: 'POST',
      signal: abortSignal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14'
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        system: input.system,
        max_tokens: input.params.maxOutputTokens ?? 512,
        temperature: input.params.temperature,
        top_p: input.params.topP,
        stop_sequences: input.params.stopSequences,
        stream: true
      })
    })

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic request failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let reasoning = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          return { content, reasoning }
        }
        try {
          const json = JSON.parse(data)
          const type = json.type
          if (type === 'content_block_delta') {
            const delta = json.delta || {}
            if (delta.text) {
              content += delta.text
              this.emitTextChunk(onChunk, delta.text)
            }
            if (delta.thinking) {
              reasoning += delta.thinking
              this.emitReasoningChunk(onChunk, delta.thinking)
            }
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    return { content, reasoning }
  }

  private getUploadPurpose(modelId?: string): string | undefined {
    if (!modelId) return undefined
    const normalized = modelId.toLowerCase()
    if (normalized.includes('qwen-long') || normalized.includes('qwen-doc')) {
      return 'file-extract'
    }
    return 'assistants'
  }

  async uploadAttachmentToProvider(
    input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }
  ): Promise<{ providerId: string; fileId: string; uri?: string }> {
    const providerConfig = input.model
      ? this.resolveExecutionProviderContext(input.model).providerConfig
      : this.resolveProviderById(input.providerId)
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
      const remote = await this.uploadAttachmentToProviderInternal(
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

  private async uploadAttachmentToProviderInternal(
    input: { attachmentId: string; filename: string; mimeType: string; purpose?: string },
    providerConfig?: AiProviderConfig
  ): Promise<{ fileId: string; uri?: string } | null> {
    if (!providerConfig) return null
    if (!providerConfig.apiKey || !providerConfig.baseURL) {
      console.warn('[AI] uploadAttachmentToProvider:missing_credentials', {
        providerId: providerConfig.id,
        hasApiKey: Boolean(providerConfig.apiKey),
        hasBaseURL: Boolean(providerConfig.baseURL)
      })
      return null
    }
    const cached = attachmentStore.getRemote(input.attachmentId, {
      providerId: String(providerConfig.id),
      purpose: input.purpose
    })
    if (cached?.fileId) {
      return { fileId: cached.fileId, uri: cached.uri }
    }

    try {
      const service = FileServiceManager.getInstance().getService(providerConfig)
      const buffer = await attachmentStore.read(input.attachmentId)
      const result = await service.uploadFile({
        buffer,
        filename: input.filename,
        mimeType: input.mimeType,
        purpose: input.purpose
      })
      if (result?.fileId) {
        attachmentStore.setRemote(input.attachmentId, {
          providerId: String(providerConfig.id),
          fileId: result.fileId,
          purpose: input.purpose,
          uri: result.uri
        })
        return { fileId: result.fileId, uri: result.uri }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[AI] uploadAttachmentToProvider:service_fail', {
        providerId: providerConfig.id,
        attachmentId: input.attachmentId,
        error: message
      })
    }

    return null
  }

  private resolveProviderById(providerId?: string): AiProviderConfig | undefined {
    if (!providerId) return undefined
    const settings = getAiSettings()
    const matches = settings.providers.filter((provider) => String(provider.id) === String(providerId))
    if (matches.length === 1) return matches[0]
    if (matches.length > 0) return matches[0]
    const byLabel = settings.providers.find((provider) => (provider.label || provider.id) === providerId)
    if (byLabel) return byLabel
    const byType = settings.providers.find((provider) => getProviderType(provider) === String(providerId))
    return byType
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

  private resolveGenerationParams(option: AiOption, modelId?: string): AiModelParameters {
    const settings = getAiSettings()
    const modelConfig = this.resolveModelConfig(modelId)
    const providerConfig = this.resolveProviderConfig(modelId)
    const merged = mergeModelParams(
      settings.defaultParams,
      providerConfig?.defaultParams,
      modelConfig?.params,
      option.params
    )
    return normalizeModelParams(merged)
  }

  private resolveModelConfig(modelId?: string): AiModel | undefined {
    if (!modelId) return undefined
    const settings = getAiSettings()
    return settings.models?.find((model) => model.id === modelId)
  }

  private resolveExecutionProviderContext(
    modelId?: string,
    providerIdOverride?: string
  ): { providerType: string; providerConfig?: AiProviderConfig } {
    const resolved = resolveModelId(modelId)
    const providerConfig = this.resolveProviderConfig(modelId, providerIdOverride || resolved.providerId)
    const declaredProviderType = getProviderType(providerConfig) || providerIdOverride || resolved.providerId
    const modelConfig = this.resolveModelConfig(modelId)
    const providerType = resolveEndpointRoutedProviderType({
      providerType: declaredProviderType,
      provider: providerConfig,
      model: modelConfig
    })
    return {
      providerType,
      providerConfig: buildEndpointRoutedProviderConfig(providerConfig, providerType)
    }
  }

  private resolveProviderConfig(modelId?: string, providerIdOverride?: string): AiProviderConfig | undefined {
    const settings = getAiSettings()
    if (!settings.providers || settings.providers.length === 0) return undefined
    const modelConfig = this.resolveModelConfig(modelId)
    if (modelConfig?.providerRef) {
      const byRef = settings.providers.find((provider) => String(provider.id) === String(modelConfig.providerRef))
      if (byRef) return byRef
    }
    if (modelConfig?.providerLabel) {
      const match = settings.providers.find((provider) => (provider.label || provider.id) === modelConfig.providerLabel)
      if (match) return match
    }
    const providerId = providerIdOverride || (modelId?.includes(':') ? modelId.split(':', 2)[0] : undefined)
    if (providerId) {
      const matches = settings.providers.filter((provider) =>
        String(provider.id) === String(providerId) || getProviderType(provider) === String(providerId)
      )
      if (matches.length === 1) return matches[0]
      if (matches.length > 1 && modelId) {
        const byDefaultModel = matches.find((provider) => provider.defaultModel === modelId)
        if (byDefaultModel) return byDefaultModel
      }
      if (matches.length > 0) return matches[0]
    }
    return settings.providers[0]
  }
}

function mergeModelParams(...params: Array<AiModelParameters | undefined>) {
  const result: AiModelParameters = {}
  for (const item of params) {
    if (!item) continue
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value) && value.length === 0) continue
      ;(result as any)[key] = value
    }
  }
  return result
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return undefined
  return Math.min(Math.max(value, min), max)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getErrorMessageForLog(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || 'Unknown error'
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as any).message === 'string') {
    return (error as any).message
  }
  return 'Unknown error'
}

function collectErrorSignals(error: unknown, depth = 0, bucket: string[] = []): string[] {
  if (!error || depth > 6) return bucket
  if (typeof error === 'string') {
    bucket.push(error)
    return bucket
  }
  if (error instanceof Error) {
    if (error.name) bucket.push(error.name)
    if (error.message) bucket.push(error.message)
    const cause = (error as any).cause
    if (cause) collectErrorSignals(cause, depth + 1, bucket)
    return bucket
  }
  if (typeof error === 'object') {
    const item = error as any
    if (typeof item.name === 'string') bucket.push(item.name)
    if (typeof item.message === 'string') bucket.push(item.message)
    if (typeof item.code === 'string') bucket.push(item.code)
    if (item.cause) collectErrorSignals(item.cause, depth + 1, bucket)
  }
  return bucket
}

function isImageBase64DecodeError(error: unknown): boolean {
  const normalized = collectErrorSignals(error).join(' | ').toLowerCase()
  return (
    normalized.includes('invalidcharactererror') ||
    normalized.includes('invalid character') ||
    normalized.includes('convertbase64touint8array') ||
    normalized.includes('failed to process successful response')
  )
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function getImageModelIdFromModelKey(modelKey: any): string | undefined {
  const modelId = (modelKey as any)?.modelId
  if (typeof modelId === 'string' && modelId.trim()) return modelId.trim()
  return undefined
}

function extractOpenAIImageStreamPayload(payload: any): { partials: string[]; finals: string[] } {
  const partials: string[] = []
  const finals: string[] = []

  const pushMaybeImage = (value: unknown, target: 'partial' | 'final') => {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (!text) return
    if (target === 'partial') {
      partials.push(text)
    } else {
      finals.push(text)
    }
  }

  pushMaybeImage(payload?.partial_image_b64, 'partial')
  pushMaybeImage(payload?.b64_json, 'final')
  pushMaybeImage(payload?.image, 'final')
  pushMaybeImage(payload?.result, payload?.type?.includes?.('partial') ? 'partial' : 'final')

  if (Array.isArray(payload?.data)) {
    for (const item of payload.data) {
      pushMaybeImage(item?.b64_json, 'final')
      pushMaybeImage(item?.url, 'final')
      pushMaybeImage(item?.image, 'final')
      pushMaybeImage(item?.result, 'final')
    }
  }

  const item = payload?.item
  if (item && typeof item === 'object') {
    pushMaybeImage(item?.result, 'final')
    if (Array.isArray(item?.data)) {
      for (const dataItem of item.data) {
        pushMaybeImage(dataItem?.b64_json, 'final')
        pushMaybeImage(dataItem?.url, 'final')
      }
    }
  }

  return { partials, finals }
}

function detectImageMimeTypeFromBytes(data: Uint8Array): string {
  if (data.length >= 8) {
    if (
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    ) {
      return 'image/png'
    }
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return 'image/gif'
  }
  return 'image/png'
}

function parseDataUrl(value: string): { mediaType?: string; base64: string } | null {
  const matched = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;(base64))?,(.*)$/i)
  if (!matched) return null
  const mediaType = matched[1] || undefined
  const isBase64 = matched[2]?.toLowerCase() === 'base64'
  const rawData = matched[3] || ''
  if (!rawData) return null
  if (!isBase64) {
    return {
      mediaType,
      base64: Buffer.from(decodeURIComponent(rawData), 'utf8').toString('base64')
    }
  }
  const normalized = normalizeBase64Text(rawData)
  if (!normalized) return null
  return { mediaType, base64: normalized }
}

function normalizeBase64Text(input: string): string | null {
  const compact = input.replace(/\s+/g, '')
  if (!compact) return null

  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/')
  const mod = normalized.length % 4
  const padded = mod === 0 ? normalized : normalized + '='.repeat(4 - mod)
  if (!/^[A-Za-z0-9+/]+=*$/.test(padded)) return null
  return padded
}

function normalizeModelParams(params: AiModelParameters): AiModelParameters {
  const normalized: AiModelParameters = {}
  if (params.contextWindow !== undefined) {
    const value = Math.max(0, Math.floor(params.contextWindow))
    if (value >= 0) normalized.contextWindow = value
  }
  if (params.temperatureEnabled !== undefined) normalized.temperatureEnabled = params.temperatureEnabled
  if (params.topPEnabled !== undefined) normalized.topPEnabled = params.topPEnabled
  if (params.maxOutputTokensEnabled !== undefined) normalized.maxOutputTokensEnabled = params.maxOutputTokensEnabled
  if (params.temperatureEnabled !== false && params.temperature !== undefined) {
    normalized.temperature = clampNumber(params.temperature, 0, 2)
  }
  if (params.topPEnabled !== false && params.topP !== undefined) {
    normalized.topP = clampNumber(params.topP, 0, 1)
  }
  if (params.topK !== undefined) normalized.topK = Math.max(0, params.topK)
  if (params.maxOutputTokensEnabled !== false && params.maxOutputTokens !== undefined) {
    normalized.maxOutputTokens = Math.max(1, params.maxOutputTokens)
  }
  if (params.presencePenalty !== undefined) normalized.presencePenalty = clampNumber(params.presencePenalty, -2, 2)
  if (params.frequencyPenalty !== undefined) normalized.frequencyPenalty = clampNumber(params.frequencyPenalty, -2, 2)
  if (params.stopSequences) normalized.stopSequences = params.stopSequences.filter((item) => item && item.trim().length > 0)
  if (params.seed !== undefined) normalized.seed = Math.floor(params.seed)
  return normalized
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === undefined) return 'null'
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

function pickOpenAICompatContentSource(choice: any):
  | {
      content?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
      tool_calls?: any[]
    }
  | undefined {
  const hasUsefulData = (source: any): boolean => {
    if (!source || typeof source !== 'object') return false
    if (typeof source.content === 'string' && source.content.length > 0) return true
    if (Array.isArray(source.content) && source.content.length > 0) return true
    if (typeof source.reasoning_content === 'string' && source.reasoning_content.length > 0) return true
    if (typeof source.reasoning === 'string' && source.reasoning.length > 0) return true
    if (Array.isArray(source.tool_calls) && source.tool_calls.length > 0) return true
    return false
  }

  if (hasUsefulData(choice?.delta)) return choice.delta
  if (hasUsefulData(choice?.message)) return choice.message
  return undefined
}

function extractOpenAICompatContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
          return (part as any).text
        }
        return ''
      })
      .join('')
  }
  return ''
}

function extractUsage(result: any): { inputTokens?: number; outputTokens?: number } | undefined {
  const usage = result?.usage || result?.response?.usage || result?.metadata?.usage
  if (!usage) return undefined
  const inputTokens =
    usage.inputTokens ??
    usage.promptTokens ??
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.totalTokens ??
    usage.total_tokens
  const outputTokens =
    usage.outputTokens ??
    usage.completionTokens ??
    usage.completion_tokens ??
    usage.output_tokens
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return {
    inputTokens: inputTokens !== undefined ? Number(inputTokens) : undefined,
    outputTokens: outputTokens !== undefined ? Number(outputTokens) : undefined
  }
}

function normalizeUsage(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  fallbackInput: number,
  fallbackOutput: number
): AiTokenBreakdown {
  return {
    inputTokens: usage?.inputTokens !== undefined ? usage.inputTokens : fallbackInput,
    outputTokens: usage?.outputTokens !== undefined ? usage.outputTokens : fallbackOutput
  }
}
