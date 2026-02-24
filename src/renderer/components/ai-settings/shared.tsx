import type {
  AiEndpointType,
  AiModelCapability,
  AiModelType,
  AiProviderConfig
} from '../../../shared/types/ai'
import { BUILTIN_PROVIDER_TYPES } from '../../../shared/ai/providerType'

export const PROVIDER_TYPE_OPTIONS = [...BUILTIN_PROVIDER_TYPES] as string[]

export const PROVIDER_TYPE_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  'openai-response': 'OpenAI-Response',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  'azure-openai': 'Azure OpenAI',
  'new-api': 'New API',
  cherryin: 'CherryIN',
  ollama: 'Ollama',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  'openai-compatible': 'OpenAI Compatible'
}

export const ENDPOINT_TYPE_OPTIONS: AiEndpointType[] = [
  'openai',
  'openai-response',
  'anthropic',
  'gemini',
  'image-generation',
  'jina-rerank'
]

export const DEFAULT_TEMPERATURE = 0.7
export const DEFAULT_TOP_P = 1
export const DEFAULT_CONTEXT_WINDOW = 8

export const MODEL_CAPABILITIES: Array<{ type: AiModelType; label: string }> = [
  { type: 'vision', label: '视觉' },
  { type: 'reasoning', label: '推理' },
  { type: 'function_calling', label: '工具' },
  { type: 'web_search', label: '联网' },
  { type: 'embedding', label: '嵌入' },
  { type: 'rerank', label: '重排' }
]

export const classNames = {
  cardClass: 'rounded-[24px] border border-slate-200/80 bg-white p-6 dark:border-slate-800/80 dark:bg-slate-900',
  cardClassTight: 'rounded-[24px] border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900',
  pillClass: 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50',
  primaryPillClass: 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60',
  actionButtonClass: 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50',
  inputClass: 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200',
  miniInputClass: 'w-24 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200',
  tipWrapClass: 'relative inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 group',
  tipBubbleClass: 'pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 opacity-0 shadow-lg transition group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
} as const

export interface ProviderListEntry {
  provider: AiProviderConfig
  index: number
}

export interface ProviderModelOption {
  id: string
  label: string
}

export interface ApiKeyTestStatus {
  state: 'success' | 'error' | 'testing'
  message: string
}

export function getProviderTypeOptions(currentType?: string): string[] {
  const normalized = String(currentType || '').trim().toLowerCase()
  const base = [...PROVIDER_TYPE_OPTIONS]
  if (!normalized || base.includes(normalized)) return base
  return [normalized, ...base]
}

export function serializeApiKeys(keys: string[]): string {
  return keys
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => key.replace(/,/g, '\\,'))
    .join(',')
}

export function formatNumber(value?: number): string {
  return value === undefined || Number.isNaN(value) ? '' : String(value)
}

export function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : undefined
}

export function formatStopSequences(value?: string[]): string {
  return value && value.length > 0 ? value.join('\n') : ''
}

export function parseStopSequences(value: string): string[] | undefined {
  const items = value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

export function formatEndpointTypes(value?: AiEndpointType[]): string {
  return value && value.length > 0 ? value.join(', ') : ''
}

export function parseEndpointTypes(value: string): AiEndpointType[] | undefined {
  const allowed = new Set<AiEndpointType>(ENDPOINT_TYPE_OPTIONS)
  const items = value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item): item is AiEndpointType => allowed.has(item as AiEndpointType))
  return items.length > 0 ? Array.from(new Set(items)) : undefined
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      onClick={onChange}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}

export function getModelCapabilityState(
  model: { id: string; capabilities?: AiModelCapability[] },
  type: AiModelType,
  inferredCapabilities: Record<string, Set<AiModelType>>
): boolean {
  const caps = model.capabilities || []
  const item = caps.find((cap) => cap.type === type)
  if (item) {
    return item.isUserSelected !== false
  }
  const inferred = inferredCapabilities[model.id]
  if (inferred) {
    return inferred.has(type)
  }
  return false
}

export function isCapabilityAuto(model: { capabilities?: AiModelCapability[] }, type: AiModelType): boolean {
  const caps = model.capabilities || []
  const item = caps.find((cap) => cap.type === type)
  return !item
}
