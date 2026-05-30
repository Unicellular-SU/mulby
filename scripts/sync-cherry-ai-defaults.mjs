#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const ROOT = process.cwd()
const PROVIDERS_OUT = join(ROOT, 'src/shared/ai/systemProviders.ts')
const MODELS_OUT = join(ROOT, 'src/shared/ai/systemModels.ts')

const UNSUPPORTED_PROVIDER_TYPES = new Set([
  'aws-bedrock',
  'gateway',
  'vertexai'
])

const PROVIDER_TYPE_OVERRIDES = new Map([
  ['deepseek', 'deepseek'],
  ['openrouter', 'openrouter'],
  ['anthropic', 'anthropic'],
  ['gemini', 'gemini'],
  ['ollama', 'ollama'],
  ['azure-openai', 'azure-openai'],
  ['new-api', 'new-api'],
  ['cherryin', 'cherryin'],
  ['openai', 'openai-response'],
  ['huggingface', 'openai-response']
])

function parseArgs(argv) {
  const args = {
    source: process.env.CHERRY_STUDIO_SOURCE || detectCherryStudioSource() || '',
    dryRun: false,
    summaryJson: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--source') {
      args.source = argv[++i] || ''
    } else if (item === '--dry-run') {
      args.dryRun = true
    } else if (item === '--summary-json') {
      args.summaryJson = true
    } else if (item === '--help' || item === '-h') {
      printHelp()
      process.exit(0)
    }
  }
  if (!args.source) {
    throw new Error('Missing --source <cherry-studio-root>. You can also set CHERRY_STUDIO_SOURCE or place Cherry Studio next to this repo as ../cherry-studio, ../CherryStudio, ../Cherry-Studio, or ../cs.')
  }
  return args
}

function isCherryStudioRoot(input) {
  return existsSync(join(input, 'src/renderer/config/providers.ts')) &&
    existsSync(join(input, 'src/renderer/config/models/default.ts'))
}

function detectCherryStudioSource() {
  const candidates = [
    join(ROOT, 'cs'),
    join(ROOT, 'cherry-studio'),
    join(ROOT, 'CherryStudio'),
    join(ROOT, 'Cherry-Studio'),
    join(ROOT, '..', 'cherry-studio'),
    join(ROOT, '..', 'CherryStudio'),
    join(ROOT, '..', 'Cherry-Studio'),
    join(ROOT, '..', 'cs'),
    join(ROOT, '..', '..', 'cherry-studio'),
    join(ROOT, '..', '..', 'cs')
  ]
  return candidates.find(isCherryStudioRoot)
}

function printHelp() {
  console.log(`Usage: node scripts/sync-cherry-ai-defaults.mjs --source <cherry-studio-root> [--dry-run] [--summary-json]

Reads Cherry Studio:
  src/renderer/config/providers.ts
  src/renderer/config/models/default.ts

Generates:
  src/shared/ai/systemProviders.ts
  src/shared/ai/systemModels.ts`)
}

function readSourceFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }
  const source = readFileSync(filePath, 'utf8')
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function propName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function literalValue(node) {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => literalValue(item))
  if (ts.isObjectLiteralExpression(node)) return objectLiteralValue(node)
  return undefined
}

function objectLiteralValue(node) {
  const out = {}
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const name = propName(prop.name)
    if (!name) continue
    const value = literalValue(prop.initializer)
    if (value !== undefined) out[name] = value
  }
  return out
}

function findVariableObject(sourceFile, variableName) {
  let found
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
      const initializer = ts.isAsExpression(node.initializer) || ts.isSatisfiesExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      if (initializer && ts.isObjectLiteralExpression(initializer)) found = initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!found) throw new Error(`Cannot find object variable: ${variableName}`)
  return found
}

function extractProviders(sourceFile) {
  const rootObject = findVariableObject(sourceFile, 'SYSTEM_PROVIDERS_CONFIG')
  const providers = []
  for (const prop of rootObject.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    if (!ts.isObjectLiteralExpression(prop.initializer)) continue
    const item = objectLiteralValue(prop.initializer)
    if (!item.id || !item.name || !item.type) continue
    providers.push(item)
  }
  return providers
}

function extractModels(sourceFile) {
  const rootObject = findVariableObject(sourceFile, 'SYSTEM_MODELS')
  const models = new Map()
  for (const prop of rootObject.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const providerId = propName(prop.name)
    if (!providerId || providerId === 'defaultModel') continue
    if (!ts.isArrayLiteralExpression(prop.initializer)) continue
    const rows = []
    for (const item of prop.initializer.elements) {
      if (!ts.isObjectLiteralExpression(item)) continue
      const model = objectLiteralValue(item)
      if (!model.id) continue
      rows.push(model)
    }
    models.set(providerId, rows)
  }
  return models
}

function normalizeBaseURL(provider) {
  const raw = String(provider.apiHost || '').trim()
  if (!raw) return ''
  const withoutSlash = raw.replace(/\/+$/, '')
  const type = mapProviderType(provider)
  if (type === 'openai-response' && provider.id === 'openai') return 'https://api.openai.com/v1'
  if (type === 'gemini' && withoutSlash === 'https://generativelanguage.googleapis.com') {
    return 'https://generativelanguage.googleapis.com/v1beta'
  }
  if (type === 'cherryin' && withoutSlash === 'https://open.cherryin.cc') {
    return 'https://open.cherryin.net/v1'
  }
  return withoutSlash
}

function normalizeAnthropicBaseURL(provider) {
  const value = String(provider.anthropicApiHost || '').trim().replace(/\/+$/, '')
  return value || undefined
}

function mapProviderType(provider) {
  if (PROVIDER_TYPE_OVERRIDES.has(provider.id)) return PROVIDER_TYPE_OVERRIDES.get(provider.id)
  const type = String(provider.type || '').trim()
  if (type === 'openai') return 'openai-compatible'
  return type || 'openai-compatible'
}

function isSupportedProvider(provider) {
  const type = mapProviderType(provider)
  if (!type || UNSUPPORTED_PROVIDER_TYPES.has(type)) return false
  return true
}

function toMulbyProvider(provider) {
  const baseURL = normalizeBaseURL(provider)
  return {
    id: provider.id,
    type: mapProviderType(provider),
    label: provider.name,
    enabled: false,
    apiKey: '',
    ...(baseURL ? { baseURL } : {}),
    ...(provider.apiVersion !== undefined ? { apiVersion: String(provider.apiVersion || '') } : {}),
    ...(normalizeAnthropicBaseURL(provider) ? { anthropicBaseURL: normalizeAnthropicBaseURL(provider) } : {})
  }
}

function endpointType(value) {
  if (!value) return undefined
  const normalized = String(value)
  return ['openai', 'openai-response', 'anthropic', 'gemini', 'image-generation', 'jina-rerank'].includes(normalized)
    ? normalized
    : undefined
}

function toMulbyModel(model, providerId) {
  const id = `${providerId}:${model.id}`
  const capabilities = Array.isArray(model.capabilities)
    ? model.capabilities
      .filter((cap) => cap && typeof cap === 'object' && typeof cap.type === 'string')
      .map((cap) => ({
        type: cap.type,
        ...(cap.isUserSelected !== undefined ? { isUserSelected: Boolean(cap.isUserSelected) } : {})
      }))
    : undefined
  const supportedEndpointTypes = Array.isArray(model.supported_endpoint_types)
    ? model.supported_endpoint_types.map(endpointType).filter(Boolean)
    : undefined
  return {
    id,
    label: String(model.name || model.id).trim() || String(model.id),
    description: model.group ? `Cherry Studio: ${model.group}` : 'Cherry Studio default model',
    providerRef: providerId,
    providerLabel: providerId,
    ...(endpointType(model.endpoint_type) ? { endpointType: endpointType(model.endpoint_type) } : {}),
    ...(supportedEndpointTypes?.length ? { supportedEndpointTypes } : {}),
    ...(capabilities?.length ? { capabilities } : {})
  }
}

function uniqueById(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function generateProvidersFile(providers) {
  const ids = providers.map((provider) => provider.id)
  return `import type { AiProviderConfig } from '../types/ai'

// Generated by scripts/sync-cherry-ai-defaults.mjs from Cherry Studio defaults.
// Do not edit provider/model entries manually; update the source sync mapping instead.

export const SYSTEM_DEFAULT_PROVIDER_IDS = ${formatArray(ids)} as const

const SYSTEM_DEFAULT_PROVIDERS: AiProviderConfig[] = ${formatArray(providers)}

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
`
}

function generateModelsFile(models) {
  return `import type { AiModel } from '../types/ai'

// Generated by scripts/sync-cherry-ai-defaults.mjs from Cherry Studio defaults.
// Do not edit provider/model entries manually; update the source sync mapping instead.

const SYSTEM_DEFAULT_MODELS: AiModel[] = ${formatArray(models)}

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
`
}

function formatArray(value) {
  return JSON.stringify(value, null, 2)
    .replace(/"([^"]+)":/g, '$1:')
    .replace(/"/g, "'")
}

function buildSummary(providers, models) {
  const modelCountByProvider = {}
  for (const model of models) {
    modelCountByProvider[model.providerRef] = (modelCountByProvider[model.providerRef] || 0) + 1
  }
  return {
    providerCount: providers.length,
    modelCount: models.length,
    providers: Object.fromEntries(providers.map((provider) => [provider.id, provider])),
    modelCountByProvider
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const sourceRoot = resolve(args.source)
  const providersPath = join(sourceRoot, 'src/renderer/config/providers.ts')
  const modelsPath = join(sourceRoot, 'src/renderer/config/models/default.ts')
  const csProviders = extractProviders(readSourceFile(providersPath))
  const csModels = extractModels(readSourceFile(modelsPath))

  const providers = csProviders
    .filter(isSupportedProvider)
    .map(toMulbyProvider)
  const providerIds = new Set(providers.map((provider) => provider.id))
  const models = uniqueById(
    Array.from(csModels.entries())
      .filter(([providerId]) => providerIds.has(providerId))
      .flatMap(([providerId, rows]) => rows.map((model) => toMulbyModel(model, providerId)))
  )

  if (args.summaryJson) {
    process.stdout.write(`${JSON.stringify(buildSummary(providers, models), null, 2)}\n`)
    return
  }

  const providerFile = generateProvidersFile(providers)
  const modelFile = generateModelsFile(models)
  if (args.dryRun) {
    console.log(`Would write ${providers.length} providers to ${PROVIDERS_OUT}`)
    console.log(`Would write ${models.length} models to ${MODELS_OUT}`)
    return
  }
  writeFileSync(PROVIDERS_OUT, providerFile, 'utf8')
  writeFileSync(MODELS_OUT, modelFile, 'utf8')
  console.log(`Synced ${providers.length} Cherry Studio providers.`)
  console.log(`Synced ${models.length} Cherry Studio models.`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
