import type { AiProviderConfig } from '../../shared/types/ai'
import { resolveModelId } from './models'

function modelName(modelId?: string): string {
  if (!modelId) return ''
  const resolved = resolveModelId(modelId)
  return resolved.modelId.toLowerCase()
}

export function supportsPdfInput(modelId?: string, provider?: AiProviderConfig): boolean {
  const providerId = String(provider?.id || '')
  const name = modelName(modelId)
  if (name.includes('qwen-long') || name.includes('qwen-doc')) return true
  return ['openai', 'anthropic', 'google'].includes(providerId)
}

export function supportsImageInput(modelId?: string, provider?: AiProviderConfig): boolean {
  const providerId = String(provider?.id || '')
  const name = modelName(modelId)
  if (name.includes('vision') || name.includes('gpt-4o') || name.includes('gpt-4.1') || name.includes('claude-3') || name.includes('gemini')) {
    return true
  }
  return ['openai', 'anthropic', 'google'].includes(providerId)
}

export function supportsLargeFileUpload(modelId?: string, provider?: AiProviderConfig): boolean {
  const providerId = String(provider?.id || '')
  const name = modelName(modelId)
  if (name.includes('qwen-long') || name.includes('qwen-doc')) return true
  return ['openai', 'google'].includes(providerId)
}

export function getFileSizeLimit(modelId: string | undefined, provider: AiProviderConfig | undefined, mimeType: string | undefined): number {
  const providerId = String(provider?.id || '')
  if (providerId === 'anthropic' && mimeType === 'application/pdf') {
    return 32 * 1024 * 1024
  }
  if (['google'].includes(providerId)) {
    return 20 * 1024 * 1024
  }
  return Infinity
}
