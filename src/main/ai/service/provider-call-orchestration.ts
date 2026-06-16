import { generateText, stepCountIs } from 'ai'
import type {
  AiCapabilityDebugInfo,
  AiMessage,
  AiModelParameters,
  AiOption,
  AiPolicyDebugInfo,
  AiProviderConfig,
  AiTool,
  AiToolContext
} from '../../../shared/types/ai'
import type { ProviderMethodAdapter } from '../providerMethodAdapters'
import { supportsReasoning } from '../modelCapabilities'
import { splitThinkTaggedText } from '../thinkTagParser'
import { countTokensForText, countTokensFromMessages } from '../tokens'
import { buildSdkReasoningProviderOptions, buildSdkStructuredOutput, extractUsage, normalizeUsage, resolveMaxToolSteps, stripReasoningParams } from './utils'
import log from 'electron-log'

export interface ProviderCallOrchestrationDeps {
  toAnthropicMessages: (
    messages: AiMessage[],
    modelId: string | undefined,
    providerConfig?: AiProviderConfig
  ) => Promise<{ messages: Array<unknown>; system?: string }>
  callAnthropicMessages: (input: {
    model: string
    messages: Array<unknown>
    system?: string
    apiKey?: string
    baseURL?: string
    params: AiModelParameters
  }) => Promise<{ content: string; reasoning: string }>
  toOpenAIChatMessages: (
    messages: AiMessage[],
    modelId?: string,
    options?: { includeReasoningContent?: boolean }
  ) => Promise<unknown[]>
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
}

interface ExecuteProviderCallOrchestrationInput {
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
  capabilityDebug?: AiCapabilityDebugInfo
  policyDebug?: AiPolicyDebugInfo
  deps: ProviderCallOrchestrationDeps
}

export async function executeProviderCallOrchestration(
  input: ExecuteProviderCallOrchestrationInput
): Promise<AiMessage> {
  return await input.methodAdapter.call({
    hasTools: input.hasTools,
    hasMultimodalContent: input.hasMultimodalContent,
    shouldUseCompatToolLoop: input.shouldUseCompatToolLoop,
    executeAnthropicCall: async () => {
      log.info('[AI] call: 使用 Anthropic 原生 API')
      const anthropicPayload = await input.deps.toAnthropicMessages(
        input.trimmedMessages,
        input.effectiveOption.model,
        input.providerConfig
      )
      const { content, reasoning } = await input.deps.callAnthropicMessages({
        model: input.resolvedModelId,
        messages: anthropicPayload.messages,
        system: anthropicPayload.system,
        apiKey: input.requestApiKey,
        baseURL: input.providerConfig?.baseURL,
        params: input.params
      })
      const usage = normalizeUsage(
        undefined,
        countTokensFromMessages(input.trimmedMessages, input.effectiveOption.model),
        countTokensForText(`${reasoning || ''}${content || ''}`, input.effectiveOption.model)
      )
      return {
        role: 'assistant',
        content,
        reasoning_content: reasoning || undefined,
        usage
      }
    },
    executeCompatToolLoopCall: async () => {
      log.info('[AI] call: 使用 OpenAI 兼容工具调用分支（DeepSeek reasoning 兼容）', {
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
      }, undefined, input.controllerSignal)

      return {
        role: 'assistant',
        content,
        reasoning_content: reasoning || undefined,
        usage: normalizeUsage(
          usage,
          countTokensFromMessages(input.trimmedMessages, input.effectiveOption.model),
          countTokensForText(`${reasoning || ''}${content || ''}`, input.effectiveOption.model)
        )
      }
    },
    executeSdkCall: async () => {
      log.info('[AI] call: 使用 Vercel AI SDK generateText', { hasTools: input.hasTools })
      const messages = await input.deps.toSdkMessages(input.trimmedMessages, input.effectiveOption.model)
      const maxSteps = resolveMaxToolSteps(input.effectiveOption.maxToolSteps)
      const result = await generateText({
        model: input.modelKey,
        messages,
        abortSignal: input.controllerSignal,
        tools: input.tools,
        stopWhen: input.tools ? stepCountIs(maxSteps) : undefined,
        ...stripReasoningParams(input.params),
        ...(buildSdkReasoningProviderOptions(input.params)
          ? { providerOptions: buildSdkReasoningProviderOptions(input.params) }
          : {}),
        ...buildSdkStructuredOutput(input.params, !!input.tools)
      } as Parameters<typeof generateText>[0])
      const resultMeta = result as { toolCalls?: unknown[]; steps?: unknown[]; reasoning?: unknown }

      log.info('[AI] call: generateText 完成', {
        text: result.text?.substring(0, 100),
        hasToolCalls: !!resultMeta.toolCalls,
        toolCallsCount: resultMeta.toolCalls?.length,
        steps: resultMeta.steps?.length,
        finishReason: result.finishReason
      })

      const allowReasoning = supportsReasoning(input.effectiveOption.model)
      let contentText = result.text || ''
      let reasoningText = allowReasoning ? String(resultMeta.reasoning || '') : ''
      if (allowReasoning) {
        const parsed = splitThinkTaggedText(contentText, input.effectiveOption.model)
        contentText = parsed.content
        if (!reasoningText && parsed.reasoning) {
          reasoningText = parsed.reasoning
        }
      }
      const usage = normalizeUsage(
        extractUsage(result),
        countTokensFromMessages(input.trimmedMessages, input.effectiveOption.model),
        countTokensForText(`${reasoningText || ''}${contentText || ''}`, input.effectiveOption.model)
      )

      return {
        role: 'assistant',
        content: contentText,
        reasoning_content: allowReasoning ? reasoningText || undefined : undefined,
        usage
      }
    }
  })
}
