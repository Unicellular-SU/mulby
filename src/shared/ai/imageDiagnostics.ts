export type AiImageErrorCode =
  | 'AI_IMAGE_ABORTED'
  | 'AI_IMAGE_HTTP_4XX'
  | 'AI_IMAGE_HTTP_5XX'
  | 'AI_IMAGE_NETWORK'
  | 'AI_IMAGE_UNKNOWN'

export interface AiImageErrorClassification {
  code: AiImageErrorCode
  retryable: boolean
  statusCode?: number
  message: string
}

interface ErrorLike {
  message?: unknown
  statusCode?: unknown
  status?: unknown
  isRetryable?: unknown
  cause?: unknown
  code?: unknown
  name?: unknown
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Unknown error'
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as any).message === 'string') {
    return (error as any).message
  }
  return 'Unknown error'
}

function toErrorLike(error: unknown): ErrorLike | undefined {
  if (!error || typeof error !== 'object') return undefined
  return error as ErrorLike
}

function parseHttpStatus(message: string): number | undefined {
  const matched = message.match(/HTTP\s+(\d{3})/)
  if (!matched?.[1]) return undefined
  const code = Number(matched[1])
  return Number.isFinite(code) ? code : undefined
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

function collectErrorSignals(error: unknown, depth = 0, bucket: string[] = []): string[] {
  if (depth > 6 || !error) return bucket

  if (typeof error === 'string') {
    bucket.push(error)
    return bucket
  }

  if (error instanceof Error) {
    if (error.name) bucket.push(error.name)
    if (error.message) bucket.push(error.message)
    const cause = (error as any).cause
    if (cause) collectErrorSignals(cause, depth + 1, bucket)
    return bucket
  }

  if (typeof error === 'object') {
    const item = error as ErrorLike
    if (typeof item.name === 'string') bucket.push(item.name)
    if (typeof item.message === 'string') bucket.push(item.message)
    if (typeof item.code === 'string') bucket.push(item.code)
    if (item.cause) collectErrorSignals(item.cause, depth + 1, bucket)
  }

  return bucket
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

function hasNetworkSignal(normalized: string): boolean {
  const signals = [
    'terminated',
    'und_err_socket',
    'socket',
    'econn',
    'etimedout',
    'timeout',
    'enotfound',
    'network',
    'fetch failed',
    'other side closed'
  ]
  return signals.some((item) => normalized.includes(item))
}

export function classifyAiImageError(error: unknown): AiImageErrorClassification {
  const message = getErrorMessage(error)
  const signalText = collectErrorSignals(error).join(' | ').toLowerCase()
  const statusCode = getStatusCode(error, message)
  const retryableFromError = getRetryableFromError(error)

  if (isAbortMessage(signalText || message)) {
    return {
      code: 'AI_IMAGE_ABORTED',
      retryable: false,
      statusCode,
      message
    }
  }

  const networkSignal = hasNetworkSignal(signalText)
  const hasSuccessfulResponseParseFailure =
    signalText.includes('failed to process successful response') ||
    signalText.includes('failed to process error response')

  if (statusCode !== undefined) {
    if (statusCode >= 500) {
      return {
        code: 'AI_IMAGE_HTTP_5XX',
        retryable: retryableFromError ?? true,
        statusCode,
        message
      }
    }
    if (statusCode >= 400) {
      return {
        code: 'AI_IMAGE_HTTP_4XX',
        retryable: retryableFromError ?? [408, 409, 425, 429].includes(statusCode),
        statusCode,
        message
      }
    }
    if (networkSignal || (statusCode === 200 && hasSuccessfulResponseParseFailure)) {
      return {
        code: 'AI_IMAGE_NETWORK',
        retryable: true,
        statusCode,
        message
      }
    }
  }

  if (networkSignal) {
    return {
      code: 'AI_IMAGE_NETWORK',
      retryable: true,
      statusCode,
      message
    }
  }

  return {
    code: 'AI_IMAGE_UNKNOWN',
    retryable: false,
    statusCode,
    message
  }
}
