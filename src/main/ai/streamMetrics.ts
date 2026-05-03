import type { AiMessage, AiTokenBreakdown } from '../../shared/types/ai'
import type { AiStreamErrorClassification } from '../../shared/ai/streamDiagnostics'

type AiStreamStatus = 'running' | 'completed' | 'aborted' | 'error'

interface AiStreamChunkCounters {
  meta: number
  text: number
  reasoning: number
  toolCall: number
  toolProgress: number
  toolResult: number
  error: number
  end: number
}

export interface AiStreamMetrics {
  requestId: string
  providerType: string
  model?: string
  hasTools: boolean
  compatToolLoop: boolean
  maxToolSteps: number
  startedAtMs: number
  durationMs?: number
  status: AiStreamStatus
  route?: 'anthropic-native' | 'openai-compat-chat' | 'openai-compat-tool-loop' | 'ai-sdk-stream'
  chunks: AiStreamChunkCounters
  textChars: number
  reasoningChars: number
  usage?: AiTokenBreakdown
  error?: AiStreamErrorClassification
}

export function createAiStreamMetrics(input: {
  requestId: string
  providerType: string
  model?: string
  hasTools: boolean
  compatToolLoop: boolean
  maxToolSteps: number
}): AiStreamMetrics {
  return {
    requestId: input.requestId,
    providerType: input.providerType,
    model: input.model,
    hasTools: input.hasTools,
    compatToolLoop: input.compatToolLoop,
    maxToolSteps: input.maxToolSteps,
    startedAtMs: Date.now(),
    status: 'running',
    chunks: {
      meta: 0,
      text: 0,
      reasoning: 0,
      toolCall: 0,
      toolProgress: 0,
      toolResult: 0,
      error: 0,
      end: 0
    },
    textChars: 0,
    reasoningChars: 0
  }
}

export function markAiStreamRoute(metrics: AiStreamMetrics, route: AiStreamMetrics['route']): void {
  metrics.route = route
}

export function recordAiStreamChunk(metrics: AiStreamMetrics, chunk: AiMessage): void {
  if (chunk.chunkType === 'meta') {
    metrics.chunks.meta += 1
    return
  }
  if (chunk.chunkType === 'text') {
    metrics.chunks.text += 1
    if (typeof chunk.content === 'string') metrics.textChars += chunk.content.length
    return
  }
  if (chunk.chunkType === 'reasoning') {
    metrics.chunks.reasoning += 1
    if (typeof chunk.reasoning_content === 'string') metrics.reasoningChars += chunk.reasoning_content.length
    return
  }
  if (chunk.chunkType === 'tool-call') {
    metrics.chunks.toolCall += 1
    return
  }
  if (chunk.chunkType === 'tool-progress') {
    metrics.chunks.toolProgress += 1
    return
  }
  if (chunk.chunkType === 'tool-result') {
    metrics.chunks.toolResult += 1
    return
  }
  if (chunk.chunkType === 'error') {
    metrics.chunks.error += 1
    return
  }
  if (chunk.chunkType === 'end') {
    metrics.chunks.end += 1
  }
}

export function finishAiStreamMetricsSuccess(metrics: AiStreamMetrics, usage?: AiTokenBreakdown): AiStreamMetrics {
  metrics.durationMs = Date.now() - metrics.startedAtMs
  metrics.status = 'completed'
  metrics.usage = usage
  return metrics
}

export function finishAiStreamMetricsError(
  metrics: AiStreamMetrics,
  error: AiStreamErrorClassification
): AiStreamMetrics {
  metrics.durationMs = Date.now() - metrics.startedAtMs
  metrics.error = error
  metrics.status = error.code === 'AI_STREAM_ABORTED' ? 'aborted' : 'error'
  return metrics
}
