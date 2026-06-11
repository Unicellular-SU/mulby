import type { AiProviderConfig } from '../types/ai'

// Static snapshot originally generated from Cherry Studio defaults (sync script retired).
// Maintain entries in-repo; per-model specs are refreshed via sync:models-dev / check:models-dev.

export const SYSTEM_DEFAULT_PROVIDER_IDS = [
  'cherryin',
  'silicon',
  'aihubmix',
  'ovms',
  'ocoolai',
  'zhipu',
  'zai',
  'deepseek',
  'alayanew',
  'dmxapi',
  'aionly',
  'burncloud',
  'tokenflux',
  '302ai',
  'cephalon',
  'lanyun',
  'ph8',
  'sophnet',
  'ppio',
  'dashscope',
  'minimax',
  'minimax-global',
  'moonshot',
  'qiniu',
  'openrouter',
  'new-api',
  'ollama',
  'lmstudio',
  'anthropic',
  'openai',
  'azure-openai',
  'gemini',
  'github',
  'copilot',
  'doubao',
  'baichuan',
  'stepfun',
  'yi',
  'infini',
  'groq',
  'together',
  'fireworks',
  'nvidia',
  'grok',
  'hyperbolic',
  'mistral',
  'jina',
  'perplexity',
  'modelscope',
  'xirang',
  'hunyuan',
  'tencent-cloud-ti',
  'baidu-cloud',
  'gpustack',
  'voyageai',
  'poe',
  'longcat',
  'huggingface',
  'cerebras',
  'mimo'
] as const

const SYSTEM_DEFAULT_PROVIDERS: AiProviderConfig[] = [
  {
    id: 'cherryin',
    type: 'cherryin',
    label: 'CherryIN',
    enabled: false,
    apiKey: '',
    baseURL: 'https://open.cherryin.net/v1',
    anthropicBaseURL: 'https://open.cherryin.cc'
  },
  {
    id: 'silicon',
    type: 'openai-compatible',
    label: 'Silicon',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.siliconflow.cn',
    anthropicBaseURL: 'https://api.siliconflow.cn'
  },
  {
    id: 'aihubmix',
    type: 'openai-compatible',
    label: 'AiHubMix',
    enabled: false,
    apiKey: '',
    baseURL: 'https://aihubmix.com',
    anthropicBaseURL: 'https://aihubmix.com'
  },
  {
    id: 'ovms',
    type: 'openai-compatible',
    label: 'OpenVINO Model Server',
    enabled: false,
    apiKey: '',
    baseURL: 'http://localhost:8000/v3'
  },
  {
    id: 'ocoolai',
    type: 'openai-compatible',
    label: 'ocoolAI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.ocoolai.com'
  },
  {
    id: 'zhipu',
    type: 'openai-compatible',
    label: 'ZhiPu',
    enabled: false,
    apiKey: '',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    anthropicBaseURL: 'https://open.bigmodel.cn/api/anthropic'
  },
  {
    id: 'zai',
    type: 'openai-compatible',
    label: 'Z.ai',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.z.ai/api/paas/v4',
    anthropicBaseURL: 'https://api.z.ai/api/anthropic'
  },
  {
    id: 'deepseek',
    type: 'deepseek',
    label: 'deepseek',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.deepseek.com',
    anthropicBaseURL: 'https://api.deepseek.com/anthropic'
  },
  {
    id: 'alayanew',
    type: 'openai-compatible',
    label: 'AlayaNew',
    enabled: false,
    apiKey: '',
    baseURL: 'https://deepseek.alayanew.com'
  },
  {
    id: 'dmxapi',
    type: 'openai-compatible',
    label: 'DMXAPI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://www.dmxapi.cn',
    anthropicBaseURL: 'https://www.dmxapi.cn'
  },
  {
    id: 'aionly',
    type: 'openai-compatible',
    label: 'AIOnly',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.aiionly.com'
  },
  {
    id: 'burncloud',
    type: 'openai-compatible',
    label: 'BurnCloud',
    enabled: false,
    apiKey: '',
    baseURL: 'https://ai.burncloud.com'
  },
  {
    id: 'tokenflux',
    type: 'openai-compatible',
    label: 'TokenFlux',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.tokenflux.ai/openai/v1',
    anthropicBaseURL: 'https://api.tokenflux.ai/anthropic'
  },
  {
    id: '302ai',
    type: 'openai-compatible',
    label: '302.AI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.302.ai',
    anthropicBaseURL: 'https://api.302.ai'
  },
  {
    id: 'cephalon',
    type: 'openai-compatible',
    label: 'Cephalon',
    enabled: false,
    apiKey: '',
    baseURL: 'https://cephalon.cloud/user-center/v1/model'
  },
  {
    id: 'lanyun',
    type: 'openai-compatible',
    label: 'LANYUN',
    enabled: false,
    apiKey: '',
    baseURL: 'https://maas-api.lanyun.net'
  },
  {
    id: 'ph8',
    type: 'openai-compatible',
    label: 'PH8',
    enabled: false,
    apiKey: '',
    baseURL: 'https://ph8.co'
  },
  {
    id: 'sophnet',
    type: 'openai-compatible',
    label: 'SophNet',
    enabled: false,
    apiKey: '',
    baseURL: 'https://www.sophnet.com/api/open-apis/v1'
  },
  {
    id: 'ppio',
    type: 'openai-compatible',
    label: 'PPIO',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.ppinfra.com/v3/openai'
  },
  {
    id: 'dashscope',
    type: 'openai-compatible',
    label: 'Bailian',
    enabled: false,
    apiKey: '',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    anthropicBaseURL: 'https://dashscope.aliyuncs.com/apps/anthropic'
  },
  {
    id: 'minimax',
    type: 'openai-compatible',
    label: 'MiniMax',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.minimaxi.com/v1',
    anthropicBaseURL: 'https://api.minimaxi.com/anthropic'
  },
  {
    id: 'minimax-global',
    type: 'openai-compatible',
    label: 'MiniMax Global',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.minimax.io/v1',
    anthropicBaseURL: 'https://api.minimax.io/anthropic'
  },
  {
    id: 'moonshot',
    type: 'openai-compatible',
    label: 'Moonshot AI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.moonshot.cn',
    anthropicBaseURL: 'https://api.moonshot.cn/anthropic'
  },
  {
    id: 'qiniu',
    type: 'openai-compatible',
    label: 'Qiniu',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.qnaigc.com',
    anthropicBaseURL: 'https://api.qnaigc.com'
  },
  {
    id: 'openrouter',
    type: 'openrouter',
    label: 'OpenRouter',
    enabled: false,
    apiKey: '',
    baseURL: 'https://openrouter.ai/api/v1',
    anthropicBaseURL: 'https://openrouter.ai/api'
  },
  {
    id: 'new-api',
    type: 'new-api',
    label: 'New API',
    enabled: false,
    apiKey: '',
    baseURL: 'http://localhost:3000',
    anthropicBaseURL: 'http://localhost:3000'
  },
  {
    id: 'ollama',
    type: 'ollama',
    label: 'Ollama',
    enabled: false,
    apiKey: '',
    baseURL: 'http://localhost:11434',
    anthropicBaseURL: 'http://localhost:11434'
  },
  {
    id: 'lmstudio',
    type: 'openai-compatible',
    label: 'LM Studio',
    enabled: false,
    apiKey: '',
    baseURL: 'http://localhost:1234',
    anthropicBaseURL: 'http://localhost:1234'
  },
  {
    id: 'anthropic',
    type: 'anthropic',
    label: 'Anthropic',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.anthropic.com'
  },
  {
    id: 'openai',
    type: 'openai-response',
    label: 'OpenAI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.openai.com/v1'
  },
  {
    id: 'azure-openai',
    type: 'azure-openai',
    label: 'Azure OpenAI',
    enabled: false,
    apiKey: '',
    apiVersion: ''
  },
  {
    id: 'gemini',
    type: 'gemini',
    label: 'Gemini',
    enabled: false,
    apiKey: '',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta'
  },
  {
    id: 'github',
    type: 'openai-compatible',
    label: 'Github Models',
    enabled: false,
    apiKey: '',
    baseURL: 'https://models.github.ai/inference'
  },
  {
    id: 'copilot',
    type: 'openai-compatible',
    label: 'Github Copilot',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.githubcopilot.com'
  },
  {
    id: 'doubao',
    type: 'openai-compatible',
    label: 'doubao',
    enabled: false,
    apiKey: '',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3'
  },
  {
    id: 'baichuan',
    type: 'openai-compatible',
    label: 'BAICHUAN AI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.baichuan-ai.com'
  },
  {
    id: 'stepfun',
    type: 'openai-compatible',
    label: 'StepFun',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.stepfun.com',
    anthropicBaseURL: 'https://api.stepfun.com'
  },
  {
    id: 'yi',
    type: 'openai-compatible',
    label: 'Yi',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.lingyiwanwu.com'
  },
  {
    id: 'infini',
    type: 'openai-compatible',
    label: 'Infini',
    enabled: false,
    apiKey: '',
    baseURL: 'https://cloud.infini-ai.com/maas'
  },
  {
    id: 'groq',
    type: 'openai-compatible',
    label: 'Groq',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.groq.com/openai'
  },
  {
    id: 'together',
    type: 'openai-compatible',
    label: 'Together',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.together.xyz'
  },
  {
    id: 'fireworks',
    type: 'openai-compatible',
    label: 'Fireworks',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.fireworks.ai/inference'
  },
  {
    id: 'nvidia',
    type: 'openai-compatible',
    label: 'nvidia',
    enabled: false,
    apiKey: '',
    baseURL: 'https://integrate.api.nvidia.com'
  },
  {
    id: 'grok',
    type: 'openai-compatible',
    label: 'Grok',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.x.ai'
  },
  {
    id: 'hyperbolic',
    type: 'openai-compatible',
    label: 'Hyperbolic',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.hyperbolic.xyz'
  },
  {
    id: 'mistral',
    type: 'openai-compatible',
    label: 'Mistral',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.mistral.ai'
  },
  {
    id: 'jina',
    type: 'openai-compatible',
    label: 'Jina',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.jina.ai'
  },
  {
    id: 'perplexity',
    type: 'openai-compatible',
    label: 'Perplexity',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.perplexity.ai'
  },
  {
    id: 'modelscope',
    type: 'openai-compatible',
    label: 'ModelScope',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api-inference.modelscope.cn/v1',
    anthropicBaseURL: 'https://api-inference.modelscope.cn'
  },
  {
    id: 'xirang',
    type: 'openai-compatible',
    label: 'Xirang',
    enabled: false,
    apiKey: '',
    baseURL: 'https://wishub-x1.ctyun.cn'
  },
  {
    id: 'hunyuan',
    type: 'openai-compatible',
    label: 'hunyuan',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.hunyuan.cloud.tencent.com'
  },
  {
    id: 'tencent-cloud-ti',
    type: 'openai-compatible',
    label: 'Tencent Cloud TI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.lkeap.cloud.tencent.com'
  },
  {
    id: 'baidu-cloud',
    type: 'openai-compatible',
    label: 'Baidu Cloud',
    enabled: false,
    apiKey: '',
    baseURL: 'https://qianfan.baidubce.com/v2'
  },
  {
    id: 'gpustack',
    type: 'openai-compatible',
    label: 'GPUStack',
    enabled: false,
    apiKey: ''
  },
  {
    id: 'voyageai',
    type: 'openai-compatible',
    label: 'VoyageAI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.voyageai.com'
  },
  {
    id: 'poe',
    type: 'openai-compatible',
    label: 'Poe',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.poe.com/v1'
  },
  {
    id: 'longcat',
    type: 'openai-compatible',
    label: 'LongCat',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.longcat.chat/openai',
    anthropicBaseURL: 'https://api.longcat.chat/anthropic'
  },
  {
    id: 'huggingface',
    type: 'openai-response',
    label: 'Hugging Face',
    enabled: false,
    apiKey: '',
    baseURL: 'https://router.huggingface.co/v1'
  },
  {
    id: 'cerebras',
    type: 'openai-compatible',
    label: 'Cerebras AI',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.cerebras.ai/v1'
  },
  {
    id: 'mimo',
    type: 'openai-compatible',
    label: 'Xiaomi MiMo',
    enabled: false,
    apiKey: '',
    baseURL: 'https://api.xiaomimimo.com',
    anthropicBaseURL: 'https://api.xiaomimimo.com/anthropic'
  }
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

export function getSystemDefaultProviderById(providerId?: string): AiProviderConfig | undefined {
  const id = String(providerId || '').trim()
  if (!id) return undefined
  const provider = SYSTEM_DEFAULT_PROVIDERS.find((item) => String(item.id) === id)
  return provider ? cloneProvider(provider) : undefined
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
