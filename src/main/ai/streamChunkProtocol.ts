import type { AiMessage } from '../../shared/types/ai'
import type { AiStreamErrorClassification } from '../../shared/ai/streamDiagnostics'

export function createMetaChunk(meta: {
  capability_debug?: AiMessage['capability_debug']
  policy_debug?: AiMessage['policy_debug']
}): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'meta',
    capability_debug: meta.capability_debug,
    policy_debug: meta.policy_debug
  }
}

export function createTextChunk(text: string): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'text',
    content: text
  }
}

export function createReasoningChunk(text: string): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'reasoning',
    reasoning_content: text
  }
}

export function createToolCallChunk(toolCall: { id: string; name: string; args?: unknown }): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'tool-call',
    tool_call: toolCall
  }
}

export function createToolProgressChunk(toolProgress: {
  id?: string
  name: string
  progress: number
  total?: number
  message?: string
}): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'tool-progress',
    tool_progress: toolProgress
  }
}

export function createToolResultChunk(toolResult: { id: string; name: string; result?: unknown }): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'tool-result',
    tool_result: toolResult
  }
}

/**
 * 多步工具循环中每轮 LLM 往返结束时的真实用量快照。
 * usage 为跨轮累计（与 end 块口径一致），usage_round 为本轮往返
 * （inputTokens=本轮完整 prompt，inputTokens+outputTokens≈本轮结束时的真实上下文大小）。
 */
export function createUsageChunk(input: {
  round: number
  roundUsage: { inputTokens?: number; outputTokens?: number }
  totalUsage: { inputTokens?: number; outputTokens?: number }
}): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'usage',
    tool_round: input.round,
    usage_round: input.roundUsage,
    usage: {
      inputTokens: input.totalUsage.inputTokens ?? 0,
      outputTokens: input.totalUsage.outputTokens ?? 0
    }
  }
}

export function createErrorChunk(error: Error, classification?: AiStreamErrorClassification): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'error',
    error: {
      message: error.message,
      code: classification?.code,
      category: classification?.category,
      retryable: classification?.retryable,
      statusCode: classification?.statusCode
    }
  }
}

export function createEndChunk(message: AiMessage): AiMessage {
  return {
    role: 'assistant',
    chunkType: 'end',
    usage: message.usage
  }
}
