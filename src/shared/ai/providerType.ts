import type { AiProviderConfig } from '../types/ai'

export const BUILTIN_PROVIDER_TYPES = [
  'openai',
  'openai-compatible',
  'anthropic',
  'google',
  'deepseek',
  'openrouter',
  'azure'
] as const

export type BuiltInProviderType = (typeof BUILTIN_PROVIDER_TYPES)[number]

function normalize(input?: string): string {
  return String(input || '').trim().toLowerCase()
}

export function inferProviderType(config?: Partial<AiProviderConfig>): string {
  const explicit = normalize(config?.type as string)
  if (explicit) return explicit === 'custom' ? 'openai-compatible' : explicit

  const id = normalize(config?.id as string)
  if (BUILTIN_PROVIDER_TYPES.includes(id as BuiltInProviderType)) return id
  if (id === 'custom') return 'openai-compatible'

  const baseURL = normalize(config?.baseURL)
  if (baseURL.includes('api.deepseek.com')) return 'deepseek'
  if (baseURL.includes('openrouter.ai')) return 'openrouter'
  if (baseURL.includes('anthropic.com')) return 'anthropic'
  if (baseURL.includes('generativelanguage.googleapis.com') || baseURL.includes('googleapis.com')) return 'google'

  return 'openai-compatible'
}

