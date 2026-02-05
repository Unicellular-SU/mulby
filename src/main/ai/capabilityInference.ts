import type { AiModel, AiModelType, AiProviderConfig } from '../../shared/types/ai'
import { findCherryStudioCatalogEntry, normalizeCherryStudioModelKey } from './cherryStudioCatalog'

// Reasoning models (from Cherry Studio)
const REASONING_REGEX =
  /^(?!.*-non-reasoning\b)(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking|think)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4|4-fast)(?:-[\w-]+)?\b.*)$/i

// Embedding + Rerank (from Cherry Studio)
const EMBEDDING_REGEX = /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i
const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i

// Tool calling (from Cherry Studio)
const FUNCTION_CALLING_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4',
  'gpt-4.5',
  'gpt-oss(?:-[\\w-]+)',
  'gpt-5(?:-[0-9-]+)?',
  'o(1|3|4)(?:-[\\w-]+)?',
  'claude',
  'qwen',
  'qwen3',
  'hunyuan',
  'deepseek',
  'glm-4(?:-[\\w-]+)?',
  'glm-4.5(?:-[\\w-]+)?',
  'glm-4.7(?:-[\\w-]+)?',
  'learnlm(?:-[\\w-]+)?',
  'gemini(?:-[\\w-]+)?',
  'grok-3(?:-[\\w-]+)?',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-k2(?:-[\\w-]+)?',
  'ling-\\w+(?:-[\\w-]+)?',
  'ring-\\w+(?:-[\\w-]+)?',
  'minimax-m2(?:.1)?',
  'mimo-v2-flash'
] as const

const FUNCTION_CALLING_EXCLUDED_MODELS = [
  'aqa(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'o1-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1',
  'gemini-1(?:\\.[\\w-]+)?',
  'qwen-mt(?:-[\\w-]+)?',
  'gpt-5-chat(?:-[\\w-]+)?',
  'glm-4\\.5v',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?',
  'deepseek-v3.2-speciale'
]

const FUNCTION_CALLING_REGEX = new RegExp(
  `\\b(?!(?:${FUNCTION_CALLING_EXCLUDED_MODELS.join('|')})\\b)(?:${FUNCTION_CALLING_MODELS.join('|')})\\b`,
  'i'
)

// Vision (from Cherry Studio)
const VISION_ALLOWED_MODELS = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-3-(?:flash|pro)(?:-preview)?',
  'gemini-(flash|pro|flash-lite)-latest',
  'gemini-exp',
  'claude-3',
  'claude-haiku-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'vision',
  'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen2.5-omni',
  'qwen3-omni(?:-[\\w-]+)?',
  'qvq',
  'internvl2',
  'grok-vision-beta',
  'grok-4(?:-[\\w-]+)?',
  'pixtral',
  'gpt-4(?:-[\\w-]+)',
  'gpt-4.1(?:-[\\w-]+)?',
  'gpt-4o(?:-[\\w-]+)?',
  'gpt-4.5(?:-[\\w-]+)',
  'gpt-5(?:-[\\w-]+)?',
  'chatgpt-4o(?:-[\\w-]+)?',
  'o1(?:-[\\w-]+)?',
  'o3(?:-[\\w-]+)?',
  'o4(?:-[\\w-]+)?',
  'deepseek-vl(?:[\\w-]+)?',
  'kimi-k2.5',
  'kimi-latest',
  'gemma-3(?:-[\\w-]+)',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-thinking-preview',
  'gemma3(?:[-:\\w]+)?',
  'kimi-vl-a3b-thinking(?:-[\\w-]+)?',
  'llama-guard-4(?:-[\\w-]+)?',
  'llama-4(?:-[\\w-]+)?',
  'step-1o(?:.*vision)?',
  'step-1v(?:-[\\w-]+)?',
  'qwen-omni(?:-[\\w-]+)?',
  'mistral-large-(2512|latest)',
  'mistral-medium-(2508|latest)',
  'mistral-small-(2506|latest)'
]

const VISION_EXCLUDED_MODELS = [
  'gpt-4-\\d+-preview',
  'gpt-4-turbo-preview',
  'gpt-4-32k',
  'gpt-4-\\d+',
  'o1-mini',
  'o3-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1'
]

const VISION_REGEX = new RegExp(
  `\\b(?!(?:${VISION_EXCLUDED_MODELS.join('|')})\\b)(${VISION_ALLOWED_MODELS.join('|')})\\b`,
  'i'
)

const DEDICATED_IMAGE_MODELS = [
  'dall-e(?:-[\\w-]+)?',
  'gpt-image(?:-[\\w-]+)?',
  'grok-2-image(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'flux(?:-[\\w-]+)?',
  'stable-?diffusion(?:-[\\w-]+)?',
  'stabilityai(?:-[\\w-]+)?',
  'sd-[\\w-]+',
  'sdxl(?:-[\\w-]+)?',
  'cogview(?:-[\\w-]+)?',
  'qwen-image(?:-[\\w-]+)?',
  'janus(?:-[\\w-]+)?',
  'midjourney(?:-[\\w-]+)?',
  'mj-[\\w-]+',
  'z-image(?:-[\\w-]+)?',
  'longcat-image(?:-[\\w-]+)?',
  'hunyuanimage(?:-[\\w-]+)?',
  'seedream(?:-[\\w-]+)?',
  'kandinsky(?:-[\\w-]+)?'
]

const DEDICATED_IMAGE_MODELS_REGEX = new RegExp(DEDICATED_IMAGE_MODELS.join('|'), 'i')

// Web search (from Cherry Studio, simplified)
const GEMINI_SEARCH_REGEX = new RegExp(
  'gemini-(?:2(?!.*-image-preview).*(?:-latest)?|3(?:\\.\\d+)?-(?:flash|pro)(?:-(?:image-)?preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\\w-]+)*$',
  'i'
)

const PERPLEXITY_SEARCH_MODELS = [
  'sonar-pro',
  'sonar',
  'sonar-reasoning',
  'sonar-reasoning-pro',
  'sonar-deep-research'
]

function getCandidateNames(model: AiModel): string[] {
  const candidates = new Set<string>()
  const maybeAdd = (value?: string) => {
    if (!value) return
    const raw = String(value).trim()
    if (!raw) return
    candidates.add(raw.toLowerCase())
    const normalized = normalizeCherryStudioModelKey(raw)
    if (normalized) {
      candidates.add(normalized)
    }
  }
  maybeAdd(model.id)
  maybeAdd(model.label)
  maybeAdd(model.description)
  return Array.from(candidates)
}

function matchesAny(candidates: string[], regex: RegExp): boolean {
  return candidates.some((candidate) => regex.test(candidate))
}

function isDedicatedImageModel(candidates: string[]): boolean {
  return matchesAny(candidates, DEDICATED_IMAGE_MODELS_REGEX)
}

function isOpenAIWebSearchModelName(modelId: string): boolean {
  return (
    modelId.includes('gpt-4o-search-preview') ||
    modelId.includes('gpt-4o-mini-search-preview') ||
    (modelId.includes('gpt-4.1') && !modelId.includes('gpt-4.1-nano')) ||
    (modelId.includes('gpt-4o') && !modelId.includes('gpt-4o-image')) ||
    modelId.includes('o3') ||
    modelId.includes('o4') ||
    (modelId.includes('gpt-5') && !modelId.includes('chat'))
  )
}

export function inferCapability(
  type: AiModelType,
  model: AiModel,
  _provider?: AiProviderConfig
): boolean | undefined {
  if (!model?.id) return undefined
  const candidates = getCandidateNames(model)
  const primary = normalizeCherryStudioModelKey(model.id)

  const catalogEntry = findCherryStudioCatalogEntry(model.id) || findCherryStudioCatalogEntry(model.label || '')
  if (catalogEntry?.capabilities?.some((cap) => cap.type === type)) {
    return true
  }

  switch (type) {
    case 'embedding':
      if (matchesAny(candidates, RERANKING_REGEX)) return false
      return matchesAny(candidates, EMBEDDING_REGEX) || undefined
    case 'rerank':
      return matchesAny(candidates, RERANKING_REGEX) || undefined
    case 'function_calling':
      if (matchesAny(candidates, RERANKING_REGEX) || matchesAny(candidates, EMBEDDING_REGEX)) return false
      if (isDedicatedImageModel(candidates)) return false
      return matchesAny(candidates, FUNCTION_CALLING_REGEX) || undefined
    case 'reasoning':
      return matchesAny(candidates, REASONING_REGEX) || undefined
    case 'vision':
      if (isDedicatedImageModel(candidates)) return false
      return matchesAny(candidates, VISION_REGEX) || undefined
    case 'web_search':
      if (PERPLEXITY_SEARCH_MODELS.includes(primary)) return true
      if (matchesAny(candidates, GEMINI_SEARCH_REGEX)) return true
      if (primary && isOpenAIWebSearchModelName(primary)) return true
      if (candidates.some((item) => item.includes('search'))) return undefined
      return undefined
    default:
      return undefined
  }
}
