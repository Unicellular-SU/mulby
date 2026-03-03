import type { AiProviderConfig } from '../../../shared/types/ai'
import { getRotatedApiKey } from '../../../shared/ai/apiKeyPool'
import {
  buildApiKeyScope,
  detectImageMimeTypeFromBytes,
  isCompatImageProviderType,
  isHttpUrl,
  normalizeBase64Text,
  parseDataUrl
} from './utils'

export type ImageExecutionStrategy = 'stream-sse' | 'sync-json' | 'async-job' | 'sdk-direct'

export interface ImageStrategyCapabilityState {
  streamSupported?: boolean
  syncSupported?: boolean
  asyncSupported?: boolean
  preferredStrategy?: ImageExecutionStrategy
  updatedAt: number
}

export interface ImageCompatTransportContext {
  baseURL: string
  headers: Record<string, string>
}

export type DirectImageFile =
  | { type: 'file'; mediaType: string; data: string | Uint8Array }
  | { type: 'url'; url: string }

export function getImageStrategyCacheKey(input: {
  providerType?: string
  providerConfig?: AiProviderConfig
  modelId?: string
}): string {
  const normalizedType = String(input.providerType || '').trim().toLowerCase() || 'unknown'
  const normalizedModel = String(input.modelId || '').trim().toLowerCase() || 'unknown-model'
  const normalizedBaseURL = String(input.providerConfig?.baseURL || '').trim().toLowerCase() || 'default'
  return `${normalizedType}|${normalizedBaseURL}|${normalizedModel}`
}

export function getImageStrategyOrder(
  imageStrategyCapabilities: Map<string, ImageStrategyCapabilityState>,
  cacheKey: string
): ImageExecutionStrategy[] {
  const state = imageStrategyCapabilities.get(cacheKey)
  const cacheTtlMs = 10 * 60 * 1000
  if (state && Date.now() - state.updatedAt > cacheTtlMs) {
    imageStrategyCapabilities.delete(cacheKey)
  }

  const current = imageStrategyCapabilities.get(cacheKey)
  const order: ImageExecutionStrategy[] = []
  const pushStrategy = (strategy: ImageExecutionStrategy) => {
    if (!order.includes(strategy)) {
      order.push(strategy)
    }
  }

  if (current?.preferredStrategy && current.preferredStrategy !== 'sdk-direct') {
    pushStrategy(current.preferredStrategy)
  }
  if (current?.streamSupported !== false) pushStrategy('stream-sse')
  if (current?.syncSupported !== false) pushStrategy('sync-json')
  if (current?.asyncSupported !== false) pushStrategy('async-job')
  pushStrategy('sdk-direct')
  return order
}

export function setImageStrategyCapability(
  imageStrategyCapabilities: Map<string, ImageStrategyCapabilityState>,
  cacheKey: string,
  patch: Partial<ImageStrategyCapabilityState>
): void {
  const current = imageStrategyCapabilities.get(cacheKey) || { updatedAt: Date.now() }
  imageStrategyCapabilities.set(cacheKey, {
    ...current,
    ...patch,
    updatedAt: Date.now()
  })
}

export function markImageStrategySupported(
  imageStrategyCapabilities: Map<string, ImageStrategyCapabilityState>,
  cacheKey: string,
  strategy: ImageExecutionStrategy,
  preferredStrategy?: ImageExecutionStrategy
): void {
  if (strategy === 'stream-sse') {
    setImageStrategyCapability(imageStrategyCapabilities, cacheKey, { streamSupported: true, preferredStrategy: preferredStrategy || strategy })
    return
  }
  if (strategy === 'sync-json') {
    setImageStrategyCapability(imageStrategyCapabilities, cacheKey, { syncSupported: true, preferredStrategy: preferredStrategy || strategy })
    return
  }
  if (strategy === 'async-job') {
    setImageStrategyCapability(imageStrategyCapabilities, cacheKey, { asyncSupported: true, preferredStrategy: preferredStrategy || strategy })
    return
  }
  setImageStrategyCapability(imageStrategyCapabilities, cacheKey, { preferredStrategy: preferredStrategy || strategy })
}

export function markImageStrategyUnsupported(
  imageStrategyCapabilities: Map<string, ImageStrategyCapabilityState>,
  cacheKey: string,
  strategy: ImageExecutionStrategy
): void {
  if (strategy === 'stream-sse') {
    setImageStrategyCapability(imageStrategyCapabilities, cacheKey, { streamSupported: false })
    return
  }
  if (strategy === 'sync-json') {
    setImageStrategyCapability(imageStrategyCapabilities, cacheKey, { syncSupported: false })
    return
  }
  if (strategy === 'async-job') {
    setImageStrategyCapability(imageStrategyCapabilities, cacheKey, { asyncSupported: false })
  }
}

export function getImageFallbackMessage(strategy: ImageExecutionStrategy): string | undefined {
  if (strategy === 'sync-json') {
    return '流式进度不可用，尝试同步生成协议...'
  }
  if (strategy === 'async-job') {
    return '检测到异步任务协议，切换轮询进度...'
  }
  if (strategy === 'sdk-direct') {
    return '协议兼容路径不可用，回退 SDK 直连...'
  }
  return undefined
}

export function resolveImageCompatTransport(input: {
  providerType?: string
  providerConfig?: AiProviderConfig
  resolveCompatBaseURL: (explicitBaseURL?: string, providerType?: string) => string
}): ImageCompatTransportContext | null {
  const { providerType, providerConfig } = input
  if (!isCompatImageProviderType(providerType)) {
    return null
  }

  const baseURL = input.resolveCompatBaseURL(providerConfig?.baseURL, providerType).replace(/\/$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(providerConfig?.headers || {})
  }
  const requestApiKey = getRotatedApiKey(
    providerConfig?.apiKey,
    buildApiKeyScope({
      providerId: providerConfig?.id ? String(providerConfig.id) : undefined,
      providerType,
      baseURL: providerConfig?.baseURL
    })
  )
  if (requestApiKey) {
    headers.Authorization = `Bearer ${requestApiKey}`
  }

  return { baseURL, headers }
}

export function toDirectImagePrompt(
  prompt: string | { text?: string; images?: unknown[]; mask?: unknown }
): { prompt?: string; files?: DirectImageFile[]; mask?: { type: 'file'; mediaType: string; data: string | Uint8Array } } {
  if (typeof prompt === 'string') {
    return { prompt }
  }

  const files = Array.isArray(prompt.images)
    ? prompt.images.map((item) => toDirectImageFile(item))
    : undefined
  const mask = prompt.mask ? toDirectImageMask(prompt.mask) : undefined
  return {
    prompt: prompt.text,
    files: files && files.length > 0 ? files : undefined,
    mask
  }
}

export function toDirectImageFile(image: unknown): DirectImageFile {
  if (typeof image === 'string') {
    const value = image.trim()
    if (isHttpUrl(value)) {
      return { type: 'url', url: value }
    }
    const dataUrl = parseDataUrl(value)
    if (dataUrl) {
      return {
        type: 'file',
        mediaType: dataUrl.mediaType || 'image/png',
        data: dataUrl.base64
      }
    }
    const normalized = normalizeBase64Text(value)
    if (normalized) {
      return { type: 'file', mediaType: 'image/png', data: normalized }
    }
    throw new Error('Unsupported image input string format for direct image fallback')
  }

  if (Buffer.isBuffer(image)) {
    const bytes = new Uint8Array(image)
    return { type: 'file', mediaType: detectImageMimeTypeFromBytes(bytes), data: bytes }
  }
  if (image instanceof Uint8Array) {
    return { type: 'file', mediaType: detectImageMimeTypeFromBytes(image), data: image }
  }
  if (image instanceof ArrayBuffer) {
    const bytes = new Uint8Array(image)
    return { type: 'file', mediaType: detectImageMimeTypeFromBytes(bytes), data: bytes }
  }

  throw new Error('Unsupported image input payload for direct image fallback')
}

export function toDirectImageMask(mask: unknown): { type: 'file'; mediaType: string; data: string | Uint8Array } {
  const file = toDirectImageFile(mask)
  if (file.type === 'url') {
    throw new Error('Mask URL is not supported in direct image fallback')
  }
  return file
}

export async function normalizeRawGeneratedImages(images: unknown, abortSignal?: AbortSignal): Promise<string[]> {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('Image provider returned empty images payload')
  }

  const results: string[] = []
  for (const item of images) {
    if (item instanceof Uint8Array) {
      results.push(Buffer.from(item).toString('base64'))
      continue
    }

    if (typeof item === 'string') {
      const value = item.trim()
      const dataUrl = parseDataUrl(value)
      if (dataUrl) {
        results.push(dataUrl.base64)
        continue
      }

      const normalized = normalizeBase64Text(value)
      if (normalized) {
        results.push(normalized)
        continue
      }

      if (isHttpUrl(value)) {
        const response = await fetch(value, { signal: abortSignal })
        if (!response.ok) {
          throw new Error(`Failed to fetch image URL payload: ${response.status} ${response.statusText}`)
        }
        const bytes = new Uint8Array(await response.arrayBuffer())
        results.push(Buffer.from(bytes).toString('base64'))
        continue
      }
    }

    throw new Error('Unsupported image output payload for direct image fallback')
  }

  return results
}
