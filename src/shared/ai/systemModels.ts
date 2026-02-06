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
  // openai
  createSystemModel('openai', 'gpt-5.1'),
  createSystemModel('openai', 'gpt-5'),
  createSystemModel('openai', 'gpt-5-mini'),
  createSystemModel('openai', 'gpt-5-nano'),
  createSystemModel('openai', 'gpt-5-pro'),
  createSystemModel('openai', 'gpt-5-chat'),
  createSystemModel('openai', 'gpt-image-1'),

  // deepseek
  createSystemModel('deepseek', 'deepseek-chat'),
  createSystemModel('deepseek', 'deepseek-reasoner'),

  // gemini
  createSystemModel('gemini', 'gemini-2.5-flash'),
  createSystemModel('gemini', 'gemini-2.5-pro'),
  createSystemModel('gemini', 'gemini-2.5-flash-image-preview'),
  createSystemModel('gemini', 'gemini-3-pro-image-preview'),
  createSystemModel('gemini', 'gemini-3-pro-preview'),

  // anthropic
  createSystemModel('anthropic', 'claude-sonnet-4-5'),
  createSystemModel('anthropic', 'claude-haiku-4-5'),
  createSystemModel('anthropic', 'claude-opus-4-5'),

  // silicon
  createSystemModel('silicon', 'deepseek-ai/DeepSeek-V3.2'),
  createSystemModel('silicon', 'Qwen/Qwen3-8B'),
  createSystemModel('silicon', 'BAAI/bge-m3'),

  // zhipu
  createSystemModel('zhipu', 'glm-4.5-flash'),
  createSystemModel('zhipu', 'glm-4.6'),
  createSystemModel('zhipu', 'glm-4.6v'),
  createSystemModel('zhipu', 'glm-4.6v-flash'),
  createSystemModel('zhipu', 'glm-4.6v-flashx'),
  createSystemModel('zhipu', 'glm-4.7'),
  createSystemModel('zhipu', 'glm-4.5'),
  createSystemModel('zhipu', 'glm-4.5-air'),
  createSystemModel('zhipu', 'glm-4.5-airx'),
  createSystemModel('zhipu', 'glm-4.5v'),
  createSystemModel('zhipu', 'embedding-3'),

  // dmxapi
  createSystemModel('dmxapi', 'Qwen/Qwen2.5-7B-Instruct'),
  createSystemModel('dmxapi', 'ERNIE-Speed-128K'),
  createSystemModel('dmxapi', 'gpt-4o'),
  createSystemModel('dmxapi', 'gpt-4o-mini'),
  createSystemModel('dmxapi', 'DMXAPI-DeepSeek-R1'),
  createSystemModel('dmxapi', 'DMXAPI-DeepSeek-V3'),
  createSystemModel('dmxapi', 'claude-3-5-sonnet-20241022'),
  createSystemModel('dmxapi', 'gemini-2.0-flash'),

  // moonshot
  createSystemModel('moonshot', 'moonshot-v1-auto'),
  createSystemModel('moonshot', 'kimi-k2-0711-preview'),

  // baichuan
  createSystemModel('baichuan', 'Baichuan4'),
  createSystemModel('baichuan', 'Baichuan3-Turbo'),
  createSystemModel('baichuan', 'Baichuan3-Turbo-128k'),
  createSystemModel('baichuan', 'Baichuan4-Turbo'),
  createSystemModel('baichuan', 'Baichuan4-Air'),
  createSystemModel('baichuan', 'Baichuan-M2'),
  createSystemModel('baichuan', 'Baichuan-M2-Plus'),
  createSystemModel('baichuan', 'Baichuan-M3'),
  createSystemModel('baichuan', 'Baichuan-M3-Plus'),

  // dashscope
  createSystemModel('dashscope', 'qwen-vl-plus'),
  createSystemModel('dashscope', 'qwen-coder-plus'),
  createSystemModel('dashscope', 'qwen-flash'),
  createSystemModel('dashscope', 'qwen-plus'),
  createSystemModel('dashscope', 'qwen-max'),
  createSystemModel('dashscope', 'qwen3-max'),
  createSystemModel('dashscope', 'text-embedding-v4'),
  createSystemModel('dashscope', 'text-embedding-v3'),
  createSystemModel('dashscope', 'text-embedding-v2'),
  createSystemModel('dashscope', 'text-embedding-v1'),
  createSystemModel('dashscope', 'qwen3-rerank'),

  // doubao
  createSystemModel('doubao', 'doubao-seed-1-8-251228'),
  createSystemModel('doubao', 'doubao-1-5-vision-pro-32k-250115'),
  createSystemModel('doubao', 'doubao-1-5-pro-32k-250115'),
  createSystemModel('doubao', 'doubao-1-5-pro-32k-character-250228'),
  createSystemModel('doubao', 'doubao-1-5-pro-256k-250115'),
  createSystemModel('doubao', 'deepseek-r1-250120'),
  createSystemModel('doubao', 'deepseek-r1-distill-qwen-32b-250120'),
  createSystemModel('doubao', 'deepseek-r1-distill-qwen-7b-250120'),
  createSystemModel('doubao', 'deepseek-v3-250324'),
  createSystemModel('doubao', 'doubao-pro-32k-241215'),
  createSystemModel('doubao', 'doubao-pro-32k-functioncall-241028'),
  createSystemModel('doubao', 'doubao-pro-32k-character-241215'),
  createSystemModel('doubao', 'doubao-pro-256k-241115'),
  createSystemModel('doubao', 'doubao-lite-4k-character-240828'),
  createSystemModel('doubao', 'doubao-lite-32k-240828'),
  createSystemModel('doubao', 'doubao-lite-32k-character-241015'),
  createSystemModel('doubao', 'doubao-lite-128k-240828'),
  createSystemModel('doubao', 'doubao-1-5-lite-32k-250115'),
  createSystemModel('doubao', 'doubao-embedding-large-text-240915'),
  createSystemModel('doubao', 'doubao-embedding-text-240715'),
  createSystemModel('doubao', 'doubao-embedding-vision-241215'),
  createSystemModel('doubao', 'doubao-vision-lite-32k-241015'),

  // minimax
  createSystemModel('minimax', 'abab6.5s-chat'),
  createSystemModel('minimax', 'abab6.5g-chat'),
  createSystemModel('minimax', 'abab6.5t-chat'),
  createSystemModel('minimax', 'abab5.5s-chat'),
  createSystemModel('minimax', 'minimax-text-01'),
  createSystemModel('minimax', 'MiniMax-M2'),
  createSystemModel('minimax', 'MiniMax-M2-Stable'),
  createSystemModel('minimax', 'MiniMax-M2.1'),

  // grok
  createSystemModel('grok', 'grok-4'),
  createSystemModel('grok', 'grok-3'),
  createSystemModel('grok', 'grok-3-fast'),
  createSystemModel('grok', 'grok-3-mini'),
  createSystemModel('grok', 'grok-3-mini-fast'),

  // hunyuan
  createSystemModel('hunyuan', 'hunyuan-pro'),
  createSystemModel('hunyuan', 'hunyuan-standard'),
  createSystemModel('hunyuan', 'hunyuan-lite'),
  createSystemModel('hunyuan', 'hunyuan-standard-256k'),
  createSystemModel('hunyuan', 'hunyuan-vision'),
  createSystemModel('hunyuan', 'hunyuan-code'),
  createSystemModel('hunyuan', 'hunyuan-role'),
  createSystemModel('hunyuan', 'hunyuan-turbo'),
  createSystemModel('hunyuan', 'hunyuan-turbos-latest'),
  createSystemModel('hunyuan', 'hunyuan-embedding'),

  // huggingface（Cherry Studio default.ts 中无该 provider 默认模型，保留本项目既有项）
  createSystemModel('huggingface', 'gpt-oss-120b'),
  createSystemModel('huggingface', 'zai-glm-4.6'),
  createSystemModel('huggingface', 'qwen-3-235b-a22b-instruct-2507'),

  // mimo
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
