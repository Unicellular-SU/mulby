import type { AiProviderConfig } from '../types/ai'
import { BUILTIN_PROVIDER_TYPES, inferProviderType } from './providerType'

export interface ProviderPreset {
  type: string
  defaultId: string
  defaultLabel: string
  defaultBaseURL?: string
}

const PRESET_MAP: Record<string, ProviderPreset> = {
  openai: {
    type: 'openai',
    defaultId: 'openai',
    defaultLabel: 'OpenAI',
    defaultBaseURL: 'https://api.openai.com/v1'
  },
  'openai-response': {
    type: 'openai-response',
    defaultId: 'openai-response',
    defaultLabel: 'OpenAI Response',
    defaultBaseURL: 'https://api.openai.com/v1'
  },
  anthropic: {
    type: 'anthropic',
    defaultId: 'anthropic',
    defaultLabel: 'Anthropic',
    defaultBaseURL: 'https://api.anthropic.com/v1'
  },
  gemini: {
    type: 'gemini',
    defaultId: 'gemini',
    defaultLabel: 'Gemini',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta'
  },
  google: {
    type: 'gemini',
    defaultId: 'gemini',
    defaultLabel: 'Gemini',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta'
  },
  deepseek: {
    type: 'deepseek',
    defaultId: 'deepseek',
    defaultLabel: 'DeepSeek',
    defaultBaseURL: 'https://api.deepseek.com'
  },
  openrouter: {
    type: 'openrouter',
    defaultId: 'openrouter',
    defaultLabel: 'OpenRouter',
    defaultBaseURL: 'https://openrouter.ai/api/v1'
  },
  'openai-compatible': {
    type: 'openai-compatible',
    defaultId: 'openai-compatible',
    defaultLabel: 'OpenAI Compatible'
  },
  'azure-openai': {
    type: 'azure-openai',
    defaultId: 'azure-openai',
    defaultLabel: 'Azure OpenAI'
  },
  azure: {
    type: 'azure-openai',
    defaultId: 'azure-openai',
    defaultLabel: 'Azure OpenAI'
  },
  'new-api': {
    type: 'new-api',
    defaultId: 'new-api',
    defaultLabel: 'New API',
    defaultBaseURL: 'http://localhost:3000/v1'
  },
  cherryin: {
    type: 'cherryin',
    defaultId: 'cherryin',
    defaultLabel: 'CherryIN',
    defaultBaseURL: 'https://open.cherryin.net/v1'
  },
  ollama: {
    type: 'ollama',
    defaultId: 'ollama',
    defaultLabel: 'Ollama',
    defaultBaseURL: 'http://localhost:11434'
  }
}

function resolveType(input?: string | Partial<AiProviderConfig>): string {
  if (!input) return 'openai-compatible'
  if (typeof input === 'string') {
    const normalized = String(input || '').trim().toLowerCase()
    return normalized || 'openai-compatible'
  }
  return inferProviderType(input)
}

export function getProviderPreset(input?: string | Partial<AiProviderConfig>): ProviderPreset {
  const type = resolveType(input)
  return PRESET_MAP[type] || {
    type,
    defaultId: type || 'provider',
    defaultLabel: type || 'Provider'
  }
}

export function getBuiltinProviderPresets(): ProviderPreset[] {
  return BUILTIN_PROVIDER_TYPES.map((type) => getProviderPreset(type))
}
