import { openai, createOpenAI } from '@ai-sdk/openai'
import { anthropic, createAnthropic } from '@ai-sdk/anthropic'
import { google, createGoogleGenerativeAI } from '@ai-sdk/google'
import type { ProviderV3 } from '@ai-sdk/provider'
import type { AiProviderConfig } from '../../shared/types/ai'
import { inferProviderType } from '../../shared/ai/providerType'
import { resolveProviderBaseURL } from '../../shared/ai/providerDefaults'
export { inferProviderType }

function normalize(input?: string): string {
  return String(input || '').trim().toLowerCase()
}

export function buildProviderByType(type: string, config: AiProviderConfig): ProviderV3 | null {
  const normalized = normalize(type)
  const resolvedBaseURL = resolveProviderBaseURL({ providerType: normalized, provider: config, baseURL: config.baseURL })

  switch (normalized) {
    case 'openai':
    case 'openai-response':
      return config.apiKey || config.baseURL || config.headers
        ? createOpenAI({ apiKey: config.apiKey, baseURL: resolvedBaseURL, headers: config.headers })
        : openai
    case 'openai-compatible':
    case 'new-api':
    case 'cherryin':
    case 'ollama':
    case 'deepseek':
    case 'openrouter':
    case 'azure-openai':
    case 'azure':
      // 统一走 OpenAI-compatible 协议适配，差异由上层 capability/adapter 控制。
      return createOpenAI({ apiKey: config.apiKey, baseURL: resolvedBaseURL, headers: config.headers })
    case 'anthropic':
      return config.apiKey || config.baseURL || config.headers
        ? createAnthropic({ apiKey: config.apiKey, baseURL: resolvedBaseURL, headers: config.headers })
        : anthropic
    case 'gemini':
    case 'google':
      return config.apiKey || config.baseURL || config.headers
        ? createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: resolvedBaseURL, headers: config.headers })
        : google
    default:
      return null
  }
}
