import { createProviderRegistry } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import type { ProviderV3 } from '@ai-sdk/provider'
import { getAiSettings } from './config'
import type { AiProviderConfig } from '../../shared/types/ai'
import { buildProviderByType, inferProviderType } from './providerCatalog'

let registry: ReturnType<typeof createProviderRegistry> | null = null

export function buildProvider(config: AiProviderConfig) {
  const type = getProviderType(config)
  return buildProviderByType(type, config)
}

export function getProviderType(config: AiProviderConfig | undefined): string {
  if (!config) return ''
  return inferProviderType(config)
}

function toProviderKey(config: AiProviderConfig, index: number) {
  const base = String(config.id || '').trim() || `provider-${index}`
  return `${base}__${index}`
}

function buildDefaultProviders(): Record<string, ProviderV3> {
  return {
    openai,
    anthropic,
    google
  }
}

export function getProviderRegistry() {
  if (registry) return registry

  const settings = getAiSettings()
  const providerMap: Record<string, ProviderV3> = {}

  if (settings.providers.length === 0) {
    Object.assign(providerMap, buildDefaultProviders())
  } else {
    for (const [index, config] of settings.providers.entries()) {
      if (!config.enabled) continue
      const provider = buildProvider(config)
      if (!provider) continue

      const uniqueKey = toProviderKey(config, index)
      providerMap[uniqueKey] = provider

      const idKey = String(config.id || '').trim()
      if (idKey && !providerMap[idKey]) {
        providerMap[idKey] = provider
      }

      const typeKey = getProviderType(config)
      if (typeKey && !providerMap[typeKey]) {
        providerMap[typeKey] = provider
      }
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

export function hasProvider(id: string): boolean {
  const settings = getAiSettings()
  if (settings.providers.length === 0) return id === 'openai' || id === 'anthropic' || id === 'google'
  return settings.providers.some((provider) => {
    if (!provider.enabled) return false
    return String(provider.id) === String(id) || getProviderType(provider) === String(id)
  })
}
