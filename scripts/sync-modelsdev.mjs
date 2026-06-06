#!/usr/bin/env node
/**
 * Sync per-model context-window / output limits from models.dev into a compact
 * bundled snapshot at `src/shared/ai/data/model-specs.json`.
 *
 * models.dev ships an open catalog (https://models.dev/api.json) shaped as:
 *   { [providerId]: { id, name, models: { [modelId]: { limit:{context,output}, modalities, reasoning, tool_call, ... } } } }
 *
 * We only keep the fields the host actually needs for context engineering
 * (token window + max output), to keep the snapshot small. The runtime loader
 * (`src/main/ai/modelSpecs.ts`) reads this snapshot, an on-disk cache, and an
 * optional background refresh — mirroring opencode's models.dev pipeline.
 *
 * Usage:
 *   node scripts/sync-modelsdev.mjs                # fetch from models.dev
 *   node scripts/sync-modelsdev.mjs --input a.json # use a local api.json copy
 *   node scripts/sync-modelsdev.mjs --dry-run
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const OUT = join(ROOT, 'src/shared/ai/data/model-specs.json')
const SOURCE_URL = process.env.MODELS_DEV_URL || 'https://models.dev/api.json'

function parseArgs(argv) {
  const args = { input: '', dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--input') args.input = argv[++i] || ''
    else if (item === '--dry-run') args.dryRun = true
    else if (item === '--help' || item === '-h') {
      console.log('Usage: node scripts/sync-modelsdev.mjs [--input api.json] [--dry-run]')
      process.exit(0)
    }
  }
  return args
}

async function loadApiJson(input) {
  if (input) {
    const path = resolve(ROOT, input)
    if (!existsSync(path)) throw new Error(`--input file not found: ${path}`)
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  const res = await fetch(SOURCE_URL)
  if (!res.ok) throw new Error(`Fetch ${SOURCE_URL} failed: ${res.status} ${res.statusText}`)
  return await res.json()
}

/** Normalize a model id for cross-provider matching: lowercase, trim. */
function normId(id) {
  return String(id || '').trim().toLowerCase()
}

/** Last path segment after `/` (drops org prefixes like `deepseek-ai/...`). */
function lastSegment(id) {
  const s = normId(id)
  const slash = s.lastIndexOf('/')
  return slash >= 0 ? s.slice(slash + 1) : s
}

function build(api) {
  /** byKey: `${providerLower}/${modelIdLower}` -> [context, output] (exact). */
  const byKey = {}
  /** byModel: bare model id (and last-segment) -> [context, output] (cross-provider; keep MAX context). */
  const byModel = {}
  let total = 0
  let withContext = 0

  const putModel = (key, context, output) => {
    if (!key || !context) return
    const prev = byModel[key]
    // 聚合商代理上游模型，取最大上下文更贴近真实（保守度交给运行时预留 + 反应式兜底）
    if (!prev || context > prev[0]) byModel[key] = [context, output || 0]
  }

  for (const providerId of Object.keys(api)) {
    const provider = api[providerId]
    const models = provider?.models
    if (!models || typeof models !== 'object') continue
    for (const modelId of Object.keys(models)) {
      const m = models[modelId]
      total += 1
      const context = Number(m?.limit?.context) || 0
      const output = Number(m?.limit?.output) || 0
      if (!context) continue
      withContext += 1
      byKey[`${normId(providerId)}/${normId(modelId)}`] = [context, output]
      putModel(normId(modelId), context, output)
      putModel(lastSegment(modelId), context, output)
    }
  }

  return {
    source: SOURCE_URL,
    generatedAt: new Date().toISOString(),
    modelCount: total,
    withContextCount: withContext,
    byKey,
    byModel
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const api = await loadApiJson(args.input)
  const snapshot = build(api)
  const json = JSON.stringify(snapshot)
  console.log(
    `[sync-modelsdev] models=${snapshot.modelCount} withContext=${snapshot.withContextCount} ` +
      `byKey=${Object.keys(snapshot.byKey).length} byModel=${Object.keys(snapshot.byModel).length} ` +
      `size=${(json.length / 1024).toFixed(0)}KB`
  )
  if (args.dryRun) {
    console.log('[sync-modelsdev] dry-run, not writing')
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, json + '\n', 'utf8')
  console.log(`[sync-modelsdev] wrote ${OUT}`)
}

main().catch((error) => {
  console.error('[sync-modelsdev] failed:', error?.message || error)
  process.exit(1)
})
