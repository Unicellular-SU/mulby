import type { AiProviderConfig } from '../types/ai'
import { inferProviderType } from './providerType'
import { getProviderProfile } from './providerProfiles'
import { resolveProviderBaseURL } from './providerDefaults'

export interface ProviderValidationResult {
  providerType: string
  issues: string[]
  hasApiKey: boolean
  hasBaseURL: boolean
  canTestConnection: boolean
  canFetchModels: boolean
  testConnectionHint?: string
  fetchModelsHint?: string
}

export function buildProviderIdCounts(providers: AiProviderConfig[]): Map<string, number> {
  const counts = new Map<string, number>()
  providers.forEach((provider) => {
    const providerId = String(provider.id || '').trim()
    if (!providerId) return
    counts.set(providerId, (counts.get(providerId) || 0) + 1)
  })
  return counts
}

export function validateProviderConfig(
  provider: AiProviderConfig | null | undefined,
  providerIdCounts?: Map<string, number>
): ProviderValidationResult {
  if (!provider) {
    return {
      providerType: 'openai-compatible',
      issues: ['Provider 配置不存在'],
      hasApiKey: false,
      hasBaseURL: false,
      canTestConnection: false,
      canFetchModels: false,
      testConnectionHint: 'Provider 配置不存在',
      fetchModelsHint: 'Provider 配置不存在'
    }
  }

  const providerType = inferProviderType(provider)
  const providerId = String(provider.id || '').trim()
  const issueSet = new Set<string>()
  const hasApiKey = !!String(provider.apiKey || '').trim()
  const hasBaseURL = !!String(
    resolveProviderBaseURL({
      providerType,
      provider,
      baseURL: provider.baseURL
    }) || ''
  ).trim()
  const profile = getProviderProfile(providerType)

  if (!providerId) {
    issueSet.add('Provider 实例 ID 不能为空')
  }
  if (providerId && providerIdCounts && (providerIdCounts.get(providerId) || 0) > 1) {
    issueSet.add(`Provider 实例 ID "${providerId}" 重复，请修改为唯一值`)
  }
  if (profile.requiresApiKey && !hasApiKey) {
    issueSet.add(profile.apiKeyRequiredReason || '缺少 API Key')
  }
  if (profile.requiresBaseURL && !hasBaseURL) {
    issueSet.add(profile.baseURLRequiredReason || `Provider 类型 ${providerType} 需要填写 Base URL`)
  }

  const issues = Array.from(issueSet)
  const canTestConnection = issues.length === 0
  const supportsFetchModels = profile.supportsModelFetch
  const canFetchModels = canTestConnection && supportsFetchModels

  return {
    providerType,
    issues,
    hasApiKey,
    hasBaseURL,
    canTestConnection,
    canFetchModels,
    testConnectionHint: canTestConnection ? undefined : issues[0] || 'Provider 配置不完整',
    fetchModelsHint: canFetchModels
      ? undefined
      : (supportsFetchModels
          ? (issues[0] || 'Provider 配置不完整')
          : (profile.modelFetchDisabledReason || `Provider 类型 ${providerType} 暂不支持自动拉取模型`))
  }
}
