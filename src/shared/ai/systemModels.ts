import type { AiModel } from '../types/ai'

function createSystemModel(providerId: string, modelId: string, description = '系统默认模型'): AiModel {
  return {
    id: `${providerId}:${modelId}`,
    label: modelId,
    description,
    providerRef: providerId,
    providerLabel: providerId
  }
}

const SYSTEM_DEFAULT_MODELS: AiModel[] = [
  createSystemModel('openai', 'gpt-5'),
  createSystemModel('openai', 'gpt-5-mini'),
  createSystemModel('openai', 'gpt-image-1'),

  createSystemModel('deepseek', 'deepseek-chat'),
  createSystemModel('deepseek', 'deepseek-reasoner'),

  createSystemModel('gemini', 'gemini-2.5-flash'),
  createSystemModel('gemini', 'gemini-2.5-pro'),
  createSystemModel('gemini', 'gemini-3-pro-image-preview'),

  createSystemModel('anthropic', 'claude-sonnet-4-5'),
  createSystemModel('anthropic', 'claude-haiku-4-5'),

  createSystemModel('silicon', 'deepseek-ai/DeepSeek-V3.2'),
  createSystemModel('silicon', 'Qwen/Qwen3-8B'),

  createSystemModel('zhipu', 'glm-4.5'),
  createSystemModel('zhipu', 'glm-4.6'),
  createSystemModel('zhipu', 'glm-4.6v'),

  createSystemModel('dmxapi', 'gpt-4o'),
  createSystemModel('dmxapi', 'DMXAPI-DeepSeek-R1'),
  createSystemModel('dmxapi', 'gemini-2.0-flash'),

  createSystemModel('moonshot', 'moonshot-v1-auto'),
  createSystemModel('moonshot', 'kimi-k2-0711-preview'),

  createSystemModel('baichuan', 'Baichuan4'),
  createSystemModel('baichuan', 'Baichuan-M3'),

  createSystemModel('dashscope', 'qwen-plus'),
  createSystemModel('dashscope', 'qwen-max'),
  createSystemModel('dashscope', 'qwen-vl-plus'),

  createSystemModel('doubao', 'doubao-1-5-pro-32k-250115'),
  createSystemModel('doubao', 'doubao-1-5-vision-pro-32k-250115'),
  createSystemModel('doubao', 'deepseek-r1-250120'),

  createSystemModel('minimax', 'abab6.5s-chat'),
  createSystemModel('minimax', 'MiniMax-M2'),

  createSystemModel('grok', 'grok-4'),
  createSystemModel('grok', 'grok-3'),

  createSystemModel('hunyuan', 'hunyuan-pro'),
  createSystemModel('hunyuan', 'hunyuan-turbo'),
  createSystemModel('hunyuan', 'hunyuan-vision'),

  createSystemModel('huggingface', 'gpt-oss-120b'),
  createSystemModel('huggingface', 'zai-glm-4.6'),
  createSystemModel('huggingface', 'qwen-3-235b-a22b-instruct-2507'),

  createSystemModel('mimo', 'mimo-v2-flash')
]

function cloneModel(model: AiModel): AiModel {
  return {
    ...model,
    params: model.params ? { ...model.params } : undefined,
    capabilities: model.capabilities ? model.capabilities.map((item) => ({ ...item })) : undefined,
    supportedEndpointTypes: model.supportedEndpointTypes ? [...model.supportedEndpointTypes] : undefined
  }
}

export function getSystemDefaultModels(): AiModel[] {
  return SYSTEM_DEFAULT_MODELS.map(cloneModel)
}

export function mergeWithSystemDefaultModels(models: AiModel[]): AiModel[] {
  const existingIds = new Set(models.map((model) => String(model.id || '').trim()).filter(Boolean))
  const merged = [...models]
  for (const model of SYSTEM_DEFAULT_MODELS) {
    if (existingIds.has(model.id)) continue
    merged.push(cloneModel(model))
  }
  return merged
}
