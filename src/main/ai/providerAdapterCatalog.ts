import type { AiProviderConfig } from '../../shared/types/ai'
import { inferProviderType } from './providerCatalog'

export type FileServiceKind = 'openai' | 'anthropic' | 'google' | null

export interface ProviderAdapter {
  type: string
  openAICompatible: boolean
  supportsImageGeneration: boolean
  supportsModelFetch: boolean
  modelListEndpoint?: string
  fileServiceKind: FileServiceKind
  /**
   * 是否优先走 chat/completions 协议。
   */
  preferChatCompletions: (baseURL?: string) => boolean
}

const OPENAI_ADAPTER: ProviderAdapter = {
  type: 'openai',
  openAICompatible: true,
  supportsImageGeneration: true,
  supportsModelFetch: true,
  modelListEndpoint: '/models',
  fileServiceKind: 'openai',
  preferChatCompletions: (baseURL?: string) => {
    if (!baseURL) return false
    return !baseURL.includes('api.openai.com')
  }
}

const OPENAI_COMPAT_ADAPTER: ProviderAdapter = {
  type: 'openai-compatible',
  openAICompatible: true,
  supportsImageGeneration: true,
  supportsModelFetch: true,
  modelListEndpoint: '/models',
  fileServiceKind: 'openai',
  preferChatCompletions: () => true
}

const ANTHROPIC_ADAPTER: ProviderAdapter = {
  type: 'anthropic',
  openAICompatible: false,
  supportsImageGeneration: false,
  supportsModelFetch: false,
  fileServiceKind: 'anthropic',
  preferChatCompletions: () => false
}

const GOOGLE_ADAPTER: ProviderAdapter = {
  type: 'google',
  openAICompatible: false,
  supportsImageGeneration: true,
  supportsModelFetch: false,
  fileServiceKind: 'google',
  preferChatCompletions: () => false
}

const ADAPTERS: Record<string, ProviderAdapter> = {
  openai: OPENAI_ADAPTER,
  'openai-compatible': OPENAI_COMPAT_ADAPTER,
  deepseek: { ...OPENAI_COMPAT_ADAPTER, type: 'deepseek' },
  openrouter: { ...OPENAI_COMPAT_ADAPTER, type: 'openrouter' },
  azure: { ...OPENAI_COMPAT_ADAPTER, type: 'azure', supportsModelFetch: false, modelListEndpoint: undefined },
  anthropic: ANTHROPIC_ADAPTER,
  google: GOOGLE_ADAPTER
}

function resolveType(input?: AiProviderConfig | string): string {
  if (!input) return 'openai-compatible'
  if (typeof input === 'string') return String(input || '').trim().toLowerCase() || 'openai-compatible'
  return inferProviderType(input)
}

export function getProviderAdapter(input?: AiProviderConfig | string): ProviderAdapter {
  const type = resolveType(input)
  return ADAPTERS[type] || { ...OPENAI_COMPAT_ADAPTER, type }
}

export function isOpenAICompatibleProvider(input?: AiProviderConfig | string): boolean {
  return getProviderAdapter(input).openAICompatible
}

export function shouldUseChatCompletions(input: AiProviderConfig | string | undefined, baseURL?: string): boolean {
  return getProviderAdapter(input).preferChatCompletions(baseURL)
}
