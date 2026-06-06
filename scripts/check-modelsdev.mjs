#!/usr/bin/env node
/**
 * Verify the models.dev snapshot + the id-resolution logic used by
 * `src/main/ai/modelSpecs.ts`, WITHOUT booting Electron.
 *
 * - Resolves every system-default model id against the bundled snapshot and
 *   reports coverage (how many get a real context window).
 * - Spot-checks any extra ids passed on the CLI.
 *
 * Usage:
 *   node scripts/check-modelsdev.mjs
 *   node scripts/check-modelsdev.mjs "openai:gpt-5.4" "anthropic:claude-sonnet-4-6"
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const snapshot = JSON.parse(readFileSync(join(ROOT, 'src/shared/ai/data/model-specs.json'), 'utf8'))

const lastSegment = (id) => {
  const i = id.lastIndexOf('/')
  return i >= 0 ? id.slice(i + 1) : id
}
const stripDateSuffix = (id) => id.replace(/-\d{6,8}$/, '')

// Mirror of modelSpecs.ts lookup (keep in sync if the resolver changes).
function resolve(modelId) {
  const raw = String(modelId || '').trim()
  const i = raw.indexOf(':')
  const provider = i > 0 ? raw.slice(0, i).toLowerCase() : ''
  const model = (i > 0 ? raw.slice(i + 1) : raw).toLowerCase()
  const bare = lastSegment(model)
  const candidates = [
    provider ? snapshot.byKey[`${provider}/${model}`] : null,
    snapshot.byModel[model],
    snapshot.byModel[bare],
    snapshot.byModel[stripDateSuffix(model)],
    snapshot.byModel[stripDateSuffix(bare)]
  ]
  for (const t of candidates) if (Array.isArray(t) && t[0]) return t
  return null
}

function extractSystemModelIds() {
  try {
    const src = readFileSync(join(ROOT, 'src/shared/ai/systemModels.ts'), 'utf8')
    const ids = []
    const re = /id:\s*'([^']+)'/g
    let m
    while ((m = re.exec(src))) ids.push(m[1])
    return ids
  } catch {
    return []
  }
}

console.log(
  `[check-modelsdev] snapshot: models=${snapshot.modelCount} byKey=${Object.keys(snapshot.byKey).length} ` +
    `byModel=${Object.keys(snapshot.byModel).length} generatedAt=${snapshot.generatedAt}`
)

const sysIds = extractSystemModelIds()
if (sysIds.length) {
  let ok = 0
  const misses = []
  for (const id of sysIds) {
    if (resolve(id)) ok += 1
    else misses.push(id)
  }
  const pct = ((ok / sysIds.length) * 100).toFixed(1)
  console.log(`[check-modelsdev] system-default coverage: ${ok}/${sysIds.length} (${pct}%) resolved a context window`)
  if (misses.length) {
    console.log(`[check-modelsdev] unresolved (will use conservative default): ${misses.length}`)
    for (const id of misses.slice(0, 40)) console.log('   MISS  ' + id)
    if (misses.length > 40) console.log(`   ... and ${misses.length - 40} more`)
  }
}

const extra = process.argv.slice(2)
if (extra.length) {
  console.log('[check-modelsdev] spot-checks:')
  for (const id of extra) {
    const r = resolve(id)
    console.log('   ' + (r ? `OK  context=${r[0]} output=${r[1]}` : 'MISS').padEnd(28) + id)
  }
}
