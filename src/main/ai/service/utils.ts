import type { AiModelParameters, AiTokenBreakdown } from '../../../shared/types/ai'

export type ImageCompatTaskDescriptor = {
  taskId: string
  taskStatus?: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' ? value as UnknownRecord : undefined
}

const DEFAULT_MAX_TOOL_STEPS = 20
const MAX_TOOL_STEPS_LIMIT = 300

export function resolveMaxToolSteps(maxToolSteps?: number): number {
  return Math.min(Math.max(Math.floor(maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS), 1), MAX_TOOL_STEPS_LIMIT)
}

export function buildApiKeyScope(input: { providerId?: string; providerType?: string; baseURL?: string }): string {
  const providerToken = String(input.providerId || input.providerType || 'default').trim() || 'default'
  const baseURL = String(input.baseURL || '').trim()
  return `provider:${providerToken}:${baseURL}`
}

/**
 * Replace literal control characters (LF, CR, TAB) that appear **inside JSON
 * string values** with their JSON escape equivalents (`\n`, `\t`).
 *
 * Structural whitespace between JSON tokens (e.g., in pretty-printed output)
 * is left untouched so that valid formatted JSON remains parseable.
 *
 * Returns `null` when no in-string control characters were found (nothing to fix).
 */
export function sanitizeControlCharsInJsonStrings(source: string): string | null {
  let changed = false
  let inString = false
  const out: string[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (inString) {
      if (ch === '\\') {
        // Escaped character – copy backslash + next char verbatim
        out.push(ch)
        i++
        if (i < source.length) {
          out.push(source[i])
        }
        i++
        continue
      }
      if (ch === '"') {
        inString = false
        out.push(ch)
        i++
        continue
      }
      const code = ch.charCodeAt(0)
      if (code === 0x0D) { // CR
        // Handle CRLF as a single unit
        if (i + 1 < source.length && source.charCodeAt(i + 1) === 0x0A) {
          i++ // skip the LF half
        }
        out.push('\\', 'n')
        changed = true
      } else if (code === 0x0A) { // LF
        out.push('\\', 'n')
        changed = true
      } else if (code === 0x09) { // TAB
        out.push('\\', 't')
        changed = true
      } else {
        out.push(ch)
      }
      i++
      continue
    }
    // Outside a string literal
    if (ch === '"') {
      inString = true
    }
    out.push(ch)
    i++
  }
  return changed ? out.join('') : null
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
    // Most common cause: LLM produces literal newline/tab/CR chars inside JSON
    // string values. Use context-aware sanitizer that only escapes control chars
    // inside string literals, preserving structural whitespace in pretty-printed JSON.
    const controlFixed = sanitizeControlCharsInJsonStrings(source)
    if (controlFixed) {
      try {
        return JSON.parse(controlFixed)
      } catch {
        // fall through
      }
    }
    // Try sanitizing non-standard backslash escapes (e.g. "\|" from some providers)
    const base = controlFixed ?? source
    const escapeSanitized = base.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
    if (escapeSanitized !== base) {
      try {
        return JSON.parse(escapeSanitized)
      } catch {
        // fall through
      }
    }
    // Try extracting an embedded JSON object from within the string
    const extractBase = controlFixed ?? source
    const firstBrace = extractBase.indexOf('{')
    const lastBrace = extractBase.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = extractBase.slice(firstBrace, lastBrace + 1)
      try {
        return JSON.parse(slice)
      } catch {
        // fall through
      }
    }
    return rawArgs
  }
}

export function mergeModelParams(...params: Array<AiModelParameters | undefined>) {
  const result: AiModelParameters = {}
  const resultRecord = result as Record<string, unknown>
  for (const item of params) {
    if (!item) continue
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value) && value.length === 0) continue
      resultRecord[key] = value
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
  const errorRecord = asRecord(error)
  if (typeof errorRecord?.message === 'string') {
    return errorRecord.message
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
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause) collectErrorSignals(cause, depth + 1, bucket)
    return bucket
  }
  if (typeof error === 'object') {
    const item = asRecord(error)
    if (typeof item?.name === 'string') bucket.push(item.name)
    if (typeof item?.message === 'string') bucket.push(item.message)
    if (typeof item?.code === 'string') bucket.push(item.code)
    if (item?.cause) collectErrorSignals(item.cause, depth + 1, bucket)
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

export function getImageModelIdFromModelKey(modelKey: unknown): string | undefined {
  const modelId = asRecord(modelKey)?.modelId
  if (typeof modelId === 'string' && modelId.trim()) return modelId.trim()
  return undefined
}

export function truncateText(value: string, maxLength = 240): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

export function parseJsonPayloadFromText(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    // Continue with tolerant parsing.
  }

  const ssePayloads: unknown[] = []
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

export function extractImageResponsePayload(payload: unknown): { images: string[]; taskId?: string; taskStatus?: string } {
  const root = asRecord(payload)
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

  collectFromObject(root)

  const data = root?.data
  if (Array.isArray(data)) {
    for (const item of data) {
      collectFromObject(item)
    }
  } else {
    collectFromObject(data)
  }

  const output = root?.output
  if (Array.isArray(output)) {
    for (const item of output) {
      collectFromObject(item)
    }
  } else {
    collectFromObject(output)
  }

  const item = root?.item
  const result = root?.result
  collectFromObject(item)
  collectFromObject(result)

  const dataRecord = asRecord(data)
  const resultRecord = asRecord(result)

  const taskStatus = normalizeTaskStatus(
    firstNonEmptyString([
      root?.task_status,
      root?.taskStatus,
      root?.status,
      root?.state,
      dataRecord?.task_status,
      dataRecord?.taskStatus,
      dataRecord?.status,
      resultRecord?.task_status,
      resultRecord?.taskStatus,
      resultRecord?.status
    ])
  )
  const taskId = firstNonEmptyString([
    root?.task_id,
    root?.taskId,
    root?.id,
    root?.request_id,
    root?.requestId,
    dataRecord?.task_id,
    dataRecord?.taskId,
    dataRecord?.id,
    resultRecord?.task_id,
    resultRecord?.taskId,
    resultRecord?.id
  ])

  const hasExplicitTaskField =
    typeof root?.task_id === 'string' ||
    typeof root?.taskId === 'string' ||
    typeof root?.task_status === 'string' ||
    typeof root?.taskStatus === 'string' ||
    typeof dataRecord?.task_id === 'string' ||
    typeof dataRecord?.task_status === 'string'

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

export function extractOpenAIImageStreamPayload(payload: unknown): { partials: string[]; finals: string[] } {
  const root = asRecord(payload)
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

  pushMaybeImage(root?.partial_image_b64, 'partial')
  pushMaybeImage(root?.b64_json, 'final')
  pushMaybeImage(root?.image, 'final')
  pushMaybeImage(
    root?.result,
    typeof root?.type === 'string' && root.type.includes('partial') ? 'partial' : 'final'
  )

  if (Array.isArray(root?.data)) {
    for (const item of root.data) {
      const itemRecord = asRecord(item)
      pushMaybeImage(itemRecord?.b64_json, 'final')
      pushMaybeImage(itemRecord?.url, 'final')
      pushMaybeImage(itemRecord?.image, 'final')
      pushMaybeImage(itemRecord?.result, 'final')
    }
  }

  const item = asRecord(root?.item)
  if (item) {
    pushMaybeImage(item.result, 'final')
    if (Array.isArray(item.data)) {
      for (const dataItem of item.data) {
        const dataRecord = asRecord(dataItem)
        pushMaybeImage(dataRecord?.b64_json, 'final')
        pushMaybeImage(dataRecord?.url, 'final')
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
  if (params.reasoningEffort && ['minimal', 'low', 'medium', 'high', 'max'].includes(params.reasoningEffort)) {
    normalized.reasoningEffort = params.reasoningEffort
  }
  if (params.thinking === 'enabled' || params.thinking === 'disabled') {
    normalized.thinking = params.thinking
  }
  return normalized
}

/**
 * OpenAI-compatible reasoning controls to merge into a /chat/completions body.
 * `reasoning_effort` (string) and `thinking:{type}` cover OpenAI o-series, gpt-5,
 * deepseek-v4 and most compatible providers. Returns {} when neither is set, so
 * spreading it is a no-op for everyone else (zero regression).
 */
export function openAiCompatReasoningBody(params: AiModelParameters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (params.reasoningEffort) out.reasoning_effort = params.reasoningEffort
  if (params.thinking) out.thinking = { type: params.thinking }
  return out
}

/**
 * AI SDK `providerOptions` for reasoning control. `providerOptions` is keyed by
 * provider, and the SDK only applies the key matching the active provider — so we
 * can safely emit openai / anthropic / google together without detecting which one
 * is in use. Returns undefined when no control is requested (omit the option).
 */
export function buildSdkReasoningProviderOptions(
  params: AiModelParameters
): Record<string, Record<string, unknown>> | undefined {
  const openai: Record<string, unknown> = {}
  const anthropic: Record<string, unknown> = {}
  const google: Record<string, unknown> = {}
  if (params.reasoningEffort) openai.reasoningEffort = params.reasoningEffort
  if (params.thinking === 'disabled') {
    anthropic.thinking = { type: 'disabled' }
    google.thinkingConfig = { thinkingBudget: 0, includeThoughts: false }
  } else if (params.thinking === 'enabled') {
    anthropic.thinking = { type: 'enabled', budgetTokens: 2048 }
    google.thinkingConfig = { includeThoughts: true }
  }
  const out: Record<string, Record<string, unknown>> = {}
  if (Object.keys(openai).length) out.openai = openai
  if (Object.keys(anthropic).length) out.anthropic = anthropic
  if (Object.keys(google).length) out.google = google
  return Object.keys(out).length ? out : undefined
}

/** AiModelParameters minus the reasoning-control fields (which go via providerOptions, not top-level). */
export function stripReasoningParams(params: AiModelParameters): AiModelParameters {
  const rest = { ...params }
  delete rest.reasoningEffort
  delete rest.thinking
  return rest
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

type OpenAICompatContentSource = {
  content?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
  tool_calls?: unknown[]
}

export function pickOpenAICompatContentSource(choice: unknown):
  | {
      content?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
      tool_calls?: unknown[]
    }
  | undefined {
  const hasUsefulData = (source: unknown): source is OpenAICompatContentSource => {
    const sourceRecord = asRecord(source)
    if (!sourceRecord) return false
    if (typeof sourceRecord.content === 'string' && sourceRecord.content.length > 0) return true
    if (Array.isArray(sourceRecord.content) && sourceRecord.content.length > 0) return true
    if (typeof sourceRecord.reasoning_content === 'string' && sourceRecord.reasoning_content.length > 0) return true
    if (typeof sourceRecord.reasoning === 'string' && sourceRecord.reasoning.length > 0) return true
    if (Array.isArray(sourceRecord.tool_calls) && sourceRecord.tool_calls.length > 0) return true
    return false
  }

  const choiceRecord = asRecord(choice)
  if (hasUsefulData(choiceRecord?.delta)) return choiceRecord.delta
  if (hasUsefulData(choiceRecord?.message)) return choiceRecord.message
  return undefined
}

export function extractOpenAICompatContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        const partRecord = asRecord(part)
        if (typeof partRecord?.text === 'string') {
          return partRecord.text
        }
        return ''
      })
      .join('')
  }
  return ''
}

export function extractUsage(result: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  const resultRecord = asRecord(result)
  const responseRecord = asRecord(resultRecord?.response)
  const metadataRecord = asRecord(resultRecord?.metadata)
  const usage = resultRecord?.totalUsage ?? resultRecord?.usage ?? responseRecord?.usage ?? metadataRecord?.usage
  const usageRecord = asRecord(usage)
  if (!usageRecord) return undefined
  const inputTokens =
    usageRecord.inputTokens ??
    usageRecord.promptTokens ??
    usageRecord.prompt_tokens ??
    usageRecord.input_tokens ??
    usageRecord.totalTokens ??
    usageRecord.total_tokens
  const outputTokens =
    usageRecord.outputTokens ??
    usageRecord.completionTokens ??
    usageRecord.completion_tokens ??
    usageRecord.output_tokens
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return {
    inputTokens: inputTokens !== undefined ? Number(inputTokens) : undefined,
    outputTokens: outputTokens !== undefined ? Number(outputTokens) : undefined
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function'
}

async function resolveOptionalPromise(value: unknown): Promise<unknown> {
  return isPromiseLike(value) ? await value : value
}

export async function extractUsageAsync(result: unknown): Promise<{ inputTokens?: number; outputTokens?: number } | undefined> {
  const resultRecord = asRecord(result)
  if (!resultRecord) return undefined

  const sources = [
    resultRecord.totalUsage,
    resultRecord.usage,
    asRecord(resultRecord.response)?.usage,
    asRecord(resultRecord.metadata)?.usage
  ]

  for (const source of sources) {
    const usage = extractUsage({ usage: await resolveOptionalPromise(source) })
    if (usage) return usage
  }

  return undefined
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
