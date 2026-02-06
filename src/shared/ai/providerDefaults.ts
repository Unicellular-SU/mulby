import type { AiProviderConfig } from '../types/ai'
import { inferProviderType } from './providerType'
import { getProviderPreset } from './providerPresets'

export function getProviderDefaultBaseURL(input?: string | Partial<AiProviderConfig>): string | undefined {
  const providerType = typeof input === 'string' ? String(input || '').trim().toLowerCase() : inferProviderType(input)
  return getProviderPreset(providerType).defaultBaseURL
}

export function resolveProviderBaseURL(input?: {
  providerType?: string
  provider?: Partial<AiProviderConfig>
  baseURL?: string
}): string | undefined {
  const explicit = String(input?.baseURL || input?.provider?.baseURL || '').trim()
  if (explicit) return explicit
  if (input?.providerType) {
    const fromType = getProviderDefaultBaseURL(input.providerType)
    if (fromType) return fromType
  }
  return getProviderDefaultBaseURL(input?.provider)
}
