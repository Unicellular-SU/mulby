import { resolveProviderBaseURL } from '../../../shared/ai/providerDefaults'

export function resolveCompatBaseURL(explicitBaseURL?: string, providerType?: string): string {
  const normalizedType = String(providerType || '').trim().toLowerCase()
  const resolved = resolveProviderBaseURL({
    providerType,
    baseURL: explicitBaseURL
  })
  if (resolved) {
    const normalizedResolved = resolved.replace(/\/+$/, '')
    if (normalizedType === 'ollama') {
      return /\/v1$/i.test(normalizedResolved) ? normalizedResolved : `${normalizedResolved}/v1`
    }
    return normalizedResolved
  }
  if (normalizedType === 'openai-compatible' || normalizedType === 'azure' || normalizedType === 'azure-openai') {
    throw new Error(`Provider 类型 ${normalizedType} 需要填写 Base URL`)
  }
  const fallback = 'https://api.openai.com/v1'
  return fallback.replace(/\/+$/, '')
}
