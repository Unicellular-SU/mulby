import type { AiModelParameters, AiTokenBreakdown } from '../../../shared/types/ai'

export type ImageCompatTaskDescriptor = {
  taskId: string
  taskStatus?: string
}

const DEFAULT_MAX_TOOL_STEPS = 20
const MAX_TOOL_STEPS_LIMIT = 100

export function resolveMaxToolSteps(maxToolSteps?: number): number {
  return Math.min(Math.max(Math.floor(maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS), 1), MAX_TOOL_STEPS_LIMIT)
}

export function buildApiKeyScope(input: { providerId?: string; providerType?: string; baseURL?: string }): string {
  const providerToken = String(input.providerId || input.providerType || 'default').trim() || 'default'
  const baseURL = String(input.baseURL || '').trim()
  return `provider:${providerToken}:${baseURL}`
}

export function parseCompatToolCallArgs(rawArgs: unknown): unknown {
  if (typeof rawArgs !== 'string') return rawArgs ?? {}
  const source = rawArgs.trim()
  if (!source) return {}
  try {
    const parsed = JSON.parse(source)
    if (typeof parsed !== 'string') return parsed
    const nested = parsed.trim()
    if (!nested) return {}
    try {
      return JSON.parse(nested)
    } catch {
      return parsed
    }
  } catch {
    return rawArgs
  }
}

export function mergeModelParams(...params: Array<AiModelParameters | undefined>) {
  const result: AiModelParameters = {}
  for (const item of params) {
    if (!item) continue
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value) && value.length === 0) continue
      ;(result as any)[key] = value
    }
  }
  return result
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return undefined
  return Math.min(Math.max(value, min), max)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getErrorMessageForLog(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || 'Unknown error'
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as any).message === 'string') {
    return (error as any).message
  }
  return 'Unknown error'
}

function collectErrorSignals(error: unknown, depth = 0, bucket: string[] = []): string[] {
  if (!error || depth > 6) return bucket
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
    const item = error as any
    if (typeof item.name === 'string') bucket.push(item.name)
    if (typeof item.message === 'string') bucket.push(item.message)
    if (typeof item.code === 'string') bucket.push(item.code)
    if (item.cause) collectErrorSignals(item.cause, depth + 1, bucket)
  }
  return bucket
}

export function isImageBase64DecodeError(error: unknown): boolean {
  const normalized = collectErrorSignals(error).join(' | ').toLowerCase()
  return (
    normalized.includes('invalidcharactererror') ||
    normalized.includes('invalid character') ||
    normalized.includes('convertbase64touint8array') ||
    normalized.includes('failed to process successful response')
  )
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function isCompatImageProviderType(providerType?: string): boolean {
  const normalized = String(providerType || '').trim().toLowerCase()
  return ['openai', 'openai-response', 'openai-compatible', 'new-api', 'cherryin', 'deepseek', 'openrouter', 'azure-openai', 'azure', 'ollama'].includes(normalized)
}

export function getImageModelIdFromModelKey(modelKey: any): string | undefined {
  const modelId = (modelKey as any)?.modelId
  if (typeof modelId === 'string' && modelId.trim()) return modelId.trim()
  return undefined
}

export function truncateText(value: string, maxLength = 240): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

export function parseJsonPayloadFromText(text: string): any | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    // Continue with tolerant parsing.
  }

  const ssePayloads: any[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const matched = line.trim().match(/^data:\s*(.+)$/i)
    if (!matched) continue
    const data = matched[1]?.trim()
    if (!data || data === '[DONE]') continue
    try {
      ssePayloads.push(JSON.parse(data))
    } catch {
      // Ignore invalid chunk and continue parsing remaining lines.
    }
  }
  if (ssePayloads.length > 0) {
    return ssePayloads[ssePayloads.length - 1]
  }

  const firstObject = trimmed.indexOf('{')
  const lastObject = trimmed.lastIndexOf('}')
  if (firstObject >= 0 && lastObject > firstObject) {
    const objectSlice = trimmed.slice(firstObject, lastObject + 1)
    try {
      return JSON.parse(objectSlice)
    } catch {
      // Continue with array slice parsing.
    }
  }

  const firstArray = trimmed.indexOf('[')
  const lastArray = trimmed.lastIndexOf(']')
  if (firstArray >= 0 && lastArray > firstArray) {
    const arraySlice = trimmed.slice(firstArray, lastArray + 1)
    try {
      return JSON.parse(arraySlice)
    } catch {
      return null
    }
  }

  return null
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (!text) continue
    return text
  }
  return undefined
}

export function isImageCompatImagesResult(value: unknown): value is { images: string[] } {
  return !!value && typeof value === 'object' && Array.isArray((value as { images?: unknown }).images)
}

export function isImageCompatTaskResult(value: unknown): value is ImageCompatTaskDescriptor {
  return !!value && typeof value === 'object' && typeof (value as { taskId?: unknown }).taskId === 'string'
}

function normalizeTaskStatus(status: unknown): string | undefined {
  if (typeof status !== 'string') return undefined
  const normalized = status.trim().toLowerCase()
  return normalized || undefined
}

export function extractImageResponsePayload(payload: any): { images: string[]; taskId?: string; taskStatus?: string } {
  const images: string[] = []
  const seenImages = new Set<string>()

  const pushMaybeImage = (value: unknown) => {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (!text || seenImages.has(text)) return
    seenImages.add(text)
    images.push(text)
  }

  const collectFromObject = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    pushMaybeImage(record.b64_json)
    pushMaybeImage(record.url)
    pushMaybeImage(record.image)
    pushMaybeImage(record.result)

    if (Array.isArray(record.images)) {
      for (const item of record.images) {
        if (typeof item === 'string') {
          pushMaybeImage(item)
        } else {
          collectFromObject(item)
        }
      }
    }
  }

  collectFromObject(payload)
  if (Array.isArray(payload?.data)) {
    for (const item of payload.data) {
      collectFromObject(item)
    }
  } else {
    collectFromObject(payload?.data)
  }
  if (Array.isArray(payload?.output)) {
    for (const item of payload.output) {
      collectFromObject(item)
    }
  } else {
    collectFromObject(payload?.output)
  }
  collectFromObject(payload?.item)
  collectFromObject(payload?.result)

  const taskStatus = normalizeTaskStatus(
    firstNonEmptyString([
      payload?.task_status,
      payload?.taskStatus,
      payload?.status,
      payload?.state,
      payload?.data?.task_status,
      payload?.data?.taskStatus,
      payload?.data?.status,
      payload?.result?.task_status,
      payload?.result?.taskStatus,
      payload?.result?.status
    ])
  )
  const taskId = firstNonEmptyString([
    payload?.task_id,
    payload?.taskId,
    payload?.id,
    payload?.request_id,
    payload?.requestId,
    payload?.data?.task_id,
    payload?.data?.taskId,
    payload?.data?.id,
    payload?.result?.task_id,
    payload?.result?.taskId,
    payload?.result?.id
  ])

  const hasExplicitTaskField =
    typeof payload?.task_id === 'string' ||
    typeof payload?.taskId === 'string' ||
    typeof payload?.task_status === 'string' ||
    typeof payload?.taskStatus === 'string' ||
    typeof payload?.data?.task_id === 'string' ||
    typeof payload?.data?.task_status === 'string'

  const hasTaskSignal = !!taskId && (hasExplicitTaskField || !!taskStatus || images.length === 0)

  if (!hasTaskSignal) {
    return { images }
  }
  return { images, taskId, taskStatus }
}

export function formatAsyncTaskStatus(status?: string): string {
  const normalized = normalizeTaskStatus(status)
  if (!normalized) return '处理中'
  if (['queued', 'pending', 'submitted', 'waiting', 'accepted'].includes(normalized)) return '排队中'
  if (['running', 'processing', 'in_progress', 'executing', 'doing'].includes(normalized)) return '处理中'
  if (['success', 'succeeded', 'completed', 'done', 'finish', 'finished'].includes(normalized)) return '已完成'
  if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(normalized)) return '失败'
  return normalized
}

export function isAsyncTaskSuccessStatus(status?: string): boolean {
  const normalized = normalizeTaskStatus(status)
  if (!normalized) return false
  return ['success', 'succeeded', 'completed', 'done', 'finish', 'finished'].includes(normalized)
}

export function isAsyncTaskFailureStatus(status?: string): boolean {
  const normalized = normalizeTaskStatus(status)
  if (!normalized) return false
  return ['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(normalized)
}

export function extractOpenAIImageStreamPayload(payload: any): { partials: string[]; finals: string[] } {
  const partials: string[] = []
  const finals: string[] = []

  const pushMaybeImage = (value: unknown, target: 'partial' | 'final') => {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (!text) return
    if (target === 'partial') {
      partials.push(text)
    } else {
      finals.push(text)
    }
  }

  pushMaybeImage(payload?.partial_image_b64, 'partial')
  pushMaybeImage(payload?.b64_json, 'final')
  pushMaybeImage(payload?.image, 'final')
  pushMaybeImage(payload?.result, payload?.type?.includes?.('partial') ? 'partial' : 'final')

  if (Array.isArray(payload?.data)) {
    for (const item of payload.data) {
      pushMaybeImage(item?.b64_json, 'final')
      pushMaybeImage(item?.url, 'final')
      pushMaybeImage(item?.image, 'final')
      pushMaybeImage(item?.result, 'final')
    }
  }

  const item = payload?.item
  if (item && typeof item === 'object') {
    pushMaybeImage(item?.result, 'final')
    if (Array.isArray(item?.data)) {
      for (const dataItem of item.data) {
        pushMaybeImage(dataItem?.b64_json, 'final')
        pushMaybeImage(dataItem?.url, 'final')
      }
    }
  }

  return { partials, finals }
}

export function detectImageMimeTypeFromBytes(data: Uint8Array): string {
  if (data.length >= 8) {
    if (
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    ) {
      return 'image/png'
    }
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return 'image/gif'
  }
  return 'image/png'
}

export function parseDataUrl(value: string): { mediaType?: string; base64: string } | null {
  const matched = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;(base64))?,(.*)$/i)
  if (!matched) return null
  const mediaType = matched[1] || undefined
  const isBase64 = matched[2]?.toLowerCase() === 'base64'
  const rawData = matched[3] || ''
  if (!rawData) return null
  if (!isBase64) {
    return {
      mediaType,
      base64: Buffer.from(decodeURIComponent(rawData), 'utf8').toString('base64')
    }
  }
  const normalized = normalizeBase64Text(rawData)
  if (!normalized) return null
  return { mediaType, base64: normalized }
}

export function normalizeBase64Text(input: string): string | null {
  const compact = input.replace(/\s+/g, '')
  if (!compact) return null

  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/')
  const mod = normalized.length % 4
  const padded = mod === 0 ? normalized : normalized + '='.repeat(4 - mod)
  if (!/^[A-Za-z0-9+/]+=*$/.test(padded)) return null
  return padded
}

export function normalizeModelParams(params: AiModelParameters): AiModelParameters {
  const normalized: AiModelParameters = {}
  if (params.contextWindow !== undefined) {
    const value = Math.max(0, Math.floor(params.contextWindow))
    if (value >= 0) normalized.contextWindow = value
  }
  if (params.temperatureEnabled !== undefined) normalized.temperatureEnabled = params.temperatureEnabled
  if (params.topPEnabled !== undefined) normalized.topPEnabled = params.topPEnabled
  if (params.maxOutputTokensEnabled !== undefined) normalized.maxOutputTokensEnabled = params.maxOutputTokensEnabled
  if (params.temperatureEnabled !== false && params.temperature !== undefined) {
    normalized.temperature = clampNumber(params.temperature, 0, 2)
  }
  if (params.topPEnabled !== false && params.topP !== undefined) {
    normalized.topP = clampNumber(params.topP, 0, 1)
  }
  if (params.topK !== undefined) normalized.topK = Math.max(0, params.topK)
  if (params.maxOutputTokensEnabled !== false && params.maxOutputTokens !== undefined) {
    normalized.maxOutputTokens = Math.max(1, params.maxOutputTokens)
  }
  if (params.presencePenalty !== undefined) normalized.presencePenalty = clampNumber(params.presencePenalty, -2, 2)
  if (params.frequencyPenalty !== undefined) normalized.frequencyPenalty = clampNumber(params.frequencyPenalty, -2, 2)
  if (params.stopSequences) normalized.stopSequences = params.stopSequences.filter((item) => item && item.trim().length > 0)
  if (params.seed !== undefined) normalized.seed = Math.floor(params.seed)
  return normalized
}

export function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === undefined) return 'null'
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

export function pickOpenAICompatContentSource(choice: any):
  | {
      content?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
      tool_calls?: any[]
    }
  | undefined {
  const hasUsefulData = (source: any): boolean => {
    if (!source || typeof source !== 'object') return false
    if (typeof source.content === 'string' && source.content.length > 0) return true
    if (Array.isArray(source.content) && source.content.length > 0) return true
    if (typeof source.reasoning_content === 'string' && source.reasoning_content.length > 0) return true
    if (typeof source.reasoning === 'string' && source.reasoning.length > 0) return true
    if (Array.isArray(source.tool_calls) && source.tool_calls.length > 0) return true
    return false
  }

  if (hasUsefulData(choice?.delta)) return choice.delta
  if (hasUsefulData(choice?.message)) return choice.message
  return undefined
}

export function extractOpenAICompatContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
          return (part as any).text
        }
        return ''
      })
      .join('')
  }
  return ''
}

export function extractUsage(result: any): { inputTokens?: number; outputTokens?: number } | undefined {
  const usage = result?.usage || result?.response?.usage || result?.metadata?.usage
  if (!usage) return undefined
  const inputTokens =
    usage.inputTokens ??
    usage.promptTokens ??
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.totalTokens ??
    usage.total_tokens
  const outputTokens =
    usage.outputTokens ??
    usage.completionTokens ??
    usage.completion_tokens ??
    usage.output_tokens
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return {
    inputTokens: inputTokens !== undefined ? Number(inputTokens) : undefined,
    outputTokens: outputTokens !== undefined ? Number(outputTokens) : undefined
  }
}

export function normalizeUsage(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  fallbackInput: number,
  fallbackOutput: number
): AiTokenBreakdown {
  return {
    inputTokens: usage?.inputTokens !== undefined ? usage.inputTokens : fallbackInput,
    outputTokens: usage?.outputTokens !== undefined ? usage.outputTokens : fallbackOutput
  }
}
