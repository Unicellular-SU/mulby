/**
 * 模型规格（上下文窗口 / 最大输出 token）查询。
 *
 * 数据来源优先级（抄 opencode 的 models.dev 管线）：
 *   ① 用户在模型配置里显式覆盖的 `contextTokens`
 *   ② 磁盘缓存（userData/model-specs.cache.json，后台从 models.dev 定时刷新）
 *   ③ 打包快照（src/shared/ai/data/model-specs.json，由 scripts/sync-modelsdev.mjs 生成）
 * 三者都查不到 → 返回 undefined，调用方应保守处理（不要按错的固定值激进压缩，避免误伤大窗口模型）。
 *
 * 仅主进程使用（依赖 electron app 路径与 fetch）。
 */
import { app } from 'electron'
import log from 'electron-log'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import bundledSnapshot from '../../shared/ai/data/model-specs.json'
import { getAiSettings } from './config'

// [contextTokens, maxOutputTokens, capabilityFlags?] — flags bitmask: 1=reasoning,
// 2=tool_call, 4=vision. The flags element is optional for backwards compatibility
// with older snapshots/caches (absent → capabilities unknown, callers fall back).
type SpecTuple = [number, number, number?]

const FLAG_REASONING = 1
const FLAG_TOOL_CALL = 2
const FLAG_VISION = 4

interface SpecTable {
  byKey: Record<string, SpecTuple>
  byModel: Record<string, SpecTuple>
}

export interface ModelSpec {
  contextTokens: number
  maxOutputTokens: number
}

/** Authoritative per-model capabilities from models.dev (undefined when unknown). */
export interface ModelDevCaps {
  reasoning: boolean
  toolCall: boolean
  vision: boolean
}

const bundled = bundledSnapshot as unknown as SpecTable

const SOURCE_URL = process.env.MODELS_DEV_URL || 'https://models.dev/api.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 一天刷新一次

let diskTable: SpecTable | null = null
let diskLoaded = false
let refreshStarted = false

function tupleToSpec(tuple?: SpecTuple): ModelSpec | undefined {
  if (!Array.isArray(tuple) || !tuple[0]) return undefined
  return { contextTokens: tuple[0], maxOutputTokens: tuple[1] || 0 }
}

function lastSegment(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash >= 0 ? id.slice(slash + 1) : id
}

/** 去掉结尾的日期版本号（如 `-250120` / `-20250514`），以匹配 models.dev 的无日期键。 */
function stripDateSuffix(id: string): string {
  return id.replace(/-\d{6,8}$/, '')
}

/** mulby 模型 id 形如 `provider:modelId`（modelId 可能含 `/`）。拆出 provider 与 model 两段。 */
function splitModelId(modelId: string): { providerToken: string; modelPart: string } {
  const raw = String(modelId || '').trim()
  const idx = raw.indexOf(':')
  if (idx > 0) return { providerToken: raw.slice(0, idx), modelPart: raw.slice(idx + 1) }
  return { providerToken: '', modelPart: raw }
}

function lookupTuple(table: SpecTable | null, providerToken: string, modelPart: string): SpecTuple | undefined {
  if (!table) return undefined
  const provider = providerToken.toLowerCase()
  const model = modelPart.toLowerCase()
  const bare = lastSegment(model)
  const candidates = [
    provider ? table.byKey?.[`${provider}/${model}`] : undefined,
    table.byModel?.[model],
    table.byModel?.[bare],
    table.byModel?.[stripDateSuffix(model)],
    table.byModel?.[stripDateSuffix(bare)]
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate[0]) return candidate
  }
  return undefined
}

function lookupTable(table: SpecTable | null, providerToken: string, modelPart: string): ModelSpec | undefined {
  return tupleToSpec(lookupTuple(table, providerToken, modelPart))
}

function decodeFlags(tuple?: SpecTuple): ModelDevCaps | undefined {
  // Flags element absent (older snapshot/cache) → capabilities unknown.
  if (!Array.isArray(tuple) || typeof tuple[2] !== 'number') return undefined
  const flags = tuple[2]
  return {
    reasoning: (flags & FLAG_REASONING) !== 0,
    toolCall: (flags & FLAG_TOOL_CALL) !== 0,
    vision: (flags & FLAG_VISION) !== 0
  }
}

/**
 * models.dev per-model capability flags (reasoning / tool_call / vision), or
 * undefined when the model isn't in the catalog (or the snapshot predates flags).
 * Disk cache (fresh) is preferred; falls back to the bundled snapshot.
 */
export function getModelDevCaps(modelId?: string): ModelDevCaps | undefined {
  if (!modelId) return undefined
  void ensureFreshCache()
  const { providerToken, modelPart } = splitModelId(modelId)
  return (
    decodeFlags(lookupTuple(diskTable, providerToken, modelPart)) ??
    decodeFlags(lookupTuple(bundled, providerToken, modelPart))
  )
}

function userOverride(modelId: string): ModelSpec | undefined {
  try {
    const settings = getAiSettings()
    const model = settings.models?.find((item) => item.id === modelId)
    const ctx = model?.contextTokens
    if (typeof ctx === 'number' && ctx > 0) {
      return { contextTokens: ctx, maxOutputTokens: model?.params?.maxOutputTokens || 0 }
    }
  } catch {
    /* settings 不可用时忽略 */
  }
  return undefined
}

/**
 * 查询模型规格。未知返回 undefined（调用方保守处理）。
 */
export function getModelSpec(modelId?: string): ModelSpec | undefined {
  if (!modelId) return undefined
  const override = userOverride(modelId)
  if (override) return override
  void ensureFreshCache() // 非阻塞后台刷新
  const { providerToken, modelPart } = splitModelId(modelId)
  return lookupTable(diskTable, providerToken, modelPart) || lookupTable(bundled, providerToken, modelPart)
}

/** 模型上下文窗口（token）。未知返回 undefined。 */
export function getModelContextWindow(modelId?: string): number | undefined {
  return getModelSpec(modelId)?.contextTokens
}

/** 模型最大输出 token。未知返回 undefined。 */
export function getModelMaxOutputTokens(modelId?: string): number | undefined {
  const output = getModelSpec(modelId)?.maxOutputTokens
  return output && output > 0 ? output : undefined
}

function cachePath(): string | null {
  try {
    return join(app.getPath('userData'), 'model-specs.cache.json')
  } catch {
    return null // app 未就绪 / 非 electron 环境
  }
}

type ModelsDevEntry = {
  limit?: { context?: number; output?: number }
  reasoning?: boolean
  tool_call?: boolean
  modalities?: { input?: string[] }
}

/** Compact capability bitmask from a models.dev model entry (mirrors sync script). */
function modelDevFlags(m: ModelsDevEntry | undefined): number {
  let flags = 0
  if (m?.reasoning === true) flags |= FLAG_REASONING
  if (m?.tool_call === true) flags |= FLAG_TOOL_CALL
  const input = m?.modalities?.input
  if (Array.isArray(input) && input.includes('image')) flags |= FLAG_VISION
  return flags
}

function buildTableFromApi(api: Record<string, unknown>): SpecTable {
  const byKey: Record<string, SpecTuple> = {}
  const byModel: Record<string, SpecTuple> = {}
  const putModel = (key: string, context: number, output: number, flags: number) => {
    if (!key || !context) return
    const prev = byModel[key]
    if (!prev || context > prev[0]) byModel[key] = [context, output || 0, flags || 0]
  }
  for (const providerId of Object.keys(api || {})) {
    const provider = api[providerId] as { models?: Record<string, ModelsDevEntry> }
    const models = provider?.models
    if (!models || typeof models !== 'object') continue
    for (const modelId of Object.keys(models)) {
      const entry = models[modelId]
      const context = Number(entry?.limit?.context) || 0
      const output = Number(entry?.limit?.output) || 0
      if (!context) continue
      const flags = modelDevFlags(entry)
      byKey[`${providerId.toLowerCase()}/${modelId.toLowerCase()}`] = [context, output, flags]
      putModel(modelId.toLowerCase(), context, output, flags)
      putModel(lastSegment(modelId.toLowerCase()), context, output, flags)
    }
  }
  return { byKey, byModel }
}

async function loadDiskCacheOnce(): Promise<void> {
  if (diskLoaded) return
  diskLoaded = true
  const path = cachePath()
  if (!path) return
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed?.byKey || parsed?.byModel) {
      diskTable = { byKey: parsed.byKey || {}, byModel: parsed.byModel || {} }
    }
  } catch {
    /* 尚无缓存 */
  }
}

/** 后台刷新 models.dev → 写磁盘缓存。每个进程生命周期内最多触发一次，避免频繁请求。 */
async function ensureFreshCache(): Promise<void> {
  if (refreshStarted) return
  refreshStarted = true
  await loadDiskCacheOnce()
  const path = cachePath()
  if (!path) return
  let stale = !diskTable
  if (diskTable) {
    try {
      const ts = JSON.parse(await readFile(path, 'utf8'))?.generatedAt
      const age = ts ? Date.now() - new Date(ts).getTime() : Infinity
      stale = age > CACHE_TTL_MS
    } catch {
      stale = true
    }
  }
  if (!stale) return
  void (async () => {
    try {
      const res = await fetch(SOURCE_URL)
      if (!res.ok) return
      const api = (await res.json()) as Record<string, unknown>
      const table = buildTableFromApi(api)
      if (!Object.keys(table.byModel).length) return
      diskTable = table
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify({ generatedAt: new Date().toISOString(), ...table }), 'utf8')
      log.info('[AI] model-specs 缓存已从 models.dev 刷新', { models: Object.keys(table.byModel).length })
    } catch (error) {
      log.warn('[AI] model-specs 刷新失败（使用打包快照）', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })()
}
