export type AiStreamErrorCode =
  | 'AI_STREAM_ABORTED'
  | 'AI_STREAM_TOOL_MAX_STEPS_EXCEEDED'
  | 'AI_STREAM_TOOL_EXECUTOR_MISSING'
  | 'AI_STREAM_TOOL_EXECUTION_ERROR'
  | 'AI_STREAM_MODEL_CAPABILITY_BLOCKED'
  | 'AI_STREAM_HTTP_4XX'
  | 'AI_STREAM_HTTP_5XX'
  | 'AI_STREAM_NETWORK'
  | 'AI_STREAM_UNKNOWN'

export type AiStreamErrorCategory = 'abort' | 'tool' | 'model' | 'http' | 'network' | 'unknown'

export interface AiStreamErrorClassification {
  code: AiStreamErrorCode
  category: AiStreamErrorCategory
  retryable: boolean
  statusCode?: number
  message: string
}

interface ErrorLike {
  message?: unknown
  statusCode?: unknown
  status?: unknown
  isRetryable?: unknown
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Unknown error'
  if (typeof error === 'string') return error
  const candidate = toErrorLike(error)
  if (typeof candidate?.message === 'string') {
    return candidate.message
  }
  return 'Unknown error'
}

function parseHttpStatus(message: string): number | undefined {
  const matched = message.match(/HTTP\s+(\d{3})/)
  if (!matched?.[1]) return undefined
  const code = Number(matched[1])
  return Number.isFinite(code) ? code : undefined
}

function toErrorLike(error: unknown): ErrorLike | undefined {
  if (!error || typeof error !== 'object') return undefined
  return error as ErrorLike
}

function getStatusCode(error: unknown, message: string): number | undefined {
  const candidate = toErrorLike(error)
  const fromFields = candidate?.statusCode ?? candidate?.status
  if (typeof fromFields === 'number' && Number.isFinite(fromFields)) return fromFields
  if (typeof fromFields === 'string') {
    const parsed = Number(fromFields)
    if (Number.isFinite(parsed)) return parsed
  }
  return parseHttpStatus(message)
}

function getRetryableFromError(error: unknown): boolean | undefined {
  const candidate = toErrorLike(error)
  if (typeof candidate?.isRetryable === 'boolean') return candidate.isRetryable
  return undefined
}

function isAbortMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('abort') ||
    normalized.includes('aborted') ||
    normalized.includes('cancelled') ||
    normalized.includes('canceled')
  )
}

export function classifyAiStreamError(error: unknown): AiStreamErrorClassification {
  const message = getErrorMessage(error)
  const normalized = message.toLowerCase()

  if (isAbortMessage(message)) {
    return {
      code: 'AI_STREAM_ABORTED',
      category: 'abort',
      retryable: false,
      message
    }
  }

  if (normalized.includes('maxtoolsteps')) {
    return {
      code: 'AI_STREAM_TOOL_MAX_STEPS_EXCEEDED',
      category: 'tool',
      retryable: false,
      message
    }
  }

  if (normalized.includes('tool executor is not configured')) {
    return {
      code: 'AI_STREAM_TOOL_EXECUTOR_MISSING',
      category: 'tool',
      retryable: false,
      message
    }
  }

  if (normalized.includes('[ai_tool_execution_error]')) {
    return {
      code: 'AI_STREAM_TOOL_EXECUTION_ERROR',
      category: 'tool',
      retryable: false,
      message
    }
  }

  if (normalized.includes('does not support') && normalized.includes('capability')) {
    return {
      code: 'AI_STREAM_MODEL_CAPABILITY_BLOCKED',
      category: 'model',
      retryable: false,
      message
    }
  }

  const statusCode = getStatusCode(error, message)
  if (statusCode !== undefined) {
    const retryableFromError = getRetryableFromError(error)
    if (statusCode >= 500) {
      return {
        code: 'AI_STREAM_HTTP_5XX',
        category: 'http',
        retryable: retryableFromError ?? true,
        statusCode,
        message
      }
    }
    return {
      code: 'AI_STREAM_HTTP_4XX',
      category: 'http',
      retryable: retryableFromError ?? (statusCode === 408 || statusCode === 409 || statusCode === 429),
      statusCode,
      message
    }
  }

  if (
    normalized.includes('fetch failed') ||
    normalized.includes('network') ||
    normalized.includes('econn') ||
    normalized.includes('enotfound') ||
    normalized.includes('socket') ||
    normalized.includes('timeout')
  ) {
    return {
      code: 'AI_STREAM_NETWORK',
      category: 'network',
      retryable: true,
      message
    }
  }

  return {
    code: 'AI_STREAM_UNKNOWN',
    category: 'unknown',
    retryable: false,
    message
  }
}
