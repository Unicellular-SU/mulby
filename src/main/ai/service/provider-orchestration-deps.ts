import type {
  AiMessage,
  AiProviderConfig
} from '../../../shared/types/ai'
import {
  callAnthropicMessages as callAnthropicMessagesHelper,
  streamAnthropicMessages as streamAnthropicMessagesHelper,
  toAnthropicMessages as toAnthropicMessagesHelper
} from './anthropic-helpers'
import {
  toOpenAIChatMessages as toOpenAIChatMessagesHelper,
  toSdkMessages as toSdkMessagesHelper
} from './message-converters'
import type { OpenAICompatBridge } from './openai-compat-bridge'
import {
  resolveExecutionProviderContext as resolveExecutionProviderContextHelper
} from './provider-helpers'
import {
  getUploadPurpose as getUploadPurposeHelper,
  uploadAttachmentToProviderInternal as uploadAttachmentToProviderInternalHelper
} from './upload-helpers'
import type { ProviderCallOrchestrationDeps } from './provider-call-orchestration'
import type { ProviderStreamOrchestrationDeps } from './provider-stream-orchestration'
import {
  assertNotAborted as assertNotAbortedHelper,
  emitEndChunk as emitEndChunkHelper,
  emitReasoningChunk as emitReasoningChunkHelper,
  emitTextChunk as emitTextChunkHelper,
  emitToolCallChunk as emitToolCallChunkHelper,
  emitToolResultChunk as emitToolResultChunkHelper,
  emitUsageChunk as emitUsageChunkHelper
} from './stream-helpers'

interface CreateProviderOrchestrationDepsInput {
  openAICompat: OpenAICompatBridge
}

function createMessageDeps() {
  return {
    toAnthropicMessages: async (
      messages: AiMessage[],
      modelId: string | undefined,
      providerConfig?: AiProviderConfig
    ) =>
      await toAnthropicMessagesHelper({
        messages,
        modelId,
        providerConfig,
        getUploadPurpose: (targetModelId?: string) => getUploadPurposeHelper(targetModelId),
        uploadAttachmentToProviderInternal: async (payload, config) =>
          await uploadAttachmentToProviderInternalHelper(payload, config)
      }),
    toOpenAIChatMessages: async (
      messages: AiMessage[],
      modelId?: string,
      options?: { includeReasoningContent?: boolean }
    ) =>
      await toOpenAIChatMessagesHelper({
        messages,
        modelId,
        includeReasoningContent: options?.includeReasoningContent,
        resolveExecutionProviderContext: (targetModelId?: string) =>
          resolveExecutionProviderContextHelper({ modelId: targetModelId })
      }),
    toSdkMessages: async (messages: AiMessage[], modelId?: string) =>
      await toSdkMessagesHelper({
        messages,
        modelId,
        resolveExecutionProviderContext: (targetModelId?: string) =>
          resolveExecutionProviderContextHelper({ modelId: targetModelId }),
        getUploadPurpose: (targetModelId?: string) => getUploadPurposeHelper(targetModelId),
        uploadAttachmentToProviderInternal: async (payload, providerConfig) =>
          await uploadAttachmentToProviderInternalHelper(payload, providerConfig)
      })
  }
}

export function createProviderCallOrchestrationDeps(
  input: CreateProviderOrchestrationDepsInput
): ProviderCallOrchestrationDeps {
  const messageDeps = createMessageDeps()

  return {
    ...messageDeps,
    callAnthropicMessages: async (payload) =>
      await callAnthropicMessagesHelper({
        ...payload,
        messages: payload.messages as Array<Record<string, unknown>>
      }),
    runOpenAICompatToolLoop: async (payload, onChunk, abortSignal) =>
      await input.openAICompat.runOpenAICompatToolLoop(payload, onChunk, abortSignal)
  }
}

export function createProviderStreamOrchestrationDeps(
  input: CreateProviderOrchestrationDepsInput
): ProviderStreamOrchestrationDeps {
  const messageDeps = createMessageDeps()

  return {
    ...messageDeps,
    streamAnthropicMessages: async (payload, onChunk, abortSignal) =>
      await streamAnthropicMessagesHelper({
        ...payload,
        messages: payload.messages as Array<Record<string, unknown>>
      }, {
        onChunk,
        abortSignal,
        emitTextChunk: (handler, text) => emitTextChunkHelper(handler, text),
        emitReasoningChunk: (handler, text) => emitReasoningChunkHelper(handler, text)
      }),
    streamOpenAICompatChat: async (payload, onChunk, abortSignal) =>
      await input.openAICompat.streamOpenAICompatChat(payload, onChunk, abortSignal),
    runOpenAICompatToolLoop: async (payload, onChunk, abortSignal) =>
      await input.openAICompat.runOpenAICompatToolLoop(payload, onChunk, abortSignal),
    assertNotAborted: (abortSignal?: AbortSignal) => assertNotAbortedHelper(abortSignal),
    emitTextChunk: (onChunk, text) => emitTextChunkHelper(onChunk, text),
    emitReasoningChunk: (onChunk, text) => emitReasoningChunkHelper(onChunk, text),
    emitToolCallChunk: (onChunk, toolCall) => emitToolCallChunkHelper(onChunk, toolCall),
    emitToolResultChunk: (onChunk, toolResult) => emitToolResultChunkHelper(onChunk, toolResult),
    emitUsageChunk: (onChunk, payload) => emitUsageChunkHelper(onChunk, payload),
    emitEndChunk: (onChunk, message) => emitEndChunkHelper(onChunk, message)
  }
}
