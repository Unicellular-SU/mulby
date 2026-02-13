import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  AiSettings,
  AiProviderConfig,
  AiProviderId,
  AiModel,
  AiMcpServer,
  AiMcpSettings,
  AiSkillDescriptor,
  AiSkillRecord,
  AiSkillSettings
} from '../../shared/types/ai'
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

const DEFAULT_SKILL_SETTINGS: AiSkillSettings = {
  enabled: true,
  activeSkillIds: [],
  autoSelect: {
    enabled: false,
    maxSkillsPerCall: 3,
    minScore: 1
  },
  records: []
}

const DEFAULT_SETTINGS: AiSettings = {
  providers: getSystemDefaultProviders(),
  models: getSystemDefaultModels(),
  mcp: DEFAULT_MCP_SETTINGS,
  skills: DEFAULT_SKILL_SETTINGS,
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

function normalizeSkillDescriptor(input: AiSkillDescriptor, fallbackId: string): AiSkillDescriptor {
  const id = String(input.id || fallbackId).trim() || fallbackId
  const name = String(input.name || id).trim() || id
  const description = String(input.description || '').trim() || `Skill ${name}`
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? Object.fromEntries(
      Object.entries(input.metadata as Record<string, unknown>)
        .map(([rawKey, rawValue]) => [String(rawKey || '').trim(), String(rawValue ?? '')] as const)
        .filter(([key]) => !!key)
    )
    : undefined
  const allowedTools = Array.isArray(input.allowedTools)
    ? input.allowedTools.map((item) => String(item || '').trim()).filter(Boolean)
    : undefined
  return {
    ...input,
    id,
    name,
    description,
    license: String(input.license || '').trim() || undefined,
    compatibility: String(input.compatibility || '').trim() || undefined,
    metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
    allowedTools: allowedTools && allowedTools.length > 0 ? allowedTools : undefined,
    triggerPhrases: Array.isArray(input.triggerPhrases)
      ? input.triggerPhrases.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
    capabilities: Array.isArray(input.capabilities)
      ? input.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
    internalTools: Array.isArray(input.internalTools)
      ? input.internalTools.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
    mode: input.mode === 'manual' || input.mode === 'auto' || input.mode === 'both' ? input.mode : undefined,
    promptTemplate: String(input.promptTemplate || '').trim() || undefined,
    mcpPolicy: input.mcpPolicy
      ? {
          serverIds: Array.isArray(input.mcpPolicy.serverIds)
            ? input.mcpPolicy.serverIds.map((item) => String(item || '').trim()).filter(Boolean)
            : undefined,
          allowedToolIds: Array.isArray(input.mcpPolicy.allowedToolIds)
            ? input.mcpPolicy.allowedToolIds.map((item) => String(item || '').trim()).filter(Boolean)
            : undefined,
          blockedToolIds: Array.isArray(input.mcpPolicy.blockedToolIds)
            ? input.mcpPolicy.blockedToolIds.map((item) => String(item || '').trim()).filter(Boolean)
            : undefined
        }
      : undefined
  }
}

function normalizeSkillRecord(record: AiSkillRecord, index: number): AiSkillRecord {
  const id = String(record.id || '').trim() || `skill-${index + 1}`
  const descriptor = normalizeSkillDescriptor(record.descriptor || { id, name: id, description: `Skill ${id}` }, id)
  return {
    ...record,
    id,
    source: record.source || 'manual',
    sourceRef: String(record.sourceRef || '').trim() || undefined,
    installPath: String(record.installPath || '').trim() || undefined,
    skillMdPath: String(record.skillMdPath || '').trim() || undefined,
    contentHash: String(record.contentHash || '').trim() || `${id}:${record.updatedAt || Date.now()}`,
    enabled: !!record.enabled,
    trustLevel: record.trustLevel === 'trusted' || record.trustLevel === 'reviewed' || record.trustLevel === 'untrusted'
      ? record.trustLevel
      : 'reviewed',
    installedAt: Number.isFinite(record.installedAt) ? Number(record.installedAt) : Date.now(),
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : Date.now(),
    descriptor: {
      ...descriptor,
      id,
      name: descriptor.name || id,
      description: descriptor.description || `Skill ${id}`
    }
  }
}

function normalizeSkillSettings(settings?: AiSkillSettings): AiSkillSettings {
  const source = settings || DEFAULT_SKILL_SETTINGS
  const used = new Set<string>()
  const records = (source.records || []).map((record, index) => normalizeSkillRecord(record, index)).map((record) => {
    const base = String(record.id || '').trim() || `skill-${used.size + 1}`
    let id = base
    let suffix = 2
    while (used.has(id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }
    used.add(id)
    if (id === record.id) return record
    return {
      ...record,
      id,
      descriptor: {
        ...record.descriptor,
        id
      }
    }
  })
  const activeSet = new Set(
    (source.activeSkillIds || [])
      .map((item) => String(item || '').trim())
      .filter((item) => records.some((record) => record.id === item))
  )
  return {
    enabled: source.enabled !== false,
    activeSkillIds: Array.from(activeSet),
    autoSelect: {
      ...DEFAULT_SKILL_SETTINGS.autoSelect,
      ...(source.autoSelect || {})
    },
    records
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
    const parsed = JSON.parse(raw) as AiSettings
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
      mcp: normalizeMcpSettings(parsed.mcp),
      skills: normalizeSkillSettings(parsed.skills)
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
    mcp: normalizeMcpSettings(partial.mcp ?? current.mcp),
    skills: normalizeSkillSettings(partial.skills ?? current.skills)
  }
  saveAiSettings(next)
  return next
}

export type ProviderId = AiProviderId
export type ProviderConfig = AiProviderConfig
