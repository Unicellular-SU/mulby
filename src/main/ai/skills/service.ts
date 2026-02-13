import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import extractZip from 'extract-zip'
import type {
  AiMcpSelection,
  AiMessage,
  AiOption,
  AiSettings,
  AiSkillDescriptor,
  AiSkillMulbyExtensions,
  AiSkillPreview,
  AiSkillRecord,
  AiSkillResolveResult,
  AiSkillSettings,
  AiSkillTrustLevel,
  AiToolContext
} from '../../../shared/types/ai'
import {
  mapInternalToolsToCapabilities,
  normalizeAiToolCapabilityNames
} from '../tools/capabilities'
import { getAiSettings, updateAiSettings } from '../config'
import type {
  AiSkillCreateFromGeneratedInput,
  AiSkillCreateInput,
  AiSkillGeneratedFile,
  AiSkillImportJsonInput,
  AiSkillInstallInput,
  AiSkillPreviewInput
} from './types'
import {
  buildSkillMarkdown as buildSpecSkillMarkdown,
  decodeMulbyExtensions,
  encodeMulbyExtensions,
  validateSkillMarkdown
} from './spec-validator'

const SKILL_MD_VARIANTS = ['SKILL.md']
const SKILL_APP_ROOT_NAME = 'app'

interface AiSkillServiceDeps {
  getSettings: () => AiSettings
  updateSettings: (partial: Partial<AiSettings>) => AiSettings
  now: () => number
  getUserDataPath: () => string
  getHomeDir: () => string
}

const DEFAULT_SKILL_SETTINGS: AiSkillSettings = {
  enabled: true,
  activeSkillIds: [],
  autoSelect: {
    enabled: false,
    maxSkillsPerCall: 3,
    minScore: 1
  },
  records: []
}

function asStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out = input.map((item) => String(item || '').trim()).filter(Boolean)
  return out.length > 0 ? out : undefined
}

function slugify(input: string): string {
  const normalized = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return normalized || 'skill'
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function normalizeMode(input: unknown): 'manual' | 'auto' | 'both' | undefined {
  if (input === 'manual' || input === 'auto' || input === 'both') return input
  return undefined
}

function normalizeTrustLevel(input: unknown): AiSkillTrustLevel {
  if (input === 'trusted' || input === 'reviewed' || input === 'untrusted') return input
  return 'reviewed'
}

function splitSkillMarkdown(content: string): { body: string } {
  const match = String(content || '').match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/)
  return {
    body: String(match?.[1] || '').trim()
  }
}

function extractSkillMarkdownBody(content: string): string | undefined {
  const text = String(content || '').trim()
  if (!text) return undefined
  const parsedBody = splitSkillMarkdown(text).body
  const body = String(parsedBody || text).trim()
  return body || undefined
}

function mergeMulbyExtensions(input: {
  fromMetadata?: AiSkillMulbyExtensions
  fromLegacy?: Partial<AiSkillMulbyExtensions>
}): AiSkillMulbyExtensions | undefined {
  const metadata = input.fromMetadata || {}
  const legacy = input.fromLegacy || {}
  const mode = normalizeMode(metadata.mode || legacy.mode)
  const triggerPhrases = asStringArray(metadata.triggerPhrases || legacy.triggerPhrases)
  const capabilities = normalizeAiToolCapabilityNames(asStringArray(metadata.capabilities || legacy.capabilities) || [])
  const internalTools = asStringArray(metadata.internalTools || legacy.internalTools)
  const rawPolicy = metadata.mcpPolicy || legacy.mcpPolicy
  const mcpPolicy = rawPolicy
    ? {
        serverIds: asStringArray(rawPolicy.serverIds),
        allowedToolIds: asStringArray(rawPolicy.allowedToolIds),
        blockedToolIds: asStringArray(rawPolicy.blockedToolIds)
      }
    : undefined

  const next: AiSkillMulbyExtensions = {
    ...(mode ? { mode } : {}),
    ...(triggerPhrases && triggerPhrases.length > 0 ? { triggerPhrases } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(internalTools && internalTools.length > 0 ? { internalTools } : {}),
    ...(mcpPolicy ? { mcpPolicy } : {})
  }

  return Object.keys(next).length > 0 ? next : undefined
}

function parseDescriptorFromMarkdown(input: {
  content: string
  skillDirPath?: string
  filePath?: string
  fallbackId?: string
  includeBody?: boolean
}): AiSkillDescriptor {
  const validation = validateSkillMarkdown(input.content, {
    skillDirPath: input.skillDirPath,
    filePath: input.filePath,
    requireCanonicalSkillFileName: true
  })
  if (!validation.ok || !validation.document) {
    throw new Error(`Invalid SKILL.md: ${validation.errors.join('; ')}`)
  }

  const frontmatter = validation.document.frontmatter
  const id = slugify(frontmatter.name || input.fallbackId || 'skill')
  const metadata = frontmatter.metadata
  const body = input.includeBody ? splitSkillMarkdown(input.content).body : ''
  const mulbyFromMetadata = decodeMulbyExtensions(metadata)
  const extensions = mergeMulbyExtensions({ fromMetadata: mulbyFromMetadata })

  return {
    id,
    name: frontmatter.name,
    description: frontmatter.description,
    license: frontmatter.license,
    compatibility: frontmatter.compatibility,
    metadata,
    allowedTools: frontmatter.allowedTools,
    promptTemplate: body || undefined,
    mulbyExtensions: extensions,
    mode: extensions?.mode,
    triggerPhrases: extensions?.triggerPhrases,
    capabilities: extensions?.capabilities,
    internalTools: extensions?.internalTools,
    mcpPolicy: extensions?.mcpPolicy
  }
}

function buildSkillMarkdown(descriptor: AiSkillDescriptor): string {
  const extensions = mergeMulbyExtensions({
    fromMetadata: descriptor.mulbyExtensions,
    fromLegacy: {
      mode: descriptor.mode,
      triggerPhrases: descriptor.triggerPhrases,
      capabilities: descriptor.capabilities,
      internalTools: descriptor.internalTools,
      mcpPolicy: descriptor.mcpPolicy
    }
  })
  const metadata = encodeMulbyExtensions({
    metadata: descriptor.metadata,
    extensions
  })
  return buildSpecSkillMarkdown({
    frontmatter: {
      name: descriptor.name,
      description: descriptor.description,
      license: descriptor.license,
      compatibility: descriptor.compatibility,
      metadata,
      allowedTools: descriptor.allowedTools
    },
    body: descriptor.promptTemplate || ''
  })
}

function collectPromptText(messages: AiMessage[] | undefined): string {
  if (!messages || messages.length === 0) return ''
  return messages
    .map((message) => {
      if (typeof message.content === 'string') return message.content
      if (Array.isArray(message.content)) {
        return message.content
          .filter((part) => part.type === 'text')
          .map((part) => ('text' in part ? part.text : ''))
          .join(' ')
      }
      return ''
    })
    .join('\n')
    .toLowerCase()
}

function buildAvailableSkillsPrompt(records: AiSkillRecord[]): string | undefined {
  if (!records || records.length === 0) return undefined
  const lines: string[] = ['<available_skills>']
  for (const record of records) {
    const name = String(record.descriptor.name || '').trim()
    const description = String(record.descriptor.description || '').trim()
    if (!name || !description) continue
    lines.push('  <skill>')
    lines.push(`    <name>${name}</name>`)
    lines.push(`    <description>${description}</description>`)
    if (record.skillMdPath) {
      lines.push(`    <location>${record.skillMdPath}</location>`)
    }
    lines.push('  </skill>')
  }
  lines.push('</available_skills>')
  return lines.length > 2 ? lines.join('\n') : undefined
}

function extractScriptRefsFromPrompt(promptTemplate: string | undefined): string[] {
  const text = String(promptTemplate || '')
  if (!text) return []
  const matches = text.match(/\bscripts\/[A-Za-z0-9._/-]+\b/g) || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of matches) {
    const normalized = normalizeSkillFilePath(raw)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function buildSkillRuntimeHint(record: AiSkillRecord): string | undefined {
  const installPath = String(record.installPath || '').trim()
  if (!installPath) return undefined
  const quotedInstallPath = JSON.stringify(installPath)
  const scriptRefs = extractScriptRefsFromPrompt(loadSkillPromptTemplate(record))
  const absoluteScriptRefs = scriptRefs.map((ref) => JSON.stringify(path.join(installPath, ref)))
  const lines = [
    `Skill runtime hint (${record.id}):`,
    `- Skill root path: ${quotedInstallPath}`,
    '- Reuse existing scripts from this skill before writing ad-hoc inline scripts.',
    '- mulby_run_command arguments must be a JSON object, never a quoted JSON string.'
  ]
  if (absoluteScriptRefs.length > 0) {
    lines.push(`- Preferred existing scripts: ${absoluteScriptRefs.join(', ')}`)
  }
  return lines.join('\n')
}

function pathInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

function normalizeSkillFilePath(input: string): string {
  return String(input || '').replace(/\\/g, '/').trim()
}

function isSafeSkillRelativePath(input: string): boolean {
  const normalized = normalizeSkillFilePath(input)
  if (!normalized) return false
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false
  if (normalized.includes('..')) return false
  return /^((scripts|references|assets)\/)[^?*:|"<>]+$/.test(normalized)
}

function normalizeMetadataMap(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = String(rawKey || '').trim()
    if (!key) continue
    const value = String(rawValue ?? '')
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeAllowedTools(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out = input.map((item) => String(item || '').trim()).filter(Boolean)
  return out.length > 0 ? Array.from(new Set(out)) : undefined
}

function buildDescriptorFromInput(input: {
  id: string
  name: string
  description?: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
  metadataMulby?: AiSkillMulbyExtensions
  promptTemplate?: string
  mode?: 'manual' | 'auto' | 'both'
  triggerPhrases?: string[]
  capabilities?: string[]
  internalTools?: string[]
  mcpPolicy?: AiSkillDescriptor['mcpPolicy']
}): AiSkillDescriptor {
  const name = String(input.name || '').trim()
  if (!name) {
    throw new Error('Skill name is required')
  }
  const canonicalId = slugify(name)
  const requestedId = slugify(input.id || name)
  if (requestedId !== canonicalId) {
    throw new Error(`Skill id must match name in kebab-case (${requestedId} !== ${canonicalId})`)
  }
  const description = String(input.description || '').trim()
  if (!description) {
    throw new Error('Skill description is required')
  }

  const normalizedMetadata = normalizeMetadataMap(input.metadata)
  const extensions = mergeMulbyExtensions({
    fromMetadata: input.metadataMulby,
    fromLegacy: {
      mode: input.mode,
      triggerPhrases: input.triggerPhrases,
      capabilities: input.capabilities,
      internalTools: input.internalTools,
      mcpPolicy: input.mcpPolicy
    }
  })
  const metadata = encodeMulbyExtensions({
    metadata: normalizedMetadata,
    extensions
  })
  const capabilities = normalizeAiToolCapabilityNames(extensions?.capabilities || [])

  return {
    id: canonicalId,
    name,
    description,
    license: String(input.license || '').trim() || undefined,
    compatibility: String(input.compatibility || '').trim() || undefined,
    metadata,
    allowedTools: normalizeAllowedTools(input.allowedTools),
    promptTemplate: String(input.promptTemplate || '').trim() || undefined,
    mulbyExtensions: extensions,
    mode: extensions?.mode,
    triggerPhrases: extensions?.triggerPhrases,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
    internalTools: extensions?.internalTools,
    mcpPolicy: extensions?.mcpPolicy
  }
}

function loadSkillPromptTemplate(record: AiSkillRecord): string | undefined {
  const existing = String(record.descriptor.promptTemplate || '').trim()
  if (existing) return existing
  const skillMdPath = String(record.skillMdPath || '').trim()
  if (!skillMdPath) return undefined
  try {
    const content = readFileSync(skillMdPath, 'utf8')
    const validation = validateSkillMarkdown(content, {
      skillDirPath: record.installPath,
      filePath: skillMdPath,
      requireCanonicalSkillFileName: true
    })
    if (!validation.ok) return undefined
    const body = splitSkillMarkdown(content).body
    return body || undefined
  } catch {
    return undefined
  }
}

function assertValidSkillMarkdown(input: {
  markdown: string
  skillDirPath?: string
  filePath?: string
}): void {
  const validation = validateSkillMarkdown(input.markdown, {
    skillDirPath: input.skillDirPath,
    filePath: input.filePath,
    requireCanonicalSkillFileName: true
  })
  if (!validation.ok) {
    throw new Error(`Invalid SKILL.md: ${validation.errors.join('; ')}`)
  }
}

async function findSkillMarkdownPath(dirPath: string): Promise<string | null> {
  for (const variant of SKILL_MD_VARIANTS) {
    const candidate = path.join(dirPath, variant)
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // ignore
    }
  }
  return null
}

async function findSkillDirectories(baseDir: string, maxDepth = 6): Promise<string[]> {
  const result: string[] = []

  const walk = async (currentDir: string, depth: number) => {
    if (depth > maxDepth) return

    const skillMdPath = await findSkillMarkdownPath(currentDir)
    if (skillMdPath) {
      result.push(currentDir)
      return
    }

    let entries: Array<import('node:fs').Dirent> = []
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      await walk(path.join(currentDir, entry.name), depth + 1)
    }
  }

  await walk(baseDir, 0)
  return result
}

function intersectOrAdopt(current: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  if (!incoming || incoming.length === 0) return current
  if (!current || current.length === 0) return [...incoming]
  const include = new Set(incoming)
  const out = current.filter((item) => include.has(item))
  return out.length > 0 ? out : []
}

function mergeMcpSelections(base: AiMcpSelection | undefined, patch: AiMcpSelection | undefined): AiMcpSelection | undefined {
  if (!base && !patch) return undefined

  const mode = patch?.mode || base?.mode
  const serverIds = intersectOrAdopt(base?.serverIds, patch?.serverIds)
  const allowedToolIds = intersectOrAdopt(base?.allowedToolIds, patch?.allowedToolIds)

  return {
    mode,
    serverIds,
    allowedToolIds
  }
}

function mergeToolContext(base: AiToolContext | undefined, patch: AiToolContext['mcpScope'] | undefined): AiToolContext | undefined {
  if (!base && !patch) return undefined
  const next: AiToolContext = {
    ...(base || {})
  }
  const baseScope = base?.mcpScope
  if (patch) {
    next.mcpScope = {
      allowedServerIds: intersectOrAdopt(baseScope?.allowedServerIds, patch.allowedServerIds),
      allowedToolIds: intersectOrAdopt(baseScope?.allowedToolIds, patch.allowedToolIds)
    }
  }
  return next
}

export class AiSkillService {
  private deps: AiSkillServiceDeps
  private catalogLoaded = false
  private catalogPromise: Promise<AiSkillRecord[]> | null = null

  constructor(deps?: Partial<AiSkillServiceDeps>) {
    this.deps = {
      getSettings: deps?.getSettings || getAiSettings,
      updateSettings: deps?.updateSettings || updateAiSettings,
      now: deps?.now || (() => Date.now()),
      getUserDataPath: deps?.getUserDataPath || (() => app.getPath('userData')),
      getHomeDir: deps?.getHomeDir || (() => os.homedir())
    }
  }

  private getSkillSettings(): AiSkillSettings {
    const current = this.deps.getSettings().skills
    return {
      ...DEFAULT_SKILL_SETTINGS,
      ...current,
      autoSelect: {
        ...DEFAULT_SKILL_SETTINGS.autoSelect,
        ...(current?.autoSelect || {})
      },
      records: current?.records || []
    }
  }

  private persistSkillSettings(next: AiSkillSettings): AiSkillSettings {
    const updated = this.deps.updateSettings({
      skills: next
    })
    const settings = updated.skills
    return settings
      ? {
          ...DEFAULT_SKILL_SETTINGS,
          ...settings,
          autoSelect: {
            ...DEFAULT_SKILL_SETTINGS.autoSelect,
            ...(settings.autoSelect || {})
          },
          records: settings.records || []
        }
      : this.getSkillSettings()
  }

  private getSkillsRootPath(): string {
    return path.join(this.deps.getUserDataPath(), 'ai', 'skills', SKILL_APP_ROOT_NAME)
  }

  private getLegacySkillsRootPath(): string {
    return path.join(this.deps.getUserDataPath(), 'ai', 'skills')
  }

  private getSystemSkillsRootPath(): string {
    return path.join(this.deps.getHomeDir(), '.agents', 'skills')
  }

  private getWritableSkillsRootPath(): string {
    return this.getSkillsRootPath()
  }

  private async ensureSkillsRootPath(): Promise<string> {
    const root = this.getWritableSkillsRootPath()
    await fs.mkdir(root, { recursive: true })
    return root
  }

  private cloneRecordWithState(record: AiSkillRecord, previous?: AiSkillRecord): AiSkillRecord {
    const enabled = previous?.enabled ?? record.enabled ?? false
    const trustLevel = previous?.trustLevel ?? record.trustLevel ?? 'reviewed'
    return {
      ...record,
      source: record.origin === 'app' && previous?.source && previous.source !== 'system' ? previous.source : record.source,
      enabled,
      trustLevel
    }
  }

  private async scanSkillDirectory(input: {
    dirPath: string
    source: AiSkillRecord['source']
    origin: NonNullable<AiSkillRecord['origin']>
    readonly: boolean
    previous?: AiSkillRecord
  }): Promise<AiSkillRecord | null> {
    const skillMdPath = await findSkillMarkdownPath(input.dirPath)
    if (!skillMdPath) return null
    const content = await fs.readFile(skillMdPath, 'utf8')
    let descriptor: AiSkillDescriptor
    try {
      descriptor = parseDescriptorFromMarkdown({
        content,
        skillDirPath: input.dirPath,
        filePath: skillMdPath,
        fallbackId: path.basename(input.dirPath),
        includeBody: false
      })
    } catch (error) {
      console.warn('[AI][Skills] skip invalid skill during catalog refresh', {
        dirPath: input.dirPath,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
    const stats = await fs.stat(skillMdPath)
    const installedAt = input.previous?.installedAt ?? (stats.birthtimeMs || stats.mtimeMs || this.deps.now())
    const updatedAt = Math.max(stats.mtimeMs || 0, input.previous?.updatedAt || 0, this.deps.now())
    const base: AiSkillRecord = {
      id: descriptor.id,
      source: input.source,
      origin: input.origin,
      readonly: input.readonly,
      sourceRef: input.dirPath,
      installPath: input.dirPath,
      skillMdPath,
      contentHash: sha256(content),
      enabled: input.previous?.enabled ?? false,
      trustLevel: input.previous?.trustLevel ?? (input.origin === 'system' ? 'reviewed' : 'trusted'),
      installedAt,
      updatedAt,
      descriptor
    }
    return this.cloneRecordWithState(base, input.previous)
  }

  private mergeCatalogWithState(scanned: AiSkillRecord[], existing: AiSkillRecord[]): AiSkillRecord[] {
    const existingMap = new Map(existing.map((item) => [item.id, item] as const))
    const mergedMap = new Map<string, AiSkillRecord>()
    // System first, app second (app override)
    for (const record of scanned.filter((item) => item.origin === 'system')) {
      mergedMap.set(record.id, this.cloneRecordWithState(record, existingMap.get(record.id)))
    }
    for (const record of scanned.filter((item) => item.origin !== 'system')) {
      mergedMap.set(record.id, this.cloneRecordWithState(record, existingMap.get(record.id)))
    }
    return Array.from(mergedMap.values()).sort((a, b) => (b.updatedAt || b.installedAt || 0) - (a.updatedAt || a.installedAt || 0))
  }

  async refreshCatalog(): Promise<AiSkillRecord[]> {
    const settings = this.getSkillSettings()
    const existingById = new Map(settings.records.map((item) => [item.id, item] as const))
    const scanned: AiSkillRecord[] = []

    const systemRoot = this.getSystemSkillsRootPath()
    const systemSkillDirs = await findSkillDirectories(systemRoot, 8)
    for (const dir of systemSkillDirs) {
      const record = await this.scanSkillDirectory({
        dirPath: dir,
        source: 'system',
        origin: 'system',
        readonly: true,
        previous: undefined
      })
      if (record) {
        const previous = existingById.get(record.id)
        scanned.push(this.cloneRecordWithState(record, previous))
      }
    }

    const appRoot = this.getWritableSkillsRootPath()
    const legacyRoot = this.getLegacySkillsRootPath()
    const appSkillDirs = await findSkillDirectories(appRoot, 8)
    for (const dir of appSkillDirs) {
      const record = await this.scanSkillDirectory({
        dirPath: dir,
        source: 'manual',
        origin: 'app',
        readonly: false,
        previous: undefined
      })
      if (record) {
        scanned.push(this.cloneRecordWithState(record, existingById.get(record.id)))
      }
    }

    const legacyExists = await fs.stat(legacyRoot).then((s) => s.isDirectory()).catch(() => false)
    if (legacyExists) {
      const legacySkillDirs = await findSkillDirectories(legacyRoot, 8)
      for (const dir of legacySkillDirs) {
        if (pathInside(appRoot, dir)) continue
        const record = await this.scanSkillDirectory({
          dirPath: dir,
          source: 'manual',
          origin: 'app',
          readonly: false,
          previous: undefined
        })
        if (record) {
          scanned.push(this.cloneRecordWithState(record, existingById.get(record.id)))
        }
      }
    }

    const nextRecords = this.mergeCatalogWithState(scanned, settings.records)
    const activeSkillIds = settings.activeSkillIds.filter((id) => nextRecords.some((item) => item.id === id && item.enabled))

    this.persistSkillSettings({
      ...settings,
      records: nextRecords,
      activeSkillIds
    })
    this.catalogLoaded = true
    return nextRecords
  }

  async ensureCatalogLoaded(): Promise<void> {
    if (this.catalogLoaded) return
    if (this.catalogPromise) {
      await this.catalogPromise
      return
    }
    this.catalogPromise = this.refreshCatalog()
    try {
      await this.catalogPromise
    } finally {
      this.catalogPromise = null
    }
  }

  list(): AiSkillRecord[] {
    return [...this.getSkillSettings().records]
  }

  listEnabled(): AiSkillRecord[] {
    return this.list().filter((record) => record.enabled && record.trustLevel !== 'untrusted')
  }

  get(skillId: string): AiSkillRecord | null {
    const id = String(skillId || '').trim()
    if (!id) return null
    return this.list().find((record) => record.id === id) || null
  }

  async create(input: AiSkillCreateInput): Promise<AiSkillRecord> {
    const name = String(input.name || '').trim()
    if (!name) {
      throw new Error('Skill name is required')
    }

    const settings = this.getSkillSettings()
    const existingIds = new Set(settings.records.map((item) => item.id))
    const id = slugify(input.id || name)
    if (existingIds.has(id)) {
      throw new Error(`Skill already exists: ${id}`)
    }
    const now = this.deps.now()

    const descriptor = buildDescriptorFromInput({
      id,
      name,
      description: input.description,
      license: input.license,
      compatibility: input.compatibility,
      metadata: input.metadata,
      allowedTools: input.allowedTools,
      metadataMulby: input.metadataMulby,
      promptTemplate: input.promptTemplate,
      mode: input.mode,
      triggerPhrases: input.triggerPhrases,
      capabilities: input.capabilities,
      internalTools: input.internalTools,
      mcpPolicy: input.mcpPolicy
    })
    const markdown = buildSkillMarkdown(descriptor)
    const root = await this.ensureSkillsRootPath()
    const installPath = path.join(root, id)
    const skillMdPath = path.join(installPath, 'SKILL.md')
    assertValidSkillMarkdown({
      markdown,
      skillDirPath: installPath,
      filePath: skillMdPath
    })
    await fs.mkdir(installPath, { recursive: true })
    await fs.writeFile(skillMdPath, markdown, 'utf8')
    const hash = sha256(markdown)

    const record: AiSkillRecord = {
      id,
      source: 'manual',
      origin: 'app',
      readonly: false,
      sourceRef: undefined,
      installPath,
      skillMdPath,
      contentHash: hash,
      enabled: input.enabled ?? true,
      trustLevel: input.trustLevel ? normalizeTrustLevel(input.trustLevel) : 'trusted',
      installedAt: now,
      updatedAt: now,
      descriptor
    }

    const next = {
      ...settings,
      records: [record, ...settings.records],
      activeSkillIds: record.enabled
        ? Array.from(new Set([record.id, ...settings.activeSkillIds]))
        : settings.activeSkillIds
    }
    this.persistSkillSettings(next)
    this.catalogLoaded = true
    return record
  }

  private async writeGeneratedFiles(installPath: string, files: AiSkillGeneratedFile[] | undefined): Promise<void> {
    if (!Array.isArray(files) || files.length === 0) return
    for (const file of files) {
      if (!file || typeof file !== 'object') continue
      const relativePath = normalizeSkillFilePath(file.path)
      if (!isSafeSkillRelativePath(relativePath)) {
        throw new Error(`Unsafe generated file path: ${file.path}`)
      }
      const targetPath = path.join(installPath, relativePath)
      if (!pathInside(installPath, targetPath)) {
        throw new Error(`Generated file path out of skill root: ${file.path}`)
      }
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, String(file.content || ''), 'utf8')
    }
  }

  async createFromGenerated(input: AiSkillCreateFromGeneratedInput): Promise<AiSkillRecord> {
    const name = String(input.name || '').trim()
    if (!name) {
      throw new Error('Skill name is required')
    }
    const settings = this.getSkillSettings()
    const replaceSkillId = String(input.replaceSkillId || '').trim()
    const replaceTarget = replaceSkillId ? settings.records.find((item) => item.id === replaceSkillId) : undefined
    if (replaceSkillId && replaceTarget && (replaceTarget.origin === 'system' || replaceTarget.readonly)) {
      throw new Error('System skill is read-only and cannot be replaced')
    }
    const existingIds = new Set(settings.records.map((item) => item.id))
    if (replaceTarget) {
      existingIds.delete(replaceTarget.id)
    }
    const expectedId = slugify(input.id || name)
    const id = replaceTarget
      ? replaceTarget.id
      : expectedId
    if (replaceTarget && replaceTarget.id !== expectedId) {
      throw new Error(`Replacing skill requires same name/id (${replaceTarget.id} !== ${expectedId})`)
    }
    if (!replaceTarget && existingIds.has(id)) {
      throw new Error(`Skill already exists: ${id}`)
    }
    const now = this.deps.now()
    const descriptor = buildDescriptorFromInput({
      id,
      name,
      description: input.description,
      license: input.license,
      compatibility: input.compatibility,
      metadata: input.metadata,
      allowedTools: input.allowedTools,
      metadataMulby: input.metadataMulby,
      promptTemplate: input.promptTemplate,
      mode: input.mode,
      triggerPhrases: input.triggerPhrases,
      capabilities: input.capabilities,
      internalTools: input.internalTools,
      mcpPolicy: input.mcpPolicy
    })
    const generatedPromptTemplate = extractSkillMarkdownBody(String(input.skillMarkdown || ''))
    const finalDescriptor: AiSkillDescriptor = {
      ...descriptor,
      promptTemplate: generatedPromptTemplate || descriptor.promptTemplate
    }
    const finalMarkdown = buildSkillMarkdown(finalDescriptor)

    const root = await this.ensureSkillsRootPath()
    const installPath = path.join(root, id)
    const skillMdPath = path.join(installPath, 'SKILL.md')
    assertValidSkillMarkdown({
      markdown: finalMarkdown,
      skillDirPath: installPath,
      filePath: skillMdPath
    })
    await fs.rm(installPath, { recursive: true, force: true })
    await fs.mkdir(installPath, { recursive: true })
    await fs.writeFile(skillMdPath, finalMarkdown, 'utf8')
    await this.writeGeneratedFiles(installPath, input.files)

    const record: AiSkillRecord = {
      id,
      source: input.source || replaceTarget?.source || 'manual',
      origin: 'app',
      readonly: false,
      sourceRef: replaceTarget?.sourceRef,
      installPath,
      skillMdPath,
      contentHash: sha256(finalMarkdown),
      enabled: input.enabled ?? replaceTarget?.enabled ?? false,
      trustLevel: input.trustLevel ? normalizeTrustLevel(input.trustLevel) : (replaceTarget?.trustLevel || 'reviewed'),
      installedAt: replaceTarget?.installedAt || now,
      updatedAt: now,
      descriptor: finalDescriptor
    }

    const next = {
      ...settings,
      records: [record, ...settings.records.filter((item) => item.id !== id)],
      activeSkillIds: record.enabled
        ? Array.from(new Set([record.id, ...settings.activeSkillIds]))
        : settings.activeSkillIds.filter((item) => item !== record.id)
    }
    this.persistSkillSettings(next)
    this.catalogLoaded = true
    return record
  }

  private normalizeDescriptorFromUnknown(raw: unknown, fallbackName = 'skill'): AiSkillDescriptor {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Invalid skill descriptor')
    }
    const obj = raw as Record<string, unknown>
    const id = slugify(String(obj.id || obj.name || fallbackName))
    const name = String(obj.name || id).trim() || id
    const description = String(obj.description || '').trim()
    if (!description) {
      throw new Error('Invalid skill descriptor: description is required')
    }

    const metadata = normalizeMetadataMap(obj.metadata)
    const metadataMulby = obj.metadataMulby && typeof obj.metadataMulby === 'object' && !Array.isArray(obj.metadataMulby)
      ? (obj.metadataMulby as AiSkillMulbyExtensions)
      : undefined

    return buildDescriptorFromInput({
      id,
      name,
      description,
      license: String(obj.license || '').trim() || undefined,
      compatibility: String(obj.compatibility || '').trim() || undefined,
      metadata,
      allowedTools: asStringArray(obj.allowedTools ?? obj['allowed-tools']),
      metadataMulby,
      promptTemplate: String((obj.promptTemplate ?? obj.prompt_template) || '').trim() || undefined,
      mode: normalizeMode(obj.mode),
      triggerPhrases: asStringArray(obj.triggerPhrases ?? obj.trigger_phrases),
      capabilities: asStringArray(obj.capabilities ?? obj.capabilityDeps ?? obj.capability_deps),
      internalTools: asStringArray(obj.internalTools ?? obj.internal_tools),
      mcpPolicy:
        obj.mcpPolicy && typeof obj.mcpPolicy === 'object' && !Array.isArray(obj.mcpPolicy)
          ? {
              serverIds: asStringArray((obj.mcpPolicy as Record<string, unknown>).serverIds),
              allowedToolIds: asStringArray((obj.mcpPolicy as Record<string, unknown>).allowedToolIds),
              blockedToolIds: asStringArray((obj.mcpPolicy as Record<string, unknown>).blockedToolIds)
            }
          : undefined
    })
  }

  async importFromJson(input: AiSkillImportJsonInput): Promise<AiSkillRecord[]> {
    const text = String(input.json || '').trim()
    if (!text) {
      throw new Error('JSON payload is required')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('Invalid JSON')
    }

    const candidates: unknown[] = []
    if (Array.isArray(parsed)) {
      candidates.push(...parsed)
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (Array.isArray(obj.skills)) {
        candidates.push(...obj.skills)
      } else if (obj.skill && typeof obj.skill === 'object') {
        candidates.push(obj.skill)
      } else {
        candidates.push(obj)
      }
    }

    if (candidates.length === 0) {
      throw new Error('No skills found in JSON')
    }

    const settings = this.getSkillSettings()
    const existingIds = new Set(settings.records.map((item) => item.id))
    const root = await this.ensureSkillsRootPath()
    const now = this.deps.now()
    const imported: AiSkillRecord[] = []

    for (let index = 0; index < candidates.length; index += 1) {
      const descriptor = this.normalizeDescriptorFromUnknown(candidates[index], `skill-${index + 1}`)
      const id = slugify(descriptor.id || descriptor.name)
      if (existingIds.has(id)) {
        throw new Error(`Duplicate skill id/name in import payload: ${id}`)
      }
      existingIds.add(id)
      const nextDescriptor = { ...descriptor, id }
      const markdown = buildSkillMarkdown(nextDescriptor)
      const installPath = path.join(root, id)
      const skillMdPath = path.join(installPath, 'SKILL.md')
      assertValidSkillMarkdown({
        markdown,
        skillDirPath: installPath,
        filePath: skillMdPath
      })
      await fs.mkdir(installPath, { recursive: true })
      await fs.writeFile(skillMdPath, markdown, 'utf8')

      imported.push({
        id,
        source: 'json',
        origin: 'app',
        readonly: false,
        sourceRef: undefined,
        installPath,
        skillMdPath,
        contentHash: sha256(markdown),
        enabled: input.enabled ?? false,
        trustLevel: input.trustLevel ? normalizeTrustLevel(input.trustLevel) : 'reviewed',
        installedAt: now,
        updatedAt: now,
        descriptor: nextDescriptor
      })
    }

    const nextActive = new Set(settings.activeSkillIds)
    for (const record of imported) {
      if (record.enabled) nextActive.add(record.id)
    }

    this.persistSkillSettings({
      ...settings,
      records: [...imported, ...settings.records],
      activeSkillIds: Array.from(nextActive)
    })
    this.catalogLoaded = true

    return imported
  }

  private async installFromSkillDirectory(
    sourceDir: string,
    sourceType: 'local-dir' | 'zip',
    trustLevel: AiSkillTrustLevel,
    enabled: boolean,
    existingIds: Set<string>
  ): Promise<AiSkillRecord> {
    const skillMdPath = await findSkillMarkdownPath(sourceDir)
    if (!skillMdPath) {
      throw new Error(`SKILL.md not found: ${sourceDir}`)
    }
    const content = await fs.readFile(skillMdPath, 'utf8')
    const parsed = parseDescriptorFromMarkdown({
      content,
      skillDirPath: sourceDir,
      filePath: skillMdPath,
      fallbackId: path.basename(sourceDir),
      includeBody: false
    })
    const id = slugify(parsed.id || parsed.name)
    if (existingIds.has(id)) {
      throw new Error(`Skill already exists: ${id}`)
    }
    existingIds.add(id)
    const descriptor: AiSkillDescriptor = {
      ...parsed,
      id
    }

    const root = await this.ensureSkillsRootPath()
    const installPath = path.join(root, id)
    await fs.rm(installPath, { recursive: true, force: true })
    await fs.mkdir(path.dirname(installPath), { recursive: true })
    await fs.cp(sourceDir, installPath, { recursive: true, force: true })

    const canonicalSkillMdPath = await findSkillMarkdownPath(installPath)
    if (!canonicalSkillMdPath) {
      const markdown = buildSkillMarkdown(descriptor)
      await fs.writeFile(path.join(installPath, 'SKILL.md'), markdown, 'utf8')
    }

    const finalSkillMdPath = await findSkillMarkdownPath(installPath)
    const finalContent = finalSkillMdPath ? await fs.readFile(finalSkillMdPath, 'utf8') : buildSkillMarkdown(descriptor)
    const now = this.deps.now()

    return {
      id,
      source: sourceType,
      origin: 'app',
      readonly: false,
      sourceRef: sourceDir,
      installPath,
      skillMdPath: finalSkillMdPath || path.join(installPath, 'SKILL.md'),
      contentHash: sha256(finalContent),
      enabled,
      trustLevel,
      installedAt: now,
      updatedAt: now,
      descriptor
    }
  }

  async install(input: AiSkillInstallInput): Promise<AiSkillRecord[]> {
    const sourceType = input.source
    const sourceRef = String(input.ref || '').trim()
    if (!sourceRef) {
      throw new Error('Install ref is required')
    }

    const settings = this.getSkillSettings()
    const existingIds = new Set(settings.records.map((item) => item.id))
    const trustLevel = input.trustLevel ? normalizeTrustLevel(input.trustLevel) : 'reviewed'
    const enabled = input.enabled ?? false
    const installed: AiSkillRecord[] = []

    const installFromDirs = async (dirs: string[], kind: 'local-dir' | 'zip') => {
      for (const dir of dirs) {
        const record = await this.installFromSkillDirectory(dir, kind, trustLevel, enabled, existingIds)
        installed.push(record)
      }
    }

    if (sourceType === 'local-dir') {
      const dirStat = await fs.stat(sourceRef).catch(() => null)
      if (!dirStat || !dirStat.isDirectory()) {
        throw new Error('Local directory not found')
      }
      const skillDirs = await findSkillDirectories(sourceRef, 8)
      if (skillDirs.length === 0) {
        throw new Error('No SKILL.md found in directory')
      }
      await installFromDirs(skillDirs, 'local-dir')
    } else {
      const zipStat = await fs.stat(sourceRef).catch(() => null)
      if (!zipStat || !zipStat.isFile()) {
        throw new Error('ZIP file not found')
      }
      const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'mulby-skill-install-'))
      try {
        await extractZip(sourceRef, { dir: tempBase })
        const skillDirs = await findSkillDirectories(tempBase, 10)
        if (skillDirs.length === 0) {
          throw new Error('No SKILL.md found in ZIP')
        }
        await installFromDirs(skillDirs, 'zip')
      } finally {
        await fs.rm(tempBase, { recursive: true, force: true })
      }
    }

    const nextActive = new Set(settings.activeSkillIds)
    for (const record of installed) {
      if (record.enabled) nextActive.add(record.id)
    }

    this.persistSkillSettings({
      ...settings,
      records: [...installed, ...settings.records],
      activeSkillIds: Array.from(nextActive)
    })
    this.catalogLoaded = true

    return installed
  }

  async update(skillId: string, patch: Partial<AiSkillRecord>): Promise<AiSkillRecord> {
    const id = String(skillId || '').trim()
    if (!id) throw new Error('Skill id is required')
    const settings = this.getSkillSettings()
    const index = settings.records.findIndex((item) => item.id === id)
    if (index < 0) throw new Error(`Skill not found: ${id}`)

    const current = settings.records[index]
    const isReadonly = current.readonly || current.origin === 'system'
    if (isReadonly) {
      const patchKeys = Object.keys(patch)
      const allowedKeys = new Set(['enabled', 'trustLevel', 'updatedAt'])
      if (patchKeys.some((key) => !allowedKeys.has(key))) {
        throw new Error(`Skill is read-only: ${current.id}`)
      }
    }
    const nextDescriptor = patch.descriptor
      ? {
          ...current.descriptor,
          ...patch.descriptor,
          id: current.descriptor.id
        }
      : current.descriptor

    const nextRecord: AiSkillRecord = {
      ...current,
      ...patch,
      id: current.id,
      descriptor: nextDescriptor,
      updatedAt: this.deps.now()
    }

    if (!isReadonly && nextRecord.installPath) {
      await fs.mkdir(nextRecord.installPath, { recursive: true })
      if (!String(nextRecord.descriptor.promptTemplate || '').trim()) {
        const existingPrompt = loadSkillPromptTemplate(nextRecord)
        if (existingPrompt) {
          nextRecord.descriptor = {
            ...nextRecord.descriptor,
            promptTemplate: existingPrompt
          }
        }
      }
      const markdown = buildSkillMarkdown(nextRecord.descriptor)
      const filePath = nextRecord.skillMdPath || path.join(nextRecord.installPath, 'SKILL.md')
      assertValidSkillMarkdown({
        markdown,
        skillDirPath: nextRecord.installPath,
        filePath
      })
      await fs.writeFile(filePath, markdown, 'utf8')
      nextRecord.skillMdPath = filePath
      nextRecord.contentHash = sha256(markdown)
    }

    const records = [...settings.records]
    records[index] = nextRecord
    const activeIds = new Set(settings.activeSkillIds)
    if (nextRecord.enabled) {
      activeIds.add(nextRecord.id)
    } else {
      activeIds.delete(nextRecord.id)
    }

    this.persistSkillSettings({
      ...settings,
      records,
      activeSkillIds: Array.from(activeIds)
    })
    this.catalogLoaded = true

    return nextRecord
  }

  async remove(skillId: string): Promise<void> {
    const id = String(skillId || '').trim()
    if (!id) return
    const settings = this.getSkillSettings()
    const record = settings.records.find((item) => item.id === id)
    if (!record) return
    if (record.readonly || record.origin === 'system') {
      throw new Error(`Skill is read-only: ${record.id}`)
    }

    if (record.installPath) {
      const writableRoot = this.getWritableSkillsRootPath()
      const legacyRoot = this.getLegacySkillsRootPath()
      if (pathInside(writableRoot, record.installPath) || pathInside(legacyRoot, record.installPath)) {
        await fs.rm(record.installPath, { recursive: true, force: true })
      }
    }

    this.persistSkillSettings({
      ...settings,
      records: settings.records.filter((item) => item.id !== id),
      activeSkillIds: settings.activeSkillIds.filter((item) => item !== id)
    })
    this.catalogLoaded = true
  }

  async enable(skillId: string): Promise<AiSkillRecord> {
    return await this.update(skillId, { enabled: true })
  }

  async disable(skillId: string): Promise<AiSkillRecord> {
    return await this.update(skillId, { enabled: false })
  }

  private modeAllowed(record: AiSkillRecord, requestedMode: 'manual' | 'auto'): boolean {
    const descriptorMode = record.descriptor.mulbyExtensions?.mode || record.descriptor.mode
    if (!descriptorMode || descriptorMode === 'both') return true
    return descriptorMode === requestedMode
  }

  private scoreAutoSkill(record: AiSkillRecord, promptText: string): number {
    const text = promptText.toLowerCase()
    let score = 0
    const name = record.descriptor.name.toLowerCase()
    if (name && text.includes(name)) score += 2
    const triggers = record.descriptor.mulbyExtensions?.triggerPhrases || record.descriptor.triggerPhrases || []
    for (const trigger of triggers) {
      if (text.includes(trigger.toLowerCase())) score += 3
    }
    const description = String(record.descriptor.description || '').toLowerCase()
    if (description) {
      const keywords = Array.from(
        new Set(
          description
            .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
            .map((item) => item.trim())
            .filter((item) => item.length >= 3)
        )
      ).slice(0, 10)
      for (const keyword of keywords) {
        if (text.includes(keyword)) score += 1
      }
    }
    return score
  }

  resolveForAiCall(option: AiOption): AiSkillResolveResult {
    const settings = this.getSkillSettings()
    if (!settings.enabled) {
      return { selectedSkillIds: [], selectedSkillNames: [], systemPrompts: [], reasons: ['skills disabled'] }
    }
    const availableCandidates = settings.records.filter((record) => record.enabled && record.trustLevel !== 'untrusted')
    const availableSkillsPrompt = buildAvailableSkillsPrompt(availableCandidates)

    const requestedMode = option.skills?.mode
    const mode: 'off' | 'manual' | 'auto' =
      requestedMode ||
      (settings.autoSelect?.enabled ? 'auto' : settings.activeSkillIds.length > 0 ? 'manual' : 'off')
    if (mode === 'off') {
      return {
        selectedSkillIds: [],
        selectedSkillNames: [],
        systemPrompts: [],
        reasons: ['mode off']
      }
    }

    const candidates = availableCandidates
    const reasons: string[] = []
    let selected: AiSkillRecord[] = []

    if (mode === 'manual') {
      const requestedIds = option.skills?.skillIds && option.skills.skillIds.length > 0
        ? option.skills.skillIds
        : settings.activeSkillIds
      const include = new Set(requestedIds)
      selected = candidates.filter((record) => include.has(record.id) && this.modeAllowed(record, 'manual'))
      reasons.push(`manual:${selected.length}`)
    } else {
      const promptText = collectPromptText(option.messages)
      const minScore = Math.max(Math.floor(settings.autoSelect?.minScore || 1), 1)
      const maxSkills = Math.max(Math.floor(settings.autoSelect?.maxSkillsPerCall || 3), 1)
      const scored = candidates
        .filter((record) => this.modeAllowed(record, 'auto'))
        .map((record) => ({ record, score: this.scoreAutoSkill(record, promptText) }))
        .filter((item) => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
      selected = scored.slice(0, maxSkills).map((item) => item.record)
      reasons.push(`auto:${selected.length}`)
    }

    const prompts: string[] = []
    for (const record of selected) {
      const promptTemplate = loadSkillPromptTemplate(record)?.trim()
      if (promptTemplate) prompts.push(promptTemplate)
      const runtimeHint = buildSkillRuntimeHint(record)
      if (runtimeHint) prompts.push(runtimeHint)
    }

    let mcpSelection: AiMcpSelection | undefined
    let scope: AiToolContext['mcpScope'] | undefined
    let blockedToolIds: string[] = []
    const capabilities = new Set<string>()
    const internalToolNames = new Set<string>()

    for (const record of selected) {
      const extensions = record.descriptor.mulbyExtensions
      const policy = extensions?.mcpPolicy || record.descriptor.mcpPolicy
      const declaredCapabilities = normalizeAiToolCapabilityNames(
        extensions?.capabilities || record.descriptor.capabilities || []
      )
      for (const capability of declaredCapabilities) {
        capabilities.add(capability)
      }
      const declaredInternalTools = extensions?.internalTools || record.descriptor.internalTools || []
      for (const toolName of declaredInternalTools) {
        if (!toolName) continue
        internalToolNames.add(toolName)
        for (const capability of mapInternalToolsToCapabilities([toolName])) {
          capabilities.add(capability)
        }
      }
      if (!policy) continue
      mcpSelection = mergeMcpSelections(mcpSelection, {
        mode: 'auto',
        serverIds: policy.serverIds,
        allowedToolIds: policy.allowedToolIds
      })
      scope = {
        allowedServerIds: intersectOrAdopt(scope?.allowedServerIds, policy.serverIds),
        allowedToolIds: intersectOrAdopt(scope?.allowedToolIds, policy.allowedToolIds)
      }
      if (policy.blockedToolIds && policy.blockedToolIds.length > 0) {
        blockedToolIds = [...blockedToolIds, ...policy.blockedToolIds]
      }
    }

    if (blockedToolIds.length > 0) {
      const blockedSet = new Set(blockedToolIds)
      if (!mcpSelection) mcpSelection = { mode: 'auto' }
      const currentAllowed = mcpSelection.allowedToolIds || []
      const filteredAllowed = currentAllowed.filter((item) => !blockedSet.has(item))
      mcpSelection.allowedToolIds = filteredAllowed.length > 0 ? filteredAllowed : undefined
      if (scope?.allowedToolIds) {
        scope.allowedToolIds = scope.allowedToolIds.filter((item) => !blockedSet.has(item))
      }
    }

    return {
      selectedSkillIds: selected.map((record) => record.id),
      selectedSkillNames: selected.map((record) => record.descriptor.name),
      selectedSkills: selected.map((record) => ({
        id: record.id,
        source: record.source,
        trustLevel: record.trustLevel
      })),
      availableSkillsPrompt,
      systemPrompts: prompts,
      capabilities: Array.from(capabilities),
      internalTools: Array.from(internalToolNames),
      mergedMcp: mcpSelection,
      toolContextPatch: scope,
      reasons
    }
  }

  applyResolutionToOption(option: AiOption, resolution: AiSkillResolveResult): AiOption {
    const injectedSystemPrompt = [
      String(resolution.availableSkillsPrompt || '').trim(),
      resolution.systemPrompts.join('\n\n').trim()
    ]
      .filter(Boolean)
      .join('\n\n')
    const hasSelectedSkills = resolution.selectedSkillIds.length > 0
    if (!hasSelectedSkills && !injectedSystemPrompt) {
      return option
    }
    const messages = injectedSystemPrompt
      ? [{ role: 'system' as const, content: injectedSystemPrompt }, ...option.messages]
      : option.messages
    const hasExplicitMcpSelection = !!option.mcp
    const hasExplicitSkillSelection = !!option.skills
    // 显式 mcp 代表调用方已确定本次工具边界；隐式全局技能不应覆盖该边界。
    const shouldMergeSkillMcpPolicies = hasSelectedSkills && (hasExplicitSkillSelection || !hasExplicitMcpSelection)
    const mergedMcp = shouldMergeSkillMcpPolicies
      ? mergeMcpSelections(option.mcp, resolution.mergedMcp)
      : option.mcp
    const toolContext = shouldMergeSkillMcpPolicies
      ? mergeToolContext(option.toolContext, resolution.toolContextPatch)
      : option.toolContext
    if (option.mcp?.mode && mergedMcp) {
      mergedMcp.mode = option.mcp.mode
    }
    const capabilities = hasSelectedSkills
      ? Array.from(
      new Set([
        ...(option.capabilities || []),
        ...(resolution.capabilities || [])
      ])
    )
      : option.capabilities || []
    const internalTools = hasSelectedSkills
      ? Array.from(
      new Set([
        ...(option.internalTools || []),
        ...(resolution.internalTools || [])
      ])
    )
      : option.internalTools || []
    return {
      ...option,
      messages,
      mcp: mergedMcp,
      toolContext,
      capabilities: capabilities.length > 0 ? capabilities : option.capabilities,
      internalTools: internalTools.length > 0 ? internalTools : option.internalTools
    }
  }

  preview(input: AiSkillPreviewInput): AiSkillPreview {
    const option: AiOption = {
      model: input.option?.model,
      messages:
        input.option?.messages && input.option.messages.length > 0
          ? (input.option.messages as AiMessage[])
          : input.prompt
            ? [{ role: 'user', content: input.prompt }]
            : [{ role: 'user', content: '' }],
      mcp: input.option?.mcp,
      skills: {
        ...(input.option?.skills || {}),
        mode: input.option?.skills?.mode || (input.skillIds && input.skillIds.length > 0 ? 'manual' : 'auto'),
        skillIds: input.skillIds || input.option?.skills?.skillIds
      },
      toolContext: input.option?.toolContext,
      tools: input.option?.tools,
      capabilities: input.option?.capabilities,
      internalTools: input.option?.internalTools,
      params: input.option?.params,
      maxToolSteps: input.option?.maxToolSteps
    }

    const resolution = this.resolveForAiCall(option)
    const selectedMap = new Set(resolution.selectedSkillIds)
    const selected = this.list().filter((record) => selectedMap.has(record.id))
    const blockedToolIds = Array.from(
      new Set(
        selected
          .flatMap((record) => {
            const policy = record.descriptor.mulbyExtensions?.mcpPolicy || record.descriptor.mcpPolicy
            return policy?.blockedToolIds || []
          })
          .filter(Boolean)
      )
    )
    return {
      selected,
      systemPrompt: [
        String(resolution.availableSkillsPrompt || '').trim(),
        resolution.systemPrompts.join('\n\n').trim()
      ]
        .filter(Boolean)
        .join('\n\n'),
      mcpImpact: {
        serverIds: resolution.mergedMcp?.serverIds,
        allowedToolIds: resolution.mergedMcp?.allowedToolIds,
        blockedToolIds: blockedToolIds.length > 0 ? blockedToolIds : undefined
      },
      reasons: resolution.reasons || []
    }
  }
}

export const aiSkillService = new AiSkillService()
