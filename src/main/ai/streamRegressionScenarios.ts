import type { AiMessage } from '../../shared/types/ai'

export interface StreamToolEvent {
  id: string
  name: string
}

export interface StreamRegressionSummary {
  text: string
  reasoning: string
  toolCalls: StreamToolEvent[]
  toolResults: StreamToolEvent[]
  status: 'running' | 'completed' | 'error' | 'aborted'
  errorMessage?: string
  warnings: string[]
}

function isAbortMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('abort') || normalized.includes('cancel') || normalized.includes('canceled')
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function createEmptyStreamSummary(): StreamRegressionSummary {
  return {
    text: '',
    reasoning: '',
    toolCalls: [],
    toolResults: [],
    status: 'running',
    warnings: []
  }
}

export function applyStreamChunkToSummary(
  summary: StreamRegressionSummary,
  chunk: AiMessage
): StreamRegressionSummary {
  const next = { ...summary }
  const chunkType = chunk.chunkType
  if (next.status !== 'running') {
    next.warnings.push(`chunk after terminal state: ${chunkType || 'unknown'}`)
    return next
  }

  if (!chunkType) {
    const text = normalizeText(chunk.content)
    if (text) next.text += text
    const reasoning = normalizeText(chunk.reasoning_content)
    if (reasoning) next.reasoning += reasoning
    return next
  }

  if (chunkType === 'text') {
    next.text += normalizeText(chunk.content)
    return next
  }

  if (chunkType === 'reasoning') {
    next.reasoning += normalizeText(chunk.reasoning_content)
    return next
  }

  if (chunkType === 'tool-call') {
    if (!chunk.tool_call?.id || !chunk.tool_call?.name) {
      next.warnings.push('invalid tool-call chunk')
      return next
    }
    next.toolCalls = [...next.toolCalls, { id: chunk.tool_call.id, name: chunk.tool_call.name }]
    return next
  }

  if (chunkType === 'tool-progress') {
    if (!chunk.tool_progress?.name || !Number.isFinite(chunk.tool_progress.progress)) {
      next.warnings.push('invalid tool-progress chunk')
    }
    return next
  }

  if (chunkType === 'tool-result') {
    if (!chunk.tool_result?.id || !chunk.tool_result?.name) {
      next.warnings.push('invalid tool-result chunk')
      return next
    }
    const matchedCall = next.toolCalls.some((call) => call.id === chunk.tool_result?.id)
    if (!matchedCall) {
      next.warnings.push(`tool-result without previous tool-call: ${chunk.tool_result.id}`)
    }
    next.toolResults = [...next.toolResults, { id: chunk.tool_result.id, name: chunk.tool_result.name }]
    return next
  }

  if (chunkType === 'error') {
    const message = chunk.error?.message || 'unknown stream error'
    next.errorMessage = message
    next.status = isAbortMessage(message) ? 'aborted' : 'error'
    return next
  }

  if (chunkType === 'end') {
    next.status = 'completed'
    return next
  }

  if (chunkType === 'meta') {
    return next
  }

  next.warnings.push(`unknown chunkType: ${chunkType}`)
  return next
}

export function summarizeStreamChunks(chunks: AiMessage[]): StreamRegressionSummary {
  return chunks.reduce((summary, chunk) => applyStreamChunkToSummary(summary, chunk), createEmptyStreamSummary())
}
