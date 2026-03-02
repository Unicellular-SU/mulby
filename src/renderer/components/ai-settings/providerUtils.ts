import type { AiModel, AiProviderConfig } from '../../../shared/types/ai'
import { inferProviderType } from '../../../shared/ai/providerType'

export function getProviderKey(provider: AiProviderConfig): string {
  const label = (provider.label || '').trim()
  return label ? label : String(provider.id)
}

export function getProviderTypeLabel(provider: AiProviderConfig): string {
  return inferProviderType(provider)
}

export function modelBelongsToProvider(model: AiModel, provider: AiProviderConfig): boolean {
  if (model.providerRef) return String(model.providerRef) === String(provider.id)
  const providerKey = getProviderKey(provider)
  if (model.providerLabel) return model.providerLabel === providerKey
  const providerType = getProviderTypeLabel(provider)
  if (model.id.includes(':')) {
    const providerToken = model.id.split(':', 2)[0]
    return providerToken === String(provider.id) || providerToken === providerType
  }
  return model.id.startsWith(`${provider.id}:`)
}

export function modelKey(model: AiModel): string {
  return `${model.id}::${model.providerRef || model.providerLabel || ''}`
}

export function resolveProviderIdFromModel(model: AiModel, providers: AiProviderConfig[]): string {
  if (model.providerRef && providers.some((provider) => String(provider.id) === String(model.providerRef))) {
    return String(model.providerRef)
  }
  if (model.providerLabel) {
    const byLabel = providers.find((provider) => getProviderKey(provider) === model.providerLabel)
    if (byLabel) return String(byLabel.id)
  }
  if (model.id.includes(':')) {
    const providerToken = model.id.split(':', 2)[0]
    const byToken = providers.find((provider) => (
      String(provider.id) === providerToken || getProviderTypeLabel(provider) === providerToken
    ))
    if (byToken) return String(byToken.id)
  }
  return ''
}

export function buildProviderInstanceId(providers: AiProviderConfig[], preferred: string, type: string): string {
  const seed = (preferred || type || 'provider').trim().toLowerCase().replace(/\s+/g, '-')
  const base = seed || 'provider'
  const existing = new Set(providers.map((provider) => String(provider.id)))
  if (!existing.has(base)) return base
  let index = 2
  while (existing.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}
