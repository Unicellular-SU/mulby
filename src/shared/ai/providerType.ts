import type { AiProviderConfig } from '../types/ai'

export const BUILTIN_PROVIDER_TYPES = [
  'openai',
  'openai-response',
  'gemini',
  'anthropic',
  'azure-openai',
  'new-api',
  'cherryin',
  'ollama',
  'deepseek',
  'openrouter',
  'openai-compatible'
] as const

export type BuiltInProviderType = (typeof BUILTIN_PROVIDER_TYPES)[number]

function normalize(input?: string): string {
  return String(input || '').trim().toLowerCase()
}

function normalizeAlias(type: string): string {
  switch (type) {
    case 'custom':
      return 'openai-compatible'
    case 'google':
      return 'gemini'
    case 'azure':
      return 'azure-openai'
    case 'newapi':
      return 'new-api'
    case 'openai_response':
      return 'openai-response'
    default:
      return type
  }
}

export function inferProviderType(config?: Partial<AiProviderConfig>): string {
  const explicit = normalizeAlias(normalize(config?.type as string))
  if (explicit) return explicit

  const id = normalizeAlias(normalize(config?.id as string))
  if (BUILTIN_PROVIDER_TYPES.includes(id as BuiltInProviderType)) return id

  const baseURL = normalize(config?.baseURL)
  if (baseURL.includes('localhost:11434') || baseURL.includes('/ollama')) return 'ollama'
  if (baseURL.includes('open.cherryin.')) return 'cherryin'
  if (baseURL.includes('.openai.azure.com') || baseURL.includes('/openai')) return 'azure-openai'
  if (baseURL.includes('api.deepseek.com')) return 'deepseek'
  if (baseURL.includes('openrouter.ai')) return 'openrouter'
  if (baseURL.includes('anthropic.com')) return 'anthropic'
  if (baseURL.includes('generativelanguage.googleapis.com') || baseURL.includes('googleapis.com')) return 'gemini'

  return 'openai-compatible'
}
