import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AiSettings, AiProviderConfig, AiProviderId } from '../../shared/types/ai'

const DEFAULT_SETTINGS: AiSettings = {
  providers: [],
  models: []
}

const settingsCache: { value: AiSettings | null } = { value: null }

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
    settingsCache.value = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      providers: parsed.providers || [],
      models: parsed.models || []
    }
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
  const next: AiSettings = {
    ...current,
    ...partial,
    providers: partial.providers ?? current.providers,
    models: partial.models ?? current.models
  }
  saveAiSettings(next)
  return next
}

export type ProviderId = AiProviderId
export type ProviderConfig = AiProviderConfig
