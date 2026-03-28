import path from 'node:path'
import YAML from 'yaml'
import type { AiSkillMcpPolicy } from '../../../shared/types/ai'

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/
const ALLOWED_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'version',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools'
])

export interface SkillFrontmatterSpec {
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
}

export interface SkillDocumentSpec {
  frontmatter: SkillFrontmatterSpec
  body: string
}

export interface SkillValidationOptions {
  skillDirPath?: string
  filePath?: string
  requireCanonicalSkillFileName?: boolean
}

export interface SkillValidationResult {
  ok: boolean
  errors: string[]
  document?: SkillDocumentSpec
}

export interface MulbySkillExtensions {
  mode?: 'manual' | 'auto' | 'both'
  triggerPhrases?: string[]
  capabilities?: string[]
  internalTools?: string[]
  mcpPolicy?: AiSkillMcpPolicy
}

export const MULBY_METADATA_KEYS = {
  mode: 'mulby.mode',
  triggerPhrases: 'mulby.trigger_phrases',
  capabilities: 'mulby.capabilities',
  internalTools: 'mulby.internal_tools',
  mcpPolicy: 'mulby.mcp_policy'
} as const

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.map((item) => normalizeText(item)).filter(Boolean)
  if (out.length === 0) return undefined
  return Array.from(new Set(out))
}

function parseJsonArrayString(value: string | undefined): string[] | undefined {
  const text = normalizeText(value)
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text)
    return normalizeStringArray(parsed)
  } catch {
    return undefined
  }
}

function parseJsonObject<T extends object>(value: string | undefined): T | undefined {
  const text = normalizeText(value)
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as T
  } catch {
    return undefined
  }
}

function validateSkillName(name: string): string | null {
  if (!name) return 'name is required'
  if (name.length > 64) return `name is too long (${name.length}), max is 64`
  if (name.startsWith('-') || name.endsWith('-')) return 'name must not start/end with hyphen'
  if (name.includes('--')) return 'name must not contain consecutive hyphens'
  if (!/^[\p{Ll}\p{Nd}-]+$/u.test(name)) {
    return 'name must contain only lowercase unicode letters, digits, and hyphens'
  }
  return null
}

function normalizeMetadata(input: unknown, errors: string[]): Record<string, string> | undefined {
  if (input === undefined || input === null) return undefined
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push('metadata must be a key-value object of strings')
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = normalizeText(rawKey)
    if (!key) {
      errors.push('metadata key must not be empty')
      continue
    }
    if (typeof rawValue === 'string') {
      out[key] = rawValue
    } else {
      // Auto-stringify non-string metadata values (e.g. nested objects from third-party skills)
      out[key] = JSON.stringify(rawValue)
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeAllowedTools(input: unknown, errors: string[]): string[] | undefined {
  if (input === undefined || input === null || input === '') return undefined
  if (typeof input !== 'string') {
    errors.push('allowed-tools must be a space-delimited string')
    return undefined
  }
  const list = input
    .split(/\s+/)
    .map((item) => normalizeText(item))
    .filter(Boolean)
  return list.length > 0 ? Array.from(new Set(list)) : undefined
}

function parseFrontmatterRaw(content: string): {
  frontmatterRaw: string
  body: string
} | null {
  const match = String(content || '').match(FRONTMATTER_PATTERN)
  if (!match) return null
  return {
    frontmatterRaw: match[1],
    body: match[2] || ''
  }
}

function normalizeBody(body: string): string {
  return String(body || '').replace(/^\r?\n/, '').trim()
}

export function validateSkillMarkdown(content: string, options?: SkillValidationOptions): SkillValidationResult {
  const errors: string[] = []
  const parsed = parseFrontmatterRaw(content)
  if (!parsed) {
    return {
      ok: false,
      errors: ['SKILL.md must start with YAML frontmatter enclosed by ---']
    }
  }

  let frontmatterObj: Record<string, unknown> | null = null
  try {
    const loaded = YAML.parse(parsed.frontmatterRaw)
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      errors.push('frontmatter must be a YAML object')
    } else {
      frontmatterObj = loaded as Record<string, unknown>
    }
  } catch (error) {
    errors.push(`invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!frontmatterObj) {
    return { ok: false, errors }
  }

  const unknownKeys = Object.keys(frontmatterObj).filter((key) => !ALLOWED_FRONTMATTER_KEYS.has(key))
  if (unknownKeys.length > 0) {
    errors.push(`unexpected frontmatter keys: ${unknownKeys.join(', ')}`)
  }

  const name = normalizeText(frontmatterObj.name)
  const nameError = validateSkillName(name)
  if (nameError) errors.push(nameError)

  const description = normalizeText(frontmatterObj.description)
  if (!description) {
    errors.push('description is required')
  } else if (description.length > 1024) {
    errors.push(`description is too long (${description.length}), max is 1024`)
  }

  const license = frontmatterObj.license === undefined ? undefined : normalizeText(frontmatterObj.license)

  const compatibility = frontmatterObj.compatibility === undefined
    ? undefined
    : normalizeText(frontmatterObj.compatibility)
  if (compatibility !== undefined) {
    if (!compatibility) {
      errors.push('compatibility must not be empty when provided')
    } else if (compatibility.length > 500) {
      errors.push(`compatibility is too long (${compatibility.length}), max is 500`)
    }
  }

  const metadata = normalizeMetadata(frontmatterObj.metadata, errors)
  const allowedTools = normalizeAllowedTools(frontmatterObj['allowed-tools'], errors)

  if (options?.requireCanonicalSkillFileName && options.filePath) {
    const base = path.basename(options.filePath)
    if (base !== 'SKILL.md') {
      errors.push(`skill file must be named SKILL.md (actual: ${base})`)
    }
  }

  if (options?.skillDirPath && name) {
    const dirName = path.basename(options.skillDirPath)
    if (dirName !== name) {
      errors.push(`skill directory name must match frontmatter.name (${dirName} !== ${name})`)
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors
    }
  }

  return {
    ok: true,
    errors: [],
    document: {
      frontmatter: {
        name,
        description,
        ...(license ? { license } : {}),
        ...(compatibility ? { compatibility } : {}),
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(allowedTools && allowedTools.length > 0 ? { allowedTools } : {})
      },
      body: normalizeBody(parsed.body)
    }
  }
}

export function buildSkillMarkdown(document: SkillDocumentSpec): string {
  const frontmatter: Record<string, unknown> = {
    name: normalizeText(document.frontmatter.name),
    description: normalizeText(document.frontmatter.description)
  }

  if (document.frontmatter.license) {
    frontmatter.license = normalizeText(document.frontmatter.license)
  }
  if (document.frontmatter.compatibility) {
    frontmatter.compatibility = normalizeText(document.frontmatter.compatibility)
  }
  if (document.frontmatter.metadata && Object.keys(document.frontmatter.metadata).length > 0) {
    const nextMetadata: Record<string, string> = {}
    for (const key of Object.keys(document.frontmatter.metadata).sort((a, b) => a.localeCompare(b))) {
      nextMetadata[key] = document.frontmatter.metadata[key]
    }
    frontmatter.metadata = nextMetadata
  }
  if (document.frontmatter.allowedTools && document.frontmatter.allowedTools.length > 0) {
    frontmatter['allowed-tools'] = Array.from(new Set(document.frontmatter.allowedTools)).join(' ')
  }

  const frontmatterText = YAML.stringify(frontmatter).trimEnd()
  const body = normalizeBody(document.body)
  return body
    ? `---\n${frontmatterText}\n---\n\n${body}\n`
    : `---\n${frontmatterText}\n---\n`
}

function maybeMode(value: unknown): 'manual' | 'auto' | 'both' | undefined {
  return value === 'manual' || value === 'auto' || value === 'both' ? value : undefined
}

export function decodeMulbyExtensions(metadata: Record<string, string> | undefined): MulbySkillExtensions {
  if (!metadata) return {}
  const mode = maybeMode(metadata[MULBY_METADATA_KEYS.mode])
  const triggerPhrases = parseJsonArrayString(metadata[MULBY_METADATA_KEYS.triggerPhrases])
  const capabilities = parseJsonArrayString(metadata[MULBY_METADATA_KEYS.capabilities])
  const internalTools = parseJsonArrayString(metadata[MULBY_METADATA_KEYS.internalTools])
  const mcpPolicyRaw = parseJsonObject<Record<string, unknown>>(metadata[MULBY_METADATA_KEYS.mcpPolicy])

  const mcpPolicy: AiSkillMcpPolicy | undefined = mcpPolicyRaw
    ? {
        serverIds: normalizeStringArray(mcpPolicyRaw.serverIds),
        allowedToolIds: normalizeStringArray(mcpPolicyRaw.allowedToolIds),
        blockedToolIds: normalizeStringArray(mcpPolicyRaw.blockedToolIds)
      }
    : undefined

  return {
    ...(mode ? { mode } : {}),
    ...(triggerPhrases && triggerPhrases.length > 0 ? { triggerPhrases } : {}),
    ...(capabilities && capabilities.length > 0 ? { capabilities } : {}),
    ...(internalTools && internalTools.length > 0 ? { internalTools } : {}),
    ...(mcpPolicy ? { mcpPolicy } : {})
  }
}

export function encodeMulbyExtensions(input: {
  metadata?: Record<string, string>
  extensions?: MulbySkillExtensions
}): Record<string, string> | undefined {
  const metadata: Record<string, string> = { ...(input.metadata || {}) }
  const extensions = input.extensions || {}

  if (extensions.mode) {
    metadata[MULBY_METADATA_KEYS.mode] = extensions.mode
  } else {
    delete metadata[MULBY_METADATA_KEYS.mode]
  }

  const setJsonArray = (key: string, value: string[] | undefined) => {
    if (value && value.length > 0) {
      metadata[key] = JSON.stringify(Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean))))
      return
    }
    delete metadata[key]
  }

  setJsonArray(MULBY_METADATA_KEYS.triggerPhrases, extensions.triggerPhrases)
  setJsonArray(MULBY_METADATA_KEYS.capabilities, extensions.capabilities)
  setJsonArray(MULBY_METADATA_KEYS.internalTools, extensions.internalTools)

  if (extensions.mcpPolicy) {
    metadata[MULBY_METADATA_KEYS.mcpPolicy] = JSON.stringify({
      ...(extensions.mcpPolicy.serverIds && extensions.mcpPolicy.serverIds.length > 0
        ? { serverIds: Array.from(new Set(extensions.mcpPolicy.serverIds.map((item) => normalizeText(item)).filter(Boolean))) }
        : {}),
      ...(extensions.mcpPolicy.allowedToolIds && extensions.mcpPolicy.allowedToolIds.length > 0
        ? { allowedToolIds: Array.from(new Set(extensions.mcpPolicy.allowedToolIds.map((item) => normalizeText(item)).filter(Boolean))) }
        : {}),
      ...(extensions.mcpPolicy.blockedToolIds && extensions.mcpPolicy.blockedToolIds.length > 0
        ? { blockedToolIds: Array.from(new Set(extensions.mcpPolicy.blockedToolIds.map((item) => normalizeText(item)).filter(Boolean))) }
        : {})
    })
  } else {
    delete metadata[MULBY_METADATA_KEYS.mcpPolicy]
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}
