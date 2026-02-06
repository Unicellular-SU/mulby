import type { AiModelType } from '../types/ai'
import { inferProviderType } from './providerType'

export interface ProviderProfile {
  type: string
  requiresApiKey: boolean
  apiKeyRequiredReason?: string
  requiresBaseURL: boolean
  baseURLRequiredReason?: string
  supportsModelFetch: boolean
  modelFetchDisabledReason?: string
  supportsImageGeneration: boolean
  imageGenerationDisabledReason?: string
  /**
   * Provider 级硬约束：false 表示协议/平台层面不支持，不应被模型推断放开。
   */
  capabilityConstraints: Partial<Record<AiModelType, boolean>>
  capabilityConstraintReasons?: Partial<Record<AiModelType, string>>
}

export interface ProviderCapabilityRule {
  capability: AiModelType
  status: 'blocked' | 'model-dependent'
  source: 'profile' | 'model'
  reason: string
}

const DEFAULT_PROFILE: ProviderProfile = {
  type: 'openai-compatible',
  requiresApiKey: true,
  requiresBaseURL: true,
  baseURLRequiredReason: 'OpenAI-compatible provider 需要明确 API 网关地址',
  supportsModelFetch: true,
  supportsImageGeneration: true,
  capabilityConstraints: {}
}

const PROFILES: Record<string, ProviderProfile> = {
  openai: {
    type: 'openai',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: true,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  'openai-response': {
    type: 'openai-response',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: true,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  'openai-compatible': {
    type: 'openai-compatible',
    requiresApiKey: true,
    requiresBaseURL: true,
    supportsModelFetch: true,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  deepseek: {
    type: 'deepseek',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: true,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  openrouter: {
    type: 'openrouter',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: true,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  'azure-openai': {
    type: 'azure-openai',
    requiresApiKey: true,
    requiresBaseURL: true,
    supportsModelFetch: false,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  azure: {
    type: 'azure',
    requiresApiKey: true,
    requiresBaseURL: true,
    supportsModelFetch: false,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  anthropic: {
    type: 'anthropic',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: false,
    modelFetchDisabledReason: 'Anthropic 当前未统一暴露兼容的模型列表发现接口',
    supportsImageGeneration: false,
    imageGenerationDisabledReason: 'Anthropic 官方接口当前不支持本项目的图片生成协议',
    capabilityConstraints: {
      embedding: false,
      rerank: false
    },
    capabilityConstraintReasons: {
      embedding: 'Anthropic profile 中未启用 embedding 能力',
      rerank: 'Anthropic profile 中未启用 rerank 能力'
    }
  },
  gemini: {
    type: 'gemini',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: false,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  google: {
    type: 'google',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: false,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  'new-api': {
    type: 'new-api',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: true,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  cherryin: {
    type: 'cherryin',
    requiresApiKey: true,
    requiresBaseURL: false,
    supportsModelFetch: true,
    supportsImageGeneration: true,
    capabilityConstraints: {}
  },
  ollama: {
    type: 'ollama',
    requiresApiKey: false,
    requiresBaseURL: false,
    supportsModelFetch: true,
    supportsImageGeneration: false,
    imageGenerationDisabledReason: 'Ollama profile 默认未开启图片生成协议',
    capabilityConstraints: {}
  }
}

export function getProviderProfile(input?: { id?: string; type?: string; baseURL?: string } | string): ProviderProfile {
  const type = typeof input === 'string' ? String(input || '').trim().toLowerCase() : inferProviderType(input)
  return PROFILES[type] || { ...DEFAULT_PROFILE, type: type || DEFAULT_PROFILE.type }
}

export function getProviderCapabilityConstraint(
  input: { id?: string; type?: string; baseURL?: string } | string | undefined,
  capability: AiModelType
): boolean | undefined {
  return getProviderProfile(input).capabilityConstraints[capability]
}

export function getProviderCapabilityRuleRows(
  input: { id?: string; type?: string; baseURL?: string } | string | undefined
): ProviderCapabilityRule[] {
  const profile = getProviderProfile(input)
  const capabilityOrder: AiModelType[] = ['vision', 'reasoning', 'function_calling', 'web_search', 'embedding', 'rerank']
  return capabilityOrder.map((capability) => {
    const constrained = profile.capabilityConstraints[capability] === false
    if (constrained) {
      return {
        capability,
        status: 'blocked',
        source: 'profile',
        reason: profile.capabilityConstraintReasons?.[capability] || 'Provider profile 禁止该能力'
      }
    }
    return {
      capability,
      status: 'model-dependent',
      source: 'model',
      reason: '由模型能力推断与用户覆写共同决定'
    }
  })
}
