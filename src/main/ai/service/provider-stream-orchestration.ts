import { streamText, stepCountIs } from 'ai'
import type {
  AiCapabilityDebugInfo,
  AiMessage,
  AiModelParameters,
  AiOption,
  AiPolicyDebugInfo,
  AiProviderConfig,
  AiTokenBreakdown,
  AiTool,
  AiToolContext
} from '../../../shared/types/ai'
import type { ProviderMethodAdapter } from '../providerMethodAdapters'
import { supportsReasoning } from '../modelCapabilities'
import { isOpenAICompatibleProvider, shouldUseChatCompletions } from '../providerAdapterCatalog'
import { countTokensForText, countTokensFromMessages } from '../tokens'
import { aggregateSdkStreamResult } from './reply-aggregation'
import { extractUsage, normalizeUsage, resolveMaxToolSteps } from './utils'

type StreamRoute = 'anthropic-native' | 'openai-compat-chat' | 'openai-compat-tool-loop' | 'ai-sdk-stream'

export interface ProviderStreamOrchestrationDeps {
  toAnthropicMessages: (
    messages: AiMessage[],
    modelId: string | undefined,
    providerConfig?: AiProviderConfig
  ) => Promise<{ messages: Array<unknown>; system?: string }>
  streamAnthropicMessages: (
    input: {
      model: string
      messages: Array<unknown>
      system?: string
      apiKey?: string
      baseURL?: string
      params: AiModelParameters
    },
    onChunk?: (chunk: AiMessage) => void,
    abortSignal?: AbortSignal
  ) => Promise<{ content: string; reasoning: string }>
  toOpenAIChatMessages: (
    messages: AiMessage[],
    modelId?: string,
    options?: { includeReasoningContent?: boolean }
  ) => Promise<unknown[]>
  streamOpenAICompatChat: (
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
  ) => Promise<{ content: string; reasoning: string }>
  runOpenAICompatToolLoop: (
    input: {
      model: string
      providerType?: string
      messages: unknown[]
      apiKey?: string
      baseURL?: string
      params: AiModelParameters
      tools: AiTool[]
      maxToolSteps?: number
      toolContext?: AiToolContext
      allowReasoning: boolean
      requestId?: string
      capabilityDebug?: AiCapabilityDebugInfo
      policyDebug?: AiPolicyDebugInfo
    },
    onChunk?: (chunk: AiMessage) => void,
    abortSignal?: AbortSignal
  ) => Promise<{ content: string; reasoning: string; usage?: { inputTokens?: number; outputTokens?: number } }>
  toSdkMessages: (messages: AiMessage[], modelId?: string) => Promise<unknown[]>
  assertNotAborted?: (abortSignal?: AbortSignal) => void
  emitTextChunk: (onChunk: ((chunk: AiMessage) => void) | undefined, text: string) => void
  emitReasoningChunk: (onChunk: ((chunk: AiMessage) => void) | undefined, text: string) => void
  emitToolCallChunk: (
    onChunk: ((chunk: AiMessage) => void) | undefined,
    toolCall: { id: string; name: string; args?: unknown }
  ) => void
  emitToolResultChunk: (
    onChunk: ((chunk: AiMessage) => void) | undefined,
    toolResult: { id: string; name: string; result?: unknown }
  ) => void
  emitEndChunk: (onChunk: ((chunk: AiMessage) => void) | undefined, message: AiMessage) => void
}

interface ExecuteProviderStreamOrchestrationInput {
  methodAdapter: ProviderMethodAdapter
  hasTools: boolean
  hasMultimodalContent: boolean
  shouldUseCompatToolLoop: boolean
  effectiveOption: AiOption
  trimmedMessages: AiMessage[]
  resolvedModelId: string
  providerType: string
  providerConfig?: AiProviderConfig
  requestApiKey?: string
  params: AiModelParameters
  modelKey: unknown
  tools?: unknown
  introspectionReadyTools?: AiTool[]
  requestId: string
  controllerSignal: AbortSignal
  trackedOnChunk?: (chunk: AiMessage) => void
  capabilityDebug?: AiCapabilityDebugInfo
  policyDebug?: AiPolicyDebugInfo
  onEnd?: (message: AiMessage) => void
  markRoute: (route: StreamRoute) => void
  deps: ProviderStreamOrchestrationDeps
}

function emitFinalMessage(
  input: Pick<ExecuteProviderStreamOrchestrationInput, 'capabilityDebug' | 'policyDebug' | 'trackedOnChunk' | 'onEnd' | 'deps'>,
  message: {
    content: string
    reasoning?: string
    usage: AiTokenBreakdown
    allowReasoning?: boolean
  }
): AiMessage {
  const finalMessage: AiMessage = {
    role: 'assistant',
    content: message.content || '',
    reasoning_content: message.allowReasoning === false ? undefined : message.reasoning || undefined,
    usage: message.usage,
    capability_debug: input.capabilityDebug,
    policy_debug: input.policyDebug
  }
  input.deps.emitEndChunk(input.trackedOnChunk, finalMessage)
  input.onEnd?.(finalMessage)
  return finalMessage
}

export async function executeProviderStreamOrchestration(
  input: ExecuteProviderStreamOrchestrationInput
): Promise<AiMessage> {
  return await input.methodAdapter.stream({
    hasTools: input.hasTools,
    hasMultimodalContent: input.hasMultimodalContent,
    shouldUseCompatToolLoop: input.shouldUseCompatToolLoop,
    executeAnthropicStream: async () => {
      input.markRoute('anthropic-native')
      const anthropicPayload = await input.deps.toAnthropicMessages(
        input.trimmedMessages,
        input.effectiveOption.model,
        input.providerConfig
      )
      const { content, reasoning } = await input.deps.streamAnthropicMessages({
        model: input.resolvedModelId,
        messages: anthropicPayload.messages,
        system: anthropicPayload.system,
        apiKey: input.requestApiKey,
        baseURL: input.providerConfig?.baseURL,
        params: input.params
      }, input.trackedOnChunk, input.controllerSignal)

      return emitFinalMessage(input, {
        content,
        reasoning,
        usage: normalizeUsage(
          undefined,
          countTokensFromMessages(input.trimmedMessages, input.effectiveOption.model),
          countTokensForText(`${reasoning || ''}${content || ''}`, input.effectiveOption.model)
        )
      })
    },
    executeCompatChatStream: async () => {
      input.markRoute('openai-compat-chat')
      const messages = await input.deps.toOpenAIChatMessages(input.effectiveOption.messages, input.effectiveOption.model)
      const { content, reasoning } = await input.deps.streamOpenAICompatChat({
        model: input.resolvedModelId,
        providerType: input.providerType,
        messages: messages as Array<{
          role: 'system' | 'user' | 'assistant'
          content:
            | string
            | Array<
                | { type: 'text'; text: string }
                | { type: 'image_url'; image_url: { url: string } }
              >
        }>,
        apiKey: input.requestApiKey,
        baseURL: input.providerConfig?.baseURL,
        params: input.params,
        tools: input.introspectionReadyTools
      }, input.trackedOnChunk, input.controllerSignal)

      return emitFinalMessage(input, {
        content,
        reasoning,
        usage: normalizeUsage(
          undefined,
          countTokensFromMessages(input.trimmedMessages, input.effectiveOption.model),
          countTokensForText(`${reasoning || ''}${content || ''}`, input.effectiveOption.model)
        )
      })
    },
    executeCompatToolLoopStream: async () => {
      input.markRoute('openai-compat-tool-loop')
      console.log('[AI] stream: 使用 OpenAI 兼容工具调用分支（DeepSeek reasoning 兼容）', {
        model: input.effectiveOption.model,
        maxToolSteps: resolveMaxToolSteps(input.effectiveOption.maxToolSteps)
      })
      const chatMessages = await input.deps.toOpenAIChatMessages(
        input.trimmedMessages,
        input.effectiveOption.model,
        { includeReasoningContent: true }
      )
      const { content, reasoning, usage } = await input.deps.runOpenAICompatToolLoop({
        model: input.resolvedModelId,
        providerType: input.providerType,
        messages: chatMessages,
        apiKey: input.requestApiKey,
        baseURL: input.providerConfig?.baseURL,
        params: input.params,
        tools: input.introspectionReadyTools || [],
        maxToolSteps: input.effectiveOption.maxToolSteps,
        toolContext: input.effectiveOption.toolContext,
        allowReasoning: supportsReasoning(input.effectiveOption.model),
        requestId: input.requestId,
        capabilityDebug: input.capabilityDebug,
        policyDebug: input.policyDebug
      }, input.trackedOnChunk, input.controllerSignal)

      return emitFinalMessage(input, {
        content,
        reasoning,
        allowReasoning: supportsReasoning(input.effectiveOption.model),
        usage: normalizeUsage(
          usage,
          countTokensFromMessages(input.trimmedMessages, input.effectiveOption.model),
          countTokensForText(`${reasoning || ''}${content || ''}`, input.effectiveOption.model)
        )
      })
    },
    executeSdkStream: async () => {
      input.markRoute('ai-sdk-stream')
      if (isOpenAICompatibleProvider(input.providerType) &&
        shouldUseChatCompletions(input.providerType, input.providerConfig?.baseURL) &&
        input.tools) {
        // 兼容 chat/completions 流式分支当前仅解析文本，不处理 tool_calls。
        // 启用工具时回退到 AI SDK 的 streamText，以支持工具执行与多步调用。
        console.log('[AI] stream: 检测到工具调用，使用 AI SDK streamText 分支', {
          model: input.effectiveOption.model,
          maxToolSteps: resolveMaxToolSteps(input.effectiveOption.maxToolSteps)
        })
      }
      const maxSteps = resolveMaxToolSteps(input.effectiveOption.maxToolSteps)
      const messages = await input.deps.toSdkMessages(input.trimmedMessages, input.effectiveOption.model)
      const result = await streamText({
        model: input.modelKey,
        messages,
        abortSignal: input.controllerSignal,
        tools: input.tools,
        stopWhen: input.tools ? stepCountIs(maxSteps) : undefined,
        ...input.params
      } as Parameters<typeof streamText>[0])

      const allowReasoning = supportsReasoning(input.effectiveOption.model)
      const { content, reasoning } = await aggregateSdkStreamResult({
        result,
        allowReasoning,
        modelId: input.effectiveOption.model,
        abortSignal: input.controllerSignal,
        assertNotAborted: input.deps.assertNotAborted,
        onPart: (part) => {
          console.log('[AI] stream part:', part?.type, part)
        },
        onText: (text) => input.deps.emitTextChunk(input.trackedOnChunk, text),
        onReasoning: (text) => input.deps.emitReasoningChunk(input.trackedOnChunk, text),
        onToolCall: (toolCall) => {
          console.log('[AI] tool-call detected:', toolCall)
          input.deps.emitToolCallChunk(input.trackedOnChunk, toolCall)
        },
        onToolResult: (toolResult) => {
          console.log('[AI] tool-result detected:', toolResult)
          input.deps.emitToolResultChunk(input.trackedOnChunk, toolResult)
        }
      })

      return emitFinalMessage(input, {
        content,
        reasoning,
        allowReasoning,
        usage: normalizeUsage(
          extractUsage(result),
          countTokensFromMessages(input.trimmedMessages, input.effectiveOption.model),
          countTokensForText(`${reasoning || ''}${content || ''}`, input.effectiveOption.model)
        )
      })
    }
  })
}
