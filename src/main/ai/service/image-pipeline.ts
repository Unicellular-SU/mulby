import { generateImage } from 'ai'
import type { AiImageGenerateProgressChunk, AiProviderConfig } from '../../../shared/types/ai'
import { classifyAiImageError } from '../../../shared/ai/imageDiagnostics'
import {
  extractImageResponsePayload,
  extractOpenAIImageStreamPayload,
  formatAsyncTaskStatus,
  getErrorMessageForLog,
  getImageModelIdFromModelKey,
  isAsyncTaskFailureStatus,
  isAsyncTaskSuccessStatus,
  isImageBase64DecodeError,
  isImageCompatImagesResult,
  isImageCompatTaskResult,
  parseJsonPayloadFromText,
  sleep,
  truncateText,
  type ImageCompatTaskDescriptor
} from './utils'
import {
  getImageFallbackMessage as getImageFallbackMessageHelper,
  getImageStrategyCacheKey as getImageStrategyCacheKeyHelper,
  getImageStrategyOrder as getImageStrategyOrderHelper,
  markImageStrategySupported as markImageStrategySupportedHelper,
  markImageStrategyUnsupported as markImageStrategyUnsupportedHelper,
  normalizeRawGeneratedImages as normalizeRawGeneratedImagesHelper,
  resolveImageCompatTransport as resolveImageCompatTransportHelper,
  toDirectImagePrompt as toDirectImagePromptHelper,
  type ImageStrategyCapabilityState,
  type ImageCompatTransportContext
} from './image-helpers'

interface ImagePipelineContext {
  imageStrategyCapabilities: Map<string, ImageStrategyCapabilityState>
  resolveCompatBaseURL: (explicitBaseURL?: string, providerType?: string) => string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' ? value as UnknownRecord : undefined
}

export async function executeImageWithRetry<T>(
  stage: 'generateImages' | 'editImage',
  execute: () => Promise<T>,
  context: Record<string, unknown>
): Promise<T> {
  const maxAttempts = 2
  let attempt = 0
  while (attempt < maxAttempts) {
    attempt += 1
    try {
      return await execute()
    } catch (error) {
      const classified = classifyAiImageError(error)
      const finalAttempt = attempt >= maxAttempts
      if (!classified.retryable || finalAttempt) {
        if (classified.retryable && finalAttempt) {
          console.warn('[AI] image:retry:exhausted', {
            stage,
            attempt,
            maxAttempts,
            code: classified.code,
            statusCode: classified.statusCode,
            message: classified.message,
            ...context
          })
        }
        throw error
      }

      const delayMs = attempt * 800
      console.warn('[AI] image:retry', {
        stage,
        attempt,
        maxAttempts,
        delayMs,
        code: classified.code,
        statusCode: classified.statusCode,
        message: classified.message,
        ...context
      })
      await sleep(delayMs)
    }
  }

  throw new Error('Unexpected image retry state')
}

export async function generateImageWithProgress(input: ImagePipelineContext & {
  modelKey: unknown
  prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
  size?: string
  n?: number
  providerType?: string
  providerConfig?: AiProviderConfig
  abortSignal?: AbortSignal
  onChunk?: (chunk: AiImageGenerateProgressChunk) => void
}): Promise<{ images: string[] }> {
  const modelId = getImageModelIdFromModelKey(input.modelKey)
  const prompt = typeof input.prompt === 'string' ? input.prompt : input.prompt.text || ''
  const cacheKey = getImageStrategyCacheKeyHelper({
    providerType: input.providerType,
    providerConfig: input.providerConfig,
    modelId
  })
  const transport = resolveImageCompatTransportHelper({
    providerType: input.providerType,
    providerConfig: input.providerConfig,
    resolveCompatBaseURL: input.resolveCompatBaseURL
  })
  const order = getImageStrategyOrderHelper(input.imageStrategyCapabilities, cacheKey)
  let lastError: unknown
  let attemptedCount = 0

  console.info('[AI] image:strategy:order', {
    modelId,
    providerType: input.providerType,
    cacheKey,
    order
  })

  for (const strategy of order) {
    attemptedCount += 1
    if (input.abortSignal?.aborted) {
      throw new Error('Image generation aborted')
    }

    if (attemptedCount > 1) {
      const fallbackMessage = getImageFallbackMessageHelper(strategy)
      if (fallbackMessage) {
        input.onChunk?.({
          type: 'status',
          stage: 'fallback',
          message: fallbackMessage
        })
      }
    }

    console.info('[AI] image:strategy:try', {
      strategy,
      modelId,
      size: input.size,
      count: input.n
    })

    try {
      if (strategy === 'stream-sse') {
        const streamed = await streamOpenAIImageGeneration({
          ...input,
          modelId,
          prompt
        })
        if (streamed && streamed.images.length > 0) {
          markImageStrategySupportedHelper(input.imageStrategyCapabilities, cacheKey, 'stream-sse')
          return { images: streamed.images }
        }
        markImageStrategyUnsupportedHelper(input.imageStrategyCapabilities, cacheKey, 'stream-sse')
        continue
      }

      if (strategy === 'sync-json') {
        const direct = await generateImageViaCompatJson({
          modelId,
          prompt,
          size: input.size,
          n: input.n,
          transport,
          abortSignal: input.abortSignal
        })
        if (isImageCompatImagesResult(direct) && direct.images.length > 0) {
          markImageStrategySupportedHelper(input.imageStrategyCapabilities, cacheKey, 'sync-json')
          return { images: direct.images }
        }
        if (isImageCompatTaskResult(direct) && transport) {
          markImageStrategySupportedHelper(input.imageStrategyCapabilities, cacheKey, 'sync-json', 'async-job')
          const polled = await pollAsyncImageTask({
            taskId: direct.taskId,
            taskStatus: direct.taskStatus,
            transport,
            abortSignal: input.abortSignal,
            onChunk: input.onChunk,
            n: input.n
          })
          markImageStrategySupportedHelper(input.imageStrategyCapabilities, cacheKey, 'async-job')
          return { images: polled.images }
        }
        markImageStrategyUnsupportedHelper(input.imageStrategyCapabilities, cacheKey, 'sync-json')
        continue
      }

      if (strategy === 'async-job') {
        const asyncStart = await startAsyncImageTask({
          modelId,
          prompt,
          size: input.size,
          n: input.n,
          transport,
          abortSignal: input.abortSignal
        })
        if (isImageCompatImagesResult(asyncStart) && asyncStart.images.length > 0) {
          markImageStrategySupportedHelper(input.imageStrategyCapabilities, cacheKey, 'async-job')
          return { images: asyncStart.images }
        }
        if (isImageCompatTaskResult(asyncStart) && transport) {
          const polled = await pollAsyncImageTask({
            taskId: asyncStart.taskId,
            taskStatus: asyncStart.taskStatus,
            transport,
            abortSignal: input.abortSignal,
            onChunk: input.onChunk,
            n: input.n
          })
          markImageStrategySupportedHelper(input.imageStrategyCapabilities, cacheKey, 'async-job')
          return { images: polled.images }
        }
        markImageStrategyUnsupportedHelper(input.imageStrategyCapabilities, cacheKey, 'async-job')
        continue
      }

      const fallback = await generateImageWithDecodeFallback(input)
      markImageStrategySupportedHelper(input.imageStrategyCapabilities, cacheKey, 'sdk-direct')
      return fallback
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw error
      }
      lastError = error
      console.warn('[AI] image:strategy:failed', {
        strategy,
        message: getErrorMessageForLog(error),
        size: input.size,
        count: input.n
      })
      if (strategy === 'stream-sse') {
        console.warn('[AI] image:stream:unavailable', {
          message: getErrorMessageForLog(error),
          size: input.size,
          count: input.n
        })
      }
      markImageStrategyUnsupportedHelper(input.imageStrategyCapabilities, cacheKey, strategy)
    }
  }

  if (lastError) {
    throw lastError
  }
  return await generateImageWithDecodeFallback(input)
}

export async function generateImageWithDecodeFallback(input: {
  modelKey: unknown
  prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
  size?: string
  n?: number
  abortSignal?: AbortSignal
}): Promise<{ images: string[] }> {
  const directStart = Date.now()
  try {
    const images = await generateImageByDirectModelCall(input)
    console.info('[AI] image:generate:result', {
      stage: 'direct',
      count: images.length,
      firstPreview: images[0] ? String(images[0]).slice(0, 24) : '',
      durationMs: Date.now() - directStart
    })
    return { images }
  } catch (error) {
    console.warn('[AI] image:direct:failed', {
      message: getErrorMessageForLog(error),
      size: input.size,
      count: input.n
    })

    const sdkStart = Date.now()
    try {
      const result = await callGenerateImageSdk({
        model: input.modelKey,
        prompt: input.prompt,
        size: input.size,
        n: input.n,
        abortSignal: input.abortSignal
      })
      const images = extractSdkGeneratedImages(result)
      console.info('[AI] image:generate:result', {
        stage: 'sdk',
        count: images.length,
        firstPreview: images[0] ? String(images[0]).slice(0, 24) : '',
        durationMs: Date.now() - sdkStart
      })
      return { images }
    } catch (sdkError) {
      if (!isImageBase64DecodeError(sdkError)) {
        throw sdkError
      }
      console.warn('[AI] image:decode:fallback', {
        message: getErrorMessageForLog(sdkError),
        size: input.size,
        count: input.n
      })
      const images = await generateImageByDirectModelCall(input)
      console.info('[AI] image:generate:result', {
        stage: 'fallback',
        count: images.length,
        firstPreview: images[0] ? String(images[0]).slice(0, 24) : '',
        durationMs: Date.now() - sdkStart
      })
      return { images }
    }
  }
}

async function generateImageViaCompatJson(input: {
  modelId?: string
  prompt: string
  size?: string
  n?: number
  transport: ImageCompatTransportContext | null
  abortSignal?: AbortSignal
}): Promise<{ images: string[] } | ImageCompatTaskDescriptor | null> {
  if (!input.modelId || !input.prompt || !input.transport) return null

  const payload = await requestImageJson({
    method: 'POST',
    url: `${input.transport.baseURL}/images/generations`,
    headers: input.transport.headers,
    body: {
      model: input.modelId,
      prompt: input.prompt,
      n: Math.max(1, Number(input.n || 1)),
      size: input.size
    },
    abortSignal: input.abortSignal
  })

  const extracted = extractImageResponsePayload(payload)
  if (extracted.images.length > 0) {
    const images = await normalizeRawGeneratedImagesHelper(extracted.images, input.abortSignal)
    return { images }
  }
  if (extracted.taskId) {
    return { taskId: extracted.taskId, taskStatus: extracted.taskStatus }
  }
  return null
}

async function startAsyncImageTask(input: {
  modelId?: string
  prompt: string
  size?: string
  n?: number
  transport: ImageCompatTransportContext | null
  abortSignal?: AbortSignal
}): Promise<{ images: string[] } | ImageCompatTaskDescriptor | null> {
  if (!input.modelId || !input.prompt || !input.transport) return null

  const payload = await requestImageJson({
    method: 'POST',
    url: `${input.transport.baseURL}/async/images/generations`,
    headers: input.transport.headers,
    body: {
      model: input.modelId,
      prompt: input.prompt,
      n: Math.max(1, Number(input.n || 1)),
      size: input.size
    },
    abortSignal: input.abortSignal
  })

  const extracted = extractImageResponsePayload(payload)
  if (extracted.images.length > 0) {
    const images = await normalizeRawGeneratedImagesHelper(extracted.images, input.abortSignal)
    return { images }
  }
  if (extracted.taskId) {
    return { taskId: extracted.taskId, taskStatus: extracted.taskStatus }
  }
  return null
}

async function pollAsyncImageTask(input: {
  taskId: string
  taskStatus?: string
  transport: ImageCompatTransportContext
  abortSignal?: AbortSignal
  onChunk?: (chunk: AiImageGenerateProgressChunk) => void
  n?: number
}): Promise<{ images: string[] }> {
  const intervalMs = 1800
  const timeoutMs = 180000
  const startedAt = Date.now()
  let latestStatus = input.taskStatus

  while (Date.now() - startedAt < timeoutMs) {
    if (input.abortSignal?.aborted) {
      throw new Error('Image generation aborted')
    }

    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000))
    input.onChunk?.({
      type: 'status',
      stage: 'partial',
      message: `异步任务处理中（${formatAsyncTaskStatus(latestStatus)}）... ${elapsedSeconds}s`
    })

    const payload = await requestImageJson({
      method: 'GET',
      url: `${input.transport.baseURL}/async-result/${encodeURIComponent(input.taskId)}`,
      headers: input.transport.headers,
      abortSignal: input.abortSignal
    })
    const extracted = extractImageResponsePayload(payload)
    latestStatus = extracted.taskStatus || latestStatus

    if (extracted.images.length > 0) {
      input.onChunk?.({
        type: 'status',
        stage: 'finalizing',
        message: '异步任务完成，正在整理图片...'
      })
      const normalized = await normalizeRawGeneratedImagesHelper(extracted.images, input.abortSignal)
      if (normalized.length > 0) {
        return { images: normalized }
      }
    }

    if (isAsyncTaskFailureStatus(latestStatus)) {
      throw new Error(`Image async task failed: ${latestStatus}`)
    }

    if (isAsyncTaskSuccessStatus(latestStatus)) {
      throw new Error('Image async task completed but no images were returned')
    }

    await sleep(intervalMs)
  }

  throw new Error(`Image async task timeout after ${Math.floor(timeoutMs / 1000)}s`)
}

async function requestImageJson(input: {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: Record<string, unknown>
  abortSignal?: AbortSignal
}): Promise<unknown> {
  const requestHeaders: Record<string, string> = { ...input.headers }
  if (input.method === 'GET') {
    delete requestHeaders['Content-Type']
    delete requestHeaders['content-type']
  }
  const response = await fetch(input.url, {
    method: input.method,
    headers: requestHeaders,
    body: input.method === 'POST' ? JSON.stringify(input.body || {}) : undefined,
    signal: input.abortSignal
  })
  const responseText = await response.text().catch(() => '')

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}${responseText ? ` - ${truncateText(responseText, 280)}` : ''}`)
  }

  const payload = parseJsonPayloadFromText(responseText)
  if (!payload) {
    throw new Error('Invalid JSON response')
  }
  return payload
}

async function streamOpenAIImageGeneration(input: ImagePipelineContext & {
  modelId?: string
  prompt: string
  size?: string
  n?: number
  providerType?: string
  providerConfig?: AiProviderConfig
  abortSignal?: AbortSignal
  onChunk?: (chunk: AiImageGenerateProgressChunk) => void
}): Promise<{ images: string[] } | null> {
  if (!input.modelId || !input.prompt) return null

  const transport = resolveImageCompatTransportHelper({
    providerType: input.providerType,
    providerConfig: input.providerConfig,
    resolveCompatBaseURL: input.resolveCompatBaseURL
  })
  if (!transport) return null
  const url = `${transport.baseURL}/images/generations`
  const headers = transport.headers

  const streamController = new AbortController()
  const relayAbort = () => streamController.abort(input.abortSignal?.reason)
  if (input.abortSignal) {
    if (input.abortSignal.aborted) {
      streamController.abort(input.abortSignal.reason)
    } else {
      input.abortSignal.addEventListener('abort', relayAbort, { once: true })
    }
  }

  const firstByteTimeoutMs = 12000
  let firstByteReceived = false
  const firstByteTimer = setTimeout(() => {
    if (!firstByteReceived) {
      streamController.abort(new Error(`AI_IMAGE_STREAM_FIRST_BYTE_TIMEOUT_${firstByteTimeoutMs}ms`))
    }
  }, firstByteTimeoutMs)

  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal: streamController.signal,
    body: JSON.stringify({
      model: input.modelId,
      prompt: input.prompt,
      n: Math.max(1, Number(input.n || 1)),
      size: input.size,
      response_format: 'b64_json',
      stream: true,
      partial_images: 2
    })
  })

  if (!response.ok) {
    clearTimeout(firstByteTimer)
    if (input.abortSignal) input.abortSignal.removeEventListener('abort', relayAbort)
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`)
  }
  if (!response.body) {
    clearTimeout(firstByteTimer)
    if (input.abortSignal) input.abortSignal.removeEventListener('abort', relayAbort)
    return null
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const partialImages = new Map<number, string>()
  const finalRaw: string[] = []
  let buffer = ''
  let sawSseData = false
  const heartbeatStartAt = Date.now()
  const heartbeatTimer = setInterval(() => {
    input.onChunk?.({
      type: 'status',
      stage: 'partial',
      message: `生成中... ${Math.floor((Date.now() - heartbeatStartAt) / 1000)}s`
    })
  }, 3000)

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!firstByteReceived) {
        firstByteReceived = true
        clearTimeout(firstByteTimer)
        input.onChunk?.({
          type: 'status',
          stage: 'partial',
          message: '已建立流式连接，等待分片...'
        })
      }
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line || !line.startsWith('data:')) continue
        sawSseData = true
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue

        let payload: unknown
        try {
          payload = JSON.parse(data)
        } catch {
          continue
        }

        const parsed = extractOpenAIImageStreamPayload(payload)
        for (const partial of parsed.partials) {
          const index = partialImages.size
          partialImages.set(index, partial)
          input.onChunk?.({
            type: 'preview',
            stage: 'partial',
            image: partial,
            index,
            received: partialImages.size,
            total: input.n || 1
          })
        }
        for (const item of parsed.finals) {
          finalRaw.push(item)
        }
      }
    }

    if (!sawSseData) {
      const payloadText = buffer.trim()
      if (!payloadText) return null
      let payload: unknown
      try {
        payload = JSON.parse(payloadText)
      } catch {
        return null
      }
      const parsed = extractOpenAIImageStreamPayload(payload)
      finalRaw.push(...parsed.finals)
    }

    input.onChunk?.({
      type: 'status',
      stage: 'finalizing',
      message: '正在整理最终图片...'
    })

    const normalized = finalRaw.length > 0
      ? await normalizeRawGeneratedImagesHelper(finalRaw, input.abortSignal)
      : await normalizeRawGeneratedImagesHelper([...partialImages.values()], input.abortSignal)

    if (normalized.length === 0) return null
    return { images: normalized }
  } finally {
    clearTimeout(firstByteTimer)
    clearInterval(heartbeatTimer)
    if (input.abortSignal) input.abortSignal.removeEventListener('abort', relayAbort)
  }
}

async function generateImageByDirectModelCall(input: {
  modelKey: unknown
  prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
  size?: string
  n?: number
  abortSignal?: AbortSignal
}): Promise<string[]> {
  const model = input.modelKey as {
    doGenerate?: (options: Record<string, unknown>) => Promise<{ images?: unknown } | null | undefined>
  }
  if (!model || typeof model.doGenerate !== 'function') {
    throw new Error('Image model does not support direct doGenerate fallback')
  }

  const promptPayload = toDirectImagePromptHelper(input.prompt)
  const response = await model.doGenerate({
    prompt: promptPayload.prompt,
    files: promptPayload.files,
    mask: promptPayload.mask,
    n: Math.max(1, Number(input.n || 1)),
    size: input.size,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: {},
    headers: undefined,
    abortSignal: input.abortSignal
  })
  return await normalizeRawGeneratedImagesHelper(response?.images, input.abortSignal)
}

async function callGenerateImageSdk(input: {
  model: unknown
  prompt: unknown
  size?: string
  n?: number
  abortSignal?: AbortSignal
}): Promise<unknown> {
  const callGenerateImage = generateImage as unknown as (options: {
    model: unknown
    prompt: unknown
    size?: string
    n?: number
    abortSignal?: AbortSignal
  }) => Promise<unknown>
  return await callGenerateImage(input)
}

function extractSdkGeneratedImages(result: unknown): string[] {
  const images = asRecord(result)?.images
  if (!Array.isArray(images)) return []
  return images
    .map((item) => {
      if (typeof item === 'string') return item
      const record = asRecord(item)
      return typeof record?.base64 === 'string' ? record.base64 : ''
    })
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}
