import type { AiCapabilityDebugInfo, AiMessage, AiPolicyDebugInfo } from '../../../shared/types/ai'
import {
  createEndChunk,
  createErrorChunk,
  createMetaChunk,
  createReasoningChunk,
  createTextChunk,
  createToolCallChunk,
  createToolResultChunk
} from '../streamChunkProtocol'
import { aiMcpService } from '../mcp'

export type ErrorChunkClassification = Parameters<typeof createErrorChunk>[1]

export function hasMultimodalContent(messages: AiMessage[]): boolean {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type !== 'text'))
}

export function emitChunk(onChunk: ((chunk: AiMessage) => void) | undefined, chunk: AiMessage): void {
  if (!onChunk) return
  onChunk(chunk)
}

export function emitDebugMetaChunk(
  onChunk: ((chunk: AiMessage) => void) | undefined,
  meta: {
    capabilityDebug?: AiCapabilityDebugInfo
    policyDebug?: AiPolicyDebugInfo
  }
): void {
  if (!meta.capabilityDebug && !meta.policyDebug) return
  emitChunk(onChunk, createMetaChunk({
    capability_debug: meta.capabilityDebug,
    policy_debug: meta.policyDebug
  }))
}

export function emitTextChunk(onChunk: ((chunk: AiMessage) => void) | undefined, text: string): void {
  emitChunk(onChunk, createTextChunk(text))
}

export function emitReasoningChunk(onChunk: ((chunk: AiMessage) => void) | undefined, text: string): void {
  emitChunk(onChunk, createReasoningChunk(text))
}

export function emitToolCallChunk(
  onChunk: ((chunk: AiMessage) => void) | undefined,
  toolCall: { id: string; name: string; args?: unknown }
): void {
  emitChunk(onChunk, createToolCallChunk(toolCall))
}

export function emitToolResultChunk(
  onChunk: ((chunk: AiMessage) => void) | undefined,
  toolResult: { id: string; name: string; result?: unknown }
): void {
  emitChunk(onChunk, createToolResultChunk(toolResult))
}

export function emitErrorChunk(
  onChunk: ((chunk: AiMessage) => void) | undefined,
  error: Error,
  classification?: ErrorChunkClassification
): void {
  emitChunk(onChunk, createErrorChunk(error, classification))
}

export function emitEndChunk(onChunk: ((chunk: AiMessage) => void) | undefined, message: AiMessage): void {
  emitChunk(onChunk, createEndChunk(message))
}

export function assertNotAborted(abortSignal?: AbortSignal): void {
  if (!abortSignal?.aborted) return
  throw new Error('AI stream aborted by user')
}

export function trackMcpCall(
  requestMcpCallIds: Map<string, Set<string>>,
  requestId: string | undefined,
  callId: string | undefined
): void {
  if (!requestId || !callId) return
  const current = requestMcpCallIds.get(requestId) || new Set<string>()
  current.add(callId)
  requestMcpCallIds.set(requestId, current)
}

export function untrackMcpCall(
  requestMcpCallIds: Map<string, Set<string>>,
  requestId: string | undefined,
  callId: string | undefined
): void {
  if (!requestId || !callId) return
  const current = requestMcpCallIds.get(requestId)
  if (!current) return
  current.delete(callId)
  if (current.size === 0) {
    requestMcpCallIds.delete(requestId)
  }
}

export function abortTrackedMcpCalls(requestMcpCallIds: Map<string, Set<string>>, requestId: string): void {
  const ids = requestMcpCallIds.get(requestId)
  if (!ids || ids.size === 0) return
  for (const callId of ids) {
    aiMcpService.abortTool(callId)
  }
  requestMcpCallIds.delete(requestId)
}
