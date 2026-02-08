import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AiSettings, AiProviderConfig, AiProviderId, AiModel, AiMcpServer, AiMcpSettings } from '../../shared/types/ai'
import { inferProviderType } from './providerCatalog'
import { resolveProviderBaseURL } from '../../shared/ai/providerDefaults'
import { getSystemDefaultProviderById, getSystemDefaultProviders, mergeWithSystemDefaultProviders } from '../../shared/ai/systemProviders'
import { getSystemDefaultModels } from '../../shared/ai/systemModels'

const DEFAULT_MCP_SETTINGS: AiMcpSettings = {
  servers: [],
  defaults: {
    timeoutMs: 60000,
    longRunningMaxMs: 10 * 60 * 1000,
    approvalMode: 'always'
  }
}

const DEFAULT_SETTINGS: AiSettings = {
  providers: getSystemDefaultProviders(),
  models: getSystemDefaultModels(),
  mcp: DEFAULT_MCP_SETTINGS,
  defaultParams: {
    contextWindow: 8,
    temperatureEnabled: false,
    topPEnabled: false,
    maxOutputTokensEnabled: false,
    temperature: 0.7,
    topP: 1,
    maxOutputTokens: 1024
  }
}

const settingsCache: { value: AiSettings | null } = { value: null }

function normalizeProvider(provider: AiProviderConfig, index: number): AiProviderConfig {
  const id = String(provider.id || '').trim() || `provider-${index + 1}`
  const systemDefaultProvider = getSystemDefaultProviderById(id)
  const type = inferProviderType({ ...provider, id })
  const baseURL = String(
    provider.baseURL ||
      resolveProviderBaseURL({ providerType: type, provider, baseURL: provider.baseURL }) ||
      ''
  ).trim()
  const anthropicBaseURL = String(
    provider.anthropicBaseURL || systemDefaultProvider?.anthropicBaseURL || ''
  ).trim()
  return {
    ...provider,
    id,
    type,
    baseURL,
    anthropicBaseURL
  }
}

function normalizeProviders(providers: AiProviderConfig[]): AiProviderConfig[] {
  const withSystemDefaults = mergeWithSystemDefaultProviders(providers)
  const used = new Set<string>()
  return withSystemDefaults.map((provider, index) => {
    const base = String(provider.id || '').trim() || `provider-${index + 1}`
    let id = base
    let suffix = 2
    while (used.has(id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }
    used.add(id)
    if (id !== provider.id) {
      return {
        ...provider,
        id
      }
    }
    return provider
  })
}

function normalizeModel(model: AiModel, providers: AiProviderConfig[]): AiModel {
  if (model.providerRef && providers.some((provider) => String(provider.id) === String(model.providerRef))) {
    return model
  }

  if (model.providerLabel) {
    const byLabel = providers.find((provider) => (provider.label || provider.id) === model.providerLabel)
    if (byLabel) {
      return { ...model, providerRef: String(byLabel.id) }
    }
  }

  const providerPrefix = model.id.includes(':') ? model.id.split(':', 2)[0] : ''
  if (providerPrefix) {
    const byId = providers.find((provider) => String(provider.id) === providerPrefix)
    if (byId) {
      return { ...model, providerRef: String(byId.id) }
    }
    const byType = providers.find((provider) => inferProviderType(provider) === providerPrefix)
    if (byType) {
      return { ...model, providerRef: String(byType.id) }
    }
  }

  return model
}

function normalizeMcpServer(server: AiMcpServer, index: number): AiMcpServer {
  const type = server.type === 'sse' || server.type === 'streamableHttp' ? server.type : 'stdio'
  const baseId = String(server.id || '').trim() || `mcp-server-${index + 1}`
  const name = String(server.name || '').trim() || baseId
  const args = Array.isArray(server.args) ? server.args.map((item) => String(item)).filter(Boolean) : []
  const env = server.env && typeof server.env === 'object' ? server.env : undefined
  const headers = server.headers && typeof server.headers === 'object' ? server.headers : undefined
  const timeoutSec = Number(server.timeoutSec)
  return {
    ...server,
    id: baseId,
    name,
    type,
    baseUrl: String(server.baseUrl || '').trim() || undefined,
    command: String(server.command || '').trim() || undefined,
    args: args.length > 0 ? args : undefined,
    env,
    headers,
    timeoutSec: Number.isFinite(timeoutSec) && timeoutSec > 0 ? Math.floor(timeoutSec) : undefined,
    isActive: !!server.isActive
  }
}

function normalizeMcpSettings(settings?: AiMcpSettings): AiMcpSettings {
  const source = settings || DEFAULT_MCP_SETTINGS
  const used = new Set<string>()
  const servers = (source.servers || []).map((server, index) => normalizeMcpServer(server, index)).map((server) => {
    const base = String(server.id || '').trim()
    let id = base || `mcp-server-${used.size + 1}`
    let suffix = 2
    while (used.has(id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }
    used.add(id)
    if (id !== server.id) {
      return { ...server, id }
    }
    return server
  })
  const defaults = {
    ...DEFAULT_MCP_SETTINGS.defaults,
    ...(source.defaults || {})
  }
  return {
    servers,
    defaults
  }
}

function getSettingsPath(): string {
  const dir = join(app.getPath('userData'), 'ai')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'settings.json')
}

export function loadAiSettings(): AiSettings {
  if (settingsCache.value) return settingsCache.value
  const path = getSettingsPath()
  if (!existsSync(path)) {
    settingsCache.value = { ...DEFAULT_SETTINGS }
    return settingsCache.value
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as AiSettings & { defaultModel?: string }
    const normalizedProviders = normalizeProviders(
      (parsed.providers || []).map((provider, index) => normalizeProvider(provider, index))
    )
    // 仅在旧配置缺失 models 字段时注入系统默认模型；不覆盖用户显式删除的默认模型。
    const inputModels = Array.isArray(parsed.models) ? parsed.models : getSystemDefaultModels()
    const normalizedModels = inputModels.map((model) =>
      normalizeModel(model, normalizedProviders)
    )
    const next: AiSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      providers: normalizedProviders,
      models: normalizedModels,
      mcp: normalizeMcpSettings(parsed.mcp)
    }
    if (parsed.defaultModel && next.providers.length > 0) {
      const model = next.models?.find((item) => item.id === parsed.defaultModel)
      if (model?.providerLabel) {
        const provider = next.providers.find((item) => (item.label || item.id) === model.providerLabel)
        if (provider && !provider.defaultModel) {
          provider.defaultModel = parsed.defaultModel
        }
      } else {
        const providerId = parsed.defaultModel.split(':')[0]
        const provider = next.providers.find((item) =>
          String(item.id) === String(providerId) || inferProviderType(item) === String(providerId)
        )
        if (provider && !provider.defaultModel) {
          provider.defaultModel = parsed.defaultModel
        }
      }
    }
    settingsCache.value = next
    return settingsCache.value
  } catch (err) {
    console.error('[AI] Failed to load settings:', err)
    settingsCache.value = { ...DEFAULT_SETTINGS }
    return settingsCache.value
  }
}

export function saveAiSettings(next: AiSettings): void {
  const path = getSettingsPath()
  settingsCache.value = next
  try {
    writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8')
  } catch (err) {
    console.error('[AI] Failed to save settings:', err)
  }
}

export function getAiSettings(): AiSettings {
  return loadAiSettings()
}

export function updateAiSettings(partial: Partial<AiSettings>): AiSettings {
  const current = loadAiSettings()
  const providers = normalizeProviders(
    (partial.providers ?? current.providers).map((provider, index) => normalizeProvider(provider, index))
  )
  const models = (partial.models ?? current.models ?? []).map((model) =>
    normalizeModel(model, providers)
  )
  const next: AiSettings = {
    ...current,
    ...partial,
    providers,
    models,
    mcp: normalizeMcpSettings(partial.mcp ?? current.mcp)
  }
  saveAiSettings(next)
  return next
}

export type ProviderId = AiProviderId
export type ProviderConfig = AiProviderConfig
