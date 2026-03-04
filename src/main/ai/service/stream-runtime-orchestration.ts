import type { AiMessage, AiTokenBreakdown } from '../../../shared/types/ai'
import { classifyAiStreamError } from '../../../shared/ai/streamDiagnostics'
import {
  createAiStreamMetrics,
  finishAiStreamMetricsError,
  finishAiStreamMetricsSuccess,
  markAiStreamRoute,
  recordAiStreamChunk,
  type AiStreamMetrics
} from '../streamMetrics'
import { emitErrorChunk as emitErrorChunkHelper } from './stream-helpers'
import { resolveMaxToolSteps } from './utils'

export interface StreamRuntimeState {
  metrics: AiStreamMetrics
  trackedOnChunk: (chunk: AiMessage) => void
}

interface CreateStreamRuntimeInput {
  requestId: string
  providerType: string
  model?: string
  hasTools: boolean
  compatToolLoop: boolean
  maxToolSteps?: number
  selectedSkillNames?: string[]
  resolvedMcpMode?: string
  onChunk?: (chunk: AiMessage) => void
}

interface HandleStreamRuntimeErrorInput {
  error: unknown
  requestId: string
  model?: string
  providerType?: string
  runtime?: StreamRuntimeState
  onChunk?: (chunk: AiMessage) => void
  onError?: (error: Error) => void
}

export function createStreamRuntime(input: CreateStreamRuntimeInput): StreamRuntimeState {
  const metrics = createAiStreamMetrics({
    requestId: input.requestId,
    providerType: input.providerType,
    model: input.model,
    hasTools: input.hasTools,
    compatToolLoop: input.compatToolLoop,
    maxToolSteps: resolveMaxToolSteps(input.maxToolSteps)
  })
  const trackedOnChunk = (chunk: AiMessage) => {
    recordAiStreamChunk(metrics, chunk)
    input.onChunk?.(chunk)
  }

  console.info('[AI] stream:boot', {
    requestId: input.requestId,
    model: input.model,
    providerType: input.providerType,
    resolvedMcpMode: input.resolvedMcpMode || 'off',
    resolvedSkillNames: input.selectedSkillNames || []
  })
  console.info('[AI] stream:metrics:start', {
    requestId: input.requestId,
    providerType: input.providerType,
    model: input.model,
    hasTools: metrics.hasTools,
    compatToolLoop: metrics.compatToolLoop,
    maxToolSteps: metrics.maxToolSteps,
    skills: input.selectedSkillNames || []
  })

  return {
    metrics,
    trackedOnChunk
  }
}

export function markStreamRuntimeRoute(
  runtime: StreamRuntimeState,
  route: AiStreamMetrics['route']
): void {
  markAiStreamRoute(runtime.metrics, route)
}

export function finishStreamRuntimeSuccess(
  runtime: StreamRuntimeState,
  usage?: AiTokenBreakdown
): AiStreamMetrics {
  const successMetrics = finishAiStreamMetricsSuccess(runtime.metrics, usage)
  console.info('[AI] stream:metrics:end', successMetrics)
  return successMetrics
}

export function handleStreamRuntimeError(input: HandleStreamRuntimeErrorInput): Error {
  const classification = classifyAiStreamError(input.error)
  const error = input.error instanceof Error ? input.error : new Error(classification.message || 'AI stream failed')
  emitErrorChunkHelper(input.runtime?.trackedOnChunk || input.onChunk, error, classification)
  input.onError?.(error)

  if (input.runtime) {
    const finalizedMetrics = finishAiStreamMetricsError(input.runtime.metrics, classification)
    console.error('[AI] stream:error', {
      requestId: input.requestId,
      providerType: input.runtime.metrics.providerType,
      model: input.model,
      code: classification.code,
      category: classification.category,
      retryable: classification.retryable,
      statusCode: classification.statusCode,
      message: classification.message
    })
    console.info('[AI] stream:metrics:end', finalizedMetrics)
    return error
  }

  console.error('[AI] stream:error', {
    requestId: input.requestId,
    providerType: input.providerType,
    model: input.model,
    code: classification.code,
    category: classification.category,
    retryable: classification.retryable,
    statusCode: classification.statusCode,
    message: classification.message
  })
  return error
}
