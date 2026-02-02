import { createProviderRegistry } from 'ai'
import { openai, createOpenAI } from '@ai-sdk/openai'
import { anthropic, createAnthropic } from '@ai-sdk/anthropic'
import { google, createGoogleGenerativeAI } from '@ai-sdk/google'
import { getAiSettings } from './config'
import type { AiProviderConfig, AiProviderId } from '../../shared/types/ai'

let registry: ReturnType<typeof createProviderRegistry> | null = null

function normalizeOpenAIBaseURL(baseURL?: string): string | undefined {
  if (!baseURL) return undefined
  const trimmed = baseURL.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) return trimmed
  return `${trimmed}/v1`
}

export function buildProvider(config: AiProviderConfig) {
  switch (config.id) {
    case 'openai':
      const normalizedBaseURL = normalizeOpenAIBaseURL(config.baseURL)
      return config.apiKey || config.baseURL || config.headers
        ? createOpenAI({ apiKey: config.apiKey, baseURL: normalizedBaseURL, headers: config.headers })
        : openai
    case 'anthropic':
      return config.apiKey || config.baseURL || config.headers
        ? createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL, headers: config.headers })
        : anthropic
    case 'google':
      return config.apiKey || config.baseURL || config.headers
        ? createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseURL, headers: config.headers })
        : google
    default:
      return null
  }
}

function buildDefaultProviders(): Record<string, unknown> {
  return {
    openai,
    anthropic,
    google
  }
}

export function getProviderRegistry() {
  if (registry) return registry

  const settings = getAiSettings()
  const providerMap: Record<string, unknown> = {}

  if (settings.providers.length === 0) {
    Object.assign(providerMap, buildDefaultProviders())
  } else {
    for (const config of settings.providers) {
      if (!config.enabled) continue
      const provider = buildProvider(config)
      if (provider) providerMap[config.id] = provider
    }
  }

  if (Object.keys(providerMap).length === 0) {
    Object.assign(providerMap, buildDefaultProviders())
  }

  registry = createProviderRegistry(providerMap)
  return registry
}

export function resetProviderRegistry(): void {
  registry = null
}

export function hasProvider(id: AiProviderId): boolean {
  const settings = getAiSettings()
  if (settings.providers.length === 0) return id === 'openai' || id === 'anthropic' || id === 'google'
  return settings.providers.some((provider) => provider.id === id && provider.enabled)
}
