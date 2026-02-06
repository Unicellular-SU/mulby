import type { AiProviderConfig } from '../../shared/types/ai'
import { inferProviderType } from '../../shared/ai/providerType'
import { getProviderProfile } from '../../shared/ai/providerProfiles'

export type FileServiceKind = 'openai' | 'anthropic' | 'google' | null
export type ModelListParser = (payload: unknown) => string[]

export interface ProviderFeatureFlags {
  /**
   * 是否要求在工具调用循环中回放 reasoning_content（用于 DeepSeek reasoner 等兼容性）。
   */
  requiresReasoningReplayOnToolCalls: boolean
}

export interface ModelDiscoverySpec {
  endpoints: string[]
  parseModelIds: ModelListParser
}

export interface ProviderAdapter {
  type: string
  openAICompatible: boolean
  /**
   * 决定 runtime 解析 languageModel key 时优先使用的 OpenAI API 模式。
   */
  languageModelMode: 'auto' | 'chat' | 'responses'
  /**
   * 非工具流式时是否优先走兼容 chat/completions 解析器。
   */
  preferCompatTextStream: boolean
  supportsImageGeneration: boolean
  supportsModelFetch: boolean
  modelDiscovery?: ModelDiscoverySpec
  featureFlags: ProviderFeatureFlags
  fileServiceKind: FileServiceKind
  /**
   * 是否优先走 chat/completions 协议。
   */
  preferChatCompletions: (baseURL?: string) => boolean
}

interface ModelParserOptions {
  arrayPaths: string[][]
  itemKeys: string[]
}

function readByPath(input: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, input)
}

function normalizeModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function extractModelIdsFromArray(items: unknown[], itemKeys: string[]): string[] {
  const result: string[] = []
  for (const item of items) {
    const direct = normalizeModelId(item)
    if (direct) {
      result.push(direct)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    for (const key of itemKeys) {
      const value = normalizeModelId(record[key])
      if (value) {
        result.push(value)
        break
      }
    }
  }
  return result
}

function uniqueModelIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function createModelListParser(options: ModelParserOptions): ModelListParser {
  return (payload: unknown) => {
    const ids: string[] = []
    const rootArray = Array.isArray(payload) ? payload : undefined
    if (rootArray) {
      ids.push(...extractModelIdsFromArray(rootArray, options.itemKeys))
    }
    for (const path of options.arrayPaths) {
      const value = readByPath(payload, path)
      if (!Array.isArray(value)) continue
      ids.push(...extractModelIdsFromArray(value, options.itemKeys))
    }
    return uniqueModelIds(ids)
  }
}

const parseOpenAIModelIds = createModelListParser({
  arrayPaths: [['data'], ['models'], ['result', 'models']],
  itemKeys: ['id']
})

const parseOpenAICompatibleModelIds = createModelListParser({
  arrayPaths: [
    ['data'],
    ['models'],
    ['result', 'models'],
    ['result', 'data'],
    ['result', 'list'],
    ['list'],
    ['items']
  ],
  itemKeys: ['id', 'model', 'model_id', 'name']
})

const parseDeepSeekModelIds = createModelListParser({
  arrayPaths: [
    ['data'],
    ['models'],
    ['result', 'models'],
    ['result', 'data'],
    ['result', 'list'],
    ['list']
  ],
  itemKeys: ['id', 'model', 'name']
})

const parseOpenRouterModelIds = createModelListParser({
  arrayPaths: [
    ['data'],
    ['models'],
    ['result', 'models'],
    ['result', 'data'],
    ['result', 'list'],
    ['list']
  ],
  itemKeys: ['id', 'slug', 'name', 'model']
})

const OPENAI_ADAPTER: ProviderAdapter = {
  type: 'openai',
  openAICompatible: true,
  languageModelMode: 'auto',
  preferCompatTextStream: false,
  supportsImageGeneration: getProviderProfile('openai').supportsImageGeneration,
  supportsModelFetch: getProviderProfile('openai').supportsModelFetch,
  modelDiscovery: {
    endpoints: ['/models', '/v1/models'],
    parseModelIds: parseOpenAIModelIds
  },
  featureFlags: {
    requiresReasoningReplayOnToolCalls: false
  },
  fileServiceKind: 'openai',
  preferChatCompletions: (baseURL?: string) => {
    if (!baseURL) return false
    return !baseURL.includes('api.openai.com')
  }
}

const OPENAI_RESPONSE_ADAPTER: ProviderAdapter = {
  ...OPENAI_ADAPTER,
  type: 'openai-response',
  languageModelMode: 'responses',
  preferChatCompletions: () => false,
  supportsImageGeneration: getProviderProfile('openai-response').supportsImageGeneration,
  supportsModelFetch: getProviderProfile('openai-response').supportsModelFetch
}

const OPENAI_COMPAT_ADAPTER: ProviderAdapter = {
  type: 'openai-compatible',
  openAICompatible: true,
  languageModelMode: 'chat',
  preferCompatTextStream: true,
  supportsImageGeneration: getProviderProfile('openai-compatible').supportsImageGeneration,
  supportsModelFetch: getProviderProfile('openai-compatible').supportsModelFetch,
  modelDiscovery: {
    endpoints: ['/models', '/v1/models', '/api/models'],
    parseModelIds: parseOpenAICompatibleModelIds
  },
  featureFlags: {
    requiresReasoningReplayOnToolCalls: false
  },
  fileServiceKind: 'openai',
  preferChatCompletions: () => true
}

const ANTHROPIC_ADAPTER: ProviderAdapter = {
  type: 'anthropic',
  openAICompatible: false,
  languageModelMode: 'auto',
  preferCompatTextStream: false,
  supportsImageGeneration: getProviderProfile('anthropic').supportsImageGeneration,
  supportsModelFetch: getProviderProfile('anthropic').supportsModelFetch,
  featureFlags: {
    requiresReasoningReplayOnToolCalls: false
  },
  fileServiceKind: 'anthropic',
  preferChatCompletions: () => false
}

const GOOGLE_ADAPTER: ProviderAdapter = {
  type: 'gemini',
  openAICompatible: false,
  languageModelMode: 'auto',
  preferCompatTextStream: false,
  supportsImageGeneration: getProviderProfile('gemini').supportsImageGeneration,
  supportsModelFetch: getProviderProfile('gemini').supportsModelFetch,
  featureFlags: {
    requiresReasoningReplayOnToolCalls: false
  },
  fileServiceKind: 'google',
  preferChatCompletions: () => false
}

const ADAPTERS: Record<string, ProviderAdapter> = {
  openai: OPENAI_ADAPTER,
  'openai-response': OPENAI_RESPONSE_ADAPTER,
  'openai-compatible': OPENAI_COMPAT_ADAPTER,
  deepseek: {
    ...OPENAI_COMPAT_ADAPTER,
    type: 'deepseek',
    featureFlags: {
      requiresReasoningReplayOnToolCalls: true
    },
    modelDiscovery: {
      endpoints: ['/models', '/v1/models'],
      parseModelIds: parseDeepSeekModelIds
    }
  },
  openrouter: {
    ...OPENAI_COMPAT_ADAPTER,
    type: 'openrouter',
    modelDiscovery: {
      endpoints: ['/models', '/api/v1/models', '/v1/models'],
      parseModelIds: parseOpenRouterModelIds
    }
  },
  'azure-openai': {
    ...OPENAI_COMPAT_ADAPTER,
    type: 'azure-openai',
    supportsModelFetch: getProviderProfile('azure-openai').supportsModelFetch,
    modelDiscovery: undefined
  },
  azure: {
    ...OPENAI_COMPAT_ADAPTER,
    type: 'azure-openai',
    supportsModelFetch: getProviderProfile('azure-openai').supportsModelFetch,
    modelDiscovery: undefined
  },
  'new-api': {
    ...OPENAI_COMPAT_ADAPTER,
    type: 'new-api',
    supportsImageGeneration: getProviderProfile('new-api').supportsImageGeneration,
    supportsModelFetch: getProviderProfile('new-api').supportsModelFetch
  },
  cherryin: {
    ...OPENAI_COMPAT_ADAPTER,
    type: 'cherryin',
    supportsImageGeneration: getProviderProfile('cherryin').supportsImageGeneration,
    supportsModelFetch: getProviderProfile('cherryin').supportsModelFetch
  },
  ollama: {
    ...OPENAI_COMPAT_ADAPTER,
    type: 'ollama',
    supportsImageGeneration: getProviderProfile('ollama').supportsImageGeneration,
    supportsModelFetch: getProviderProfile('ollama').supportsModelFetch,
    modelDiscovery: {
      endpoints: ['/api/tags', '/v1/models', '/models'],
      parseModelIds: createModelListParser({
        arrayPaths: [['models'], ['data'], ['items']],
        itemKeys: ['id', 'name', 'model']
      })
    }
  },
  anthropic: ANTHROPIC_ADAPTER,
  gemini: GOOGLE_ADAPTER,
  google: { ...GOOGLE_ADAPTER, type: 'gemini' }
}

function resolveType(input?: AiProviderConfig | string): string {
  if (!input) return 'openai-compatible'
  if (typeof input === 'string') {
    const normalized = String(input || '').trim().toLowerCase()
    if (!normalized) return 'openai-compatible'
    return inferProviderType({ id: normalized, type: normalized, enabled: true })
  }
  return inferProviderType(input)
}

export function getProviderAdapter(input?: AiProviderConfig | string): ProviderAdapter {
  const type = resolveType(input)
  return ADAPTERS[type] || { ...OPENAI_COMPAT_ADAPTER, type }
}

export function isOpenAICompatibleProvider(input?: AiProviderConfig | string): boolean {
  return getProviderAdapter(input).openAICompatible
}

export function shouldUseChatCompletions(input: AiProviderConfig | string | undefined, baseURL?: string): boolean {
  return getProviderAdapter(input).preferChatCompletions(baseURL)
}
