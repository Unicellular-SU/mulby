import type { AiProviderConfig } from '../types/ai'
import { getProviderProfile } from './providerProfiles'
import { validateProviderConfig } from './providerValidation'

export type ProviderCapabilitySource = 'profile' | 'config' | 'model'
export type ProviderProtocolCapability = 'chat' | 'models-fetch' | 'image'

export interface ProviderProtocolCapabilityRule {
  capability: ProviderProtocolCapability
  label: string
  enabled: boolean
  source: ProviderCapabilitySource
  reason: string
}

const PROTOCOL_CAPABILITY_LABELS: Record<ProviderProtocolCapability, string> = {
  chat: '文本/流式',
  'models-fetch': '模型发现（models.fetch）',
  image: '图片生成/编辑'
}

const PROTOCOL_CAPABILITY_ORDER: ProviderProtocolCapability[] = ['chat', 'models-fetch', 'image']

function buildRule(
  capability: ProviderProtocolCapability,
  enabled: boolean,
  source: ProviderCapabilitySource,
  reason: string
): ProviderProtocolCapabilityRule {
  return {
    capability,
    label: PROTOCOL_CAPABILITY_LABELS[capability],
    enabled,
    source,
    reason
  }
}

export function getProviderProtocolCapabilityRule(
  provider: AiProviderConfig | null | undefined,
  capability: ProviderProtocolCapability,
  providerIdCounts?: Map<string, number>
): ProviderProtocolCapabilityRule {
  if (!provider) {
    return buildRule(capability, false, 'config', 'Provider 配置不存在')
  }

  const profile = getProviderProfile(provider)
  const validation = validateProviderConfig(provider, providerIdCounts)

  switch (capability) {
    case 'chat': {
      if (!validation.canTestConnection) {
        return buildRule('chat', false, 'config', validation.testConnectionHint || 'Provider 配置不完整')
      }
      return buildRule('chat', true, 'model', '基础协议可用（文本、流式、工具调用由模型与请求共同决定）')
    }
    case 'models-fetch': {
      if (!profile.supportsModelFetch) {
        return buildRule(
          'models-fetch',
          false,
          'profile',
          profile.modelFetchDisabledReason || `Provider 类型 ${validation.providerType} 暂不支持自动拉取模型`
        )
      }
      if (!validation.canFetchModels) {
        return buildRule('models-fetch', false, 'config', validation.fetchModelsHint || 'Provider 配置不完整')
      }
      return buildRule('models-fetch', true, 'model', '已启用（按 provider-specific endpoint fallback 执行）')
    }
    case 'image': {
      if (!profile.supportsImageGeneration) {
        return buildRule(
          'image',
          false,
          'profile',
          profile.imageGenerationDisabledReason || '当前 Provider profile 未启用图片能力'
        )
      }
      if (!validation.canTestConnection) {
        return buildRule('image', false, 'config', validation.testConnectionHint || 'Provider 配置不完整')
      }
      return buildRule('image', true, 'model', '已启用（由 adapter 的 image methods 执行）')
    }
    default: {
      return buildRule(capability, false, 'config', '未知能力')
    }
  }
}

export function getProviderProtocolCapabilityRules(
  provider: AiProviderConfig | null | undefined,
  providerIdCounts?: Map<string, number>
): ProviderProtocolCapabilityRule[] {
  return PROTOCOL_CAPABILITY_ORDER.map((capability) =>
    getProviderProtocolCapabilityRule(provider, capability, providerIdCounts)
  )
}

