import type { AiProviderConfig } from '../../shared/types/ai'
import { getProviderAdapter } from './providerAdapterCatalog'

/**
 * 决定是否强制使用 OpenAI-compatible 工具循环分支（而非 SDK 原生多步工具流）。
 * 主要用于需要回放 reasoning_content 的推理模型（如 DeepSeek reasoner）。
 */
export function shouldUseCompatToolLoop(modelId?: string, provider?: AiProviderConfig): boolean {
  const model = (modelId || '').toLowerCase()
  const url = (provider?.baseURL || '').toLowerCase()
  const adapter = getProviderAdapter(provider)

  if (
    adapter.featureFlags.requiresReasoningReplayOnToolCalls &&
    (model.includes('deepseek-reasoner') || model.includes('deepseek-r1') || model.includes('/r1') || model.includes('-r1'))
  ) {
    return true
  }

  // 兼容旧配置：provider.type 未声明为 deepseek 时，仍基于模型/域名启发式兜底。
  if (model.includes('deepseek-reasoner') || model.includes('deepseek-r1')) {
    return true
  }

  return url.includes('deepseek.com') && (model.includes('reasoner') || model.includes('-r1') || model.includes('/r1'))
}

