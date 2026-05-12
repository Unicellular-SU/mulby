import type {
  AiCapabilityDebugInfo,
  AiMessage,
  AiModelParameters,
  AiOption,
  AiPolicyDebugInfo,
  AiTool,
  AiToolContext
} from '../../../shared/types/ai'
import type { PluginToolProgress } from '../../../shared/types/plugin'
import {
  runOpenAICompatToolLoop as runOpenAICompatToolLoopHelper,
  streamOpenAICompat as streamOpenAICompatHelper,
  streamOpenAICompatChat as streamOpenAICompatChatHelper,
  type OpenAICompatContext
} from './openai-compat-stream'
import {
  assertNotAborted as assertNotAbortedHelper,
  emitReasoningChunk as emitReasoningChunkHelper,
  emitTextChunk as emitTextChunkHelper,
  emitToolCallChunk as emitToolCallChunkHelper,
  emitToolProgressChunk as emitToolProgressChunkHelper,
  emitToolResultChunk as emitToolResultChunkHelper,
  trackMcpCall as trackMcpCallHelper,
  untrackMcpCall as untrackMcpCallHelper
} from './stream-helpers'

interface CreateOpenAICompatBridgeInput {
  resolveCompatBaseURL: (explicitBaseURL?: string, providerType?: string) => string
  resolveGenerationParams: (option: AiOption, modelId?: string) => AiModelParameters
  requestMcpCallIds: Map<string, Set<string>>
  toolExecutor?: (input: {
    name: string
    args: unknown
    context?: AiToolContext
    callId?: string
    abortSignal?: AbortSignal
    onProgress?: (progress: PluginToolProgress) => void
  }) => Promise<unknown>
}

export interface OpenAICompatBridge {
  streamOpenAICompat: (
    input: { model?: string; providerId?: string; providerType?: string; apiKey?: string; baseURL?: string },
    onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
  ) => Promise<{ content: string; reasoning: string }>
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
  ) => Promise<{ content: string; reasoning: string; usage?: { inputTokens?: number; outputTokens?: number } }>
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
}

function createOpenAICompatContext(input: CreateOpenAICompatBridgeInput): OpenAICompatContext {
  return {
    resolveCompatBaseURL: input.resolveCompatBaseURL,
    resolveGenerationParams: input.resolveGenerationParams,
    assertNotAborted: (abortSignal?: AbortSignal) => assertNotAbortedHelper(abortSignal),
    emitReasoningChunk: (onChunk, text) => emitReasoningChunkHelper(onChunk, text),
    emitTextChunk: (onChunk, text) => emitTextChunkHelper(onChunk, text),
    emitToolCallChunk: (onChunk, toolCall) => emitToolCallChunkHelper(onChunk, toolCall),
    emitToolProgressChunk: (onChunk, toolProgress) => emitToolProgressChunkHelper(onChunk, toolProgress),
    emitToolResultChunk: (onChunk, toolResult) => emitToolResultChunkHelper(onChunk, toolResult),
    trackMcpCall: (requestId, callId) => trackMcpCallHelper(input.requestMcpCallIds, requestId, callId),
    untrackMcpCall: (requestId, callId) => untrackMcpCallHelper(input.requestMcpCallIds, requestId, callId),
    toolExecutor: input.toolExecutor
  }
}

export function createOpenAICompatBridge(input: CreateOpenAICompatBridgeInput): OpenAICompatBridge {
  const context = createOpenAICompatContext(input)

  return {
    streamOpenAICompat: async (payload, onChunk) =>
      await streamOpenAICompatHelper(context, payload, onChunk),
    streamOpenAICompatChat: async (payload, onChunk, abortSignal) =>
      await streamOpenAICompatChatHelper(context, payload, onChunk, abortSignal),
    runOpenAICompatToolLoop: async (payload, onChunk, abortSignal) =>
      await runOpenAICompatToolLoopHelper(context, payload, onChunk, abortSignal)
  }
}
