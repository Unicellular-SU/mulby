import type { AiProviderConfig } from '../types/ai'

export const SYSTEM_DEFAULT_PROVIDER_IDS = [
  'openai',
  'deepseek',
  'gemini',
  'anthropic',
  'silicon',
  'zhipu',
  'dmxapi',
  'moonshot',
  'baichuan',
  'dashscope',
  'doubao',
  'minimax',
  'grok',
  'hunyuan',
  'huggingface',
  'mimo'
] as const

const SYSTEM_DEFAULT_PROVIDERS: AiProviderConfig[] = [
  { id: 'openai', type: 'openai-response', label: 'OpenAI', enabled: false, apiKey: '', baseURL: 'https://api.openai.com/v1' },
  { id: 'deepseek', type: 'deepseek', label: 'DeepSeek', enabled: false, apiKey: '', baseURL: 'https://api.deepseek.com' },
  { id: 'gemini', type: 'gemini', label: 'Gemini', enabled: false, apiKey: '', baseURL: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'anthropic', type: 'anthropic', label: 'Anthropic', enabled: false, apiKey: '', baseURL: 'https://api.anthropic.com/v1' },
  { id: 'silicon', type: 'openai-compatible', label: '硅基流动', enabled: false, apiKey: '', baseURL: 'https://api.siliconflow.cn/v1' },
  { id: 'zhipu', type: 'openai-compatible', label: '智谱', enabled: false, apiKey: '', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'dmxapi', type: 'openai-compatible', label: 'DMXAPI', enabled: false, apiKey: '', baseURL: 'https://www.dmxapi.cn/v1' },
  { id: 'moonshot', type: 'openai-compatible', label: '月之暗面', enabled: false, apiKey: '', baseURL: 'https://api.moonshot.cn/v1' },
  { id: 'baichuan', type: 'openai-compatible', label: '百川', enabled: false, apiKey: '', baseURL: 'https://api.baichuan-ai.com/v1' },
  { id: 'dashscope', type: 'openai-compatible', label: '阿里云百炼', enabled: false, apiKey: '', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'doubao', type: 'openai-compatible', label: '火山引擎', enabled: false, apiKey: '', baseURL: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'minimax', type: 'openai-compatible', label: 'MiniMax', enabled: false, apiKey: '', baseURL: 'https://api.minimaxi.com/v1' },
  { id: 'grok', type: 'openai-compatible', label: 'Grok', enabled: false, apiKey: '', baseURL: 'https://api.x.ai/v1' },
  { id: 'hunyuan', type: 'openai-compatible', label: '腾讯混元', enabled: false, apiKey: '', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { id: 'huggingface', type: 'openai-response', label: 'Hugging Face', enabled: false, apiKey: '', baseURL: 'https://router.huggingface.co/v1' },
  { id: 'mimo', type: 'openai-compatible', label: 'Xiaomi MiMo', enabled: false, apiKey: '', baseURL: 'https://api.xiaomimimo.com/v1' }
]

function cloneProvider(provider: AiProviderConfig): AiProviderConfig {
  return {
    ...provider,
    headers: provider.headers ? { ...provider.headers } : undefined,
    defaultParams: provider.defaultParams ? { ...provider.defaultParams } : undefined
  }
}

export function getSystemDefaultProviders(): AiProviderConfig[] {
  return SYSTEM_DEFAULT_PROVIDERS.map(cloneProvider)
}

export function mergeWithSystemDefaultProviders(providers: AiProviderConfig[]): AiProviderConfig[] {
  const existingById = new Set(providers.map((provider) => String(provider.id || '').trim()).filter(Boolean))
  const merged = [...providers]
  for (const provider of SYSTEM_DEFAULT_PROVIDERS) {
    if (existingById.has(String(provider.id))) continue
    merged.push(cloneProvider(provider))
  }
  return merged
}

export function isSystemDefaultProviderId(providerId?: string): boolean {
  const id = String(providerId || '').trim()
  return SYSTEM_DEFAULT_PROVIDER_IDS.some((item) => item === id)
}
