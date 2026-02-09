import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import extractZip from 'extract-zip'
import type {
  AiMcpSelection,
  AiMessage,
  AiOption,
  AiSettings,
  AiSkillDescriptor,
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

const SKILL_MD_VARIANTS = ['SKILL.md', 'skill.md']
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
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return normalized || 'skill'
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function parsePrimitive(input: string): unknown {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed)
    if (Number.isFinite(num)) return num
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) return {}
  const raw = match[1]
  const lines = raw.split(/\r?\n/)
  const data: Record<string, unknown> = {}
  let currentArrayKey: string | null = null

  for (const line of lines) {
    const arrayMatch = line.match(/^\s*-\s+(.*)$/)
    if (arrayMatch && currentArrayKey) {
      const currentValue = data[currentArrayKey]
      if (!Array.isArray(currentValue)) {
        data[currentArrayKey] = []
      }
      ;(data[currentArrayKey] as unknown[]).push(parsePrimitive(arrayMatch[1]))
      continue
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!keyMatch) {
      currentArrayKey = null
      continue
    }

    const key = keyMatch[1]
    const value = keyMatch[2]
    if (!value.trim()) {
      data[key] = []
      currentArrayKey = key
      continue
    }

    data[key] = parsePrimitive(value)
    currentArrayKey = null
  }

  return data
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(\r?\n)?/, '').trim()
}

function normalizeMode(input: unknown): 'manual' | 'auto' | 'both' | undefined {
  if (input === 'manual' || input === 'auto' || input === 'both') return input
  return undefined
}

function normalizeTrustLevel(input: unknown): AiSkillTrustLevel {
  if (input === 'trusted' || input === 'reviewed' || input === 'untrusted') return input
  return 'reviewed'
}

function parseDescriptorFromMarkdown(input: {
  content: string
  fallbackId: string
  fallbackName: string
}): AiSkillDescriptor {
  const frontmatter = parseFrontmatter(input.content)
  const body = stripFrontmatter(input.content)

  const id = slugify(String(frontmatter.id || input.fallbackId || input.fallbackName || 'skill'))
  const name = String(frontmatter.name || input.fallbackName || id).trim() || id
  const description = String(frontmatter.description || '').trim() || undefined
  const version = String(frontmatter.version || '').trim() || undefined
  const author = String(frontmatter.author || '').trim() || undefined
  const tags = asStringArray(frontmatter.tags)
  const triggerPhrases = asStringArray(frontmatter.triggerPhrases ?? frontmatter.trigger_phrases)
  const capabilities = normalizeAiToolCapabilityNames(
    asStringArray(frontmatter.capabilities ?? frontmatter.capabilityDeps ?? frontmatter.capability_deps) || []
  )
  const internalTools = asStringArray(frontmatter.internalTools ?? frontmatter.internal_tools)
  const mode = normalizeMode(frontmatter.mode)
  const promptTemplate =
    String((frontmatter.promptTemplate ?? frontmatter.prompt_template) || '').trim() || (body || undefined)

  const mcpPolicyRaw = frontmatter.mcpPolicy ?? frontmatter.mcp_policy
  const mcpPolicy =
    mcpPolicyRaw && typeof mcpPolicyRaw === 'object' && !Array.isArray(mcpPolicyRaw)
      ? {
          serverIds: asStringArray((mcpPolicyRaw as Record<string, unknown>).serverIds),
          allowedToolIds: asStringArray((mcpPolicyRaw as Record<string, unknown>).allowedToolIds),
          blockedToolIds: asStringArray((mcpPolicyRaw as Record<string, unknown>).blockedToolIds)
        }
      : undefined

  return {
    id,
    name,
    description,
    version,
    author,
    tags,
    triggerPhrases,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
    internalTools,
    mode,
    promptTemplate,
    mcpPolicy
  }
}

function buildSkillMarkdown(descriptor: AiSkillDescriptor): string {
  const lines: string[] = ['---']
  lines.push(`id: ${descriptor.id}`)
  lines.push(`name: ${descriptor.name}`)
  if (descriptor.description) lines.push(`description: ${descriptor.description}`)
  if (descriptor.version) lines.push(`version: ${descriptor.version}`)
  if (descriptor.author) lines.push(`author: ${descriptor.author}`)
  if (descriptor.mode) lines.push(`mode: ${descriptor.mode}`)
  if (descriptor.tags && descriptor.tags.length > 0) {
    lines.push('tags:')
    for (const tag of descriptor.tags) lines.push(`  - ${tag}`)
  }
  if (descriptor.triggerPhrases && descriptor.triggerPhrases.length > 0) {
    lines.push('triggerPhrases:')
    for (const phrase of descriptor.triggerPhrases) lines.push(`  - ${phrase}`)
  }
  if (descriptor.capabilities && descriptor.capabilities.length > 0) {
    lines.push('capabilities:')
    for (const capability of descriptor.capabilities) lines.push(`  - ${capability}`)
  }
  if (descriptor.internalTools && descriptor.internalTools.length > 0) {
    lines.push('internalTools:')
    for (const toolName of descriptor.internalTools) lines.push(`  - ${toolName}`)
  }
  if (descriptor.mcpPolicy) {
    const mcpPolicy = {
      serverIds: descriptor.mcpPolicy.serverIds,
      allowedToolIds: descriptor.mcpPolicy.allowedToolIds,
      blockedToolIds: descriptor.mcpPolicy.blockedToolIds
    }
    lines.push(`mcpPolicy: ${JSON.stringify(mcpPolicy)}`)
  }
  lines.push('---')
  lines.push('')
  if (descriptor.promptTemplate) {
    lines.push(descriptor.promptTemplate.trim())
  }
  return lines.join('\n')
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
  const scriptRefs = extractScriptRefsFromPrompt(record.descriptor.promptTemplate)
  const absoluteScriptRefs = scriptRefs.map((ref) => JSON.stringify(path.join(installPath, ref)))
  const lines = [
    `Skill runtime hint (${record.id}):`,
    `- Skill root path: ${quotedInstallPath}`,
    '- Reuse existing scripts from this skill before writing ad-hoc inline scripts.',
    '- intools_run_command arguments must be a JSON object, never a quoted JSON string.'
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

  private nextUniqueId(baseId: string, existingIds: Set<string>): string {
    const initial = slugify(baseId)
    let nextId = initial
    let suffix = 2
    while (existingIds.has(nextId)) {
      nextId = `${initial}-${suffix}`
      suffix += 1
    }
    return nextId
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
    const descriptor = parseDescriptorFromMarkdown({
      content,
      fallbackId: path.basename(input.dirPath),
      fallbackName: path.basename(input.dirPath)
    })
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
    const id = this.nextUniqueId(input.id || name, existingIds)
    const now = this.deps.now()

    const descriptor: AiSkillDescriptor = {
      id,
      name,
      description: input.description?.trim() || undefined,
      promptTemplate: input.promptTemplate?.trim() || undefined,
      tags: input.tags?.map((item) => item.trim()).filter(Boolean),
      triggerPhrases: input.triggerPhrases?.map((item) => item.trim()).filter(Boolean),
      capabilities: normalizeAiToolCapabilityNames(input.capabilities || []),
      internalTools: input.internalTools?.map((item) => item.trim()).filter(Boolean),
      mode: input.mode,
      mcpPolicy: input.mcpPolicy
    }
    const markdown = buildSkillMarkdown(descriptor)
    const hash = sha256(markdown)
    const root = await this.ensureSkillsRootPath()
    const installPath = path.join(root, id)
    await fs.mkdir(installPath, { recursive: true })
    const skillMdPath = path.join(installPath, 'SKILL.md')
    await fs.writeFile(skillMdPath, markdown, 'utf8')

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
    const id = replaceTarget
      ? replaceTarget.id
      : this.nextUniqueId(input.id || replaceSkillId || name, existingIds)
    const now = this.deps.now()
    const descriptor: AiSkillDescriptor = {
      id,
      name,
      description: input.description?.trim() || undefined,
      promptTemplate: input.promptTemplate?.trim() || undefined,
      tags: input.tags?.map((item) => item.trim()).filter(Boolean),
      triggerPhrases: input.triggerPhrases?.map((item) => item.trim()).filter(Boolean),
      capabilities: normalizeAiToolCapabilityNames(input.capabilities || []),
      internalTools: input.internalTools?.map((item) => item.trim()).filter(Boolean),
      mode: input.mode,
      mcpPolicy: input.mcpPolicy
    }

    const root = await this.ensureSkillsRootPath()
    const installPath = path.join(root, id)
    await fs.rm(installPath, { recursive: true, force: true })
    await fs.mkdir(installPath, { recursive: true })
    const skillMdPath = path.join(installPath, 'SKILL.md')
    const markdown = String(input.skillMarkdown || '').trim() || buildSkillMarkdown(descriptor)
    await fs.writeFile(skillMdPath, markdown, 'utf8')
    await this.writeGeneratedFiles(installPath, input.files)

    const finalContent = await fs.readFile(skillMdPath, 'utf8')
    const parsedDescriptor = parseDescriptorFromMarkdown({
      content: finalContent,
      fallbackId: descriptor.id,
      fallbackName: descriptor.name
    })
    const finalDescriptor: AiSkillDescriptor = {
      ...descriptor,
      ...parsedDescriptor,
      id,
      name: parsedDescriptor.name || descriptor.name
    }
    const finalMarkdown = buildSkillMarkdown(finalDescriptor)
    await fs.writeFile(skillMdPath, finalMarkdown, 'utf8')

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
    return {
      id,
      name,
      description: String(obj.description || '').trim() || undefined,
      version: String(obj.version || '').trim() || undefined,
      author: String(obj.author || '').trim() || undefined,
      tags: asStringArray(obj.tags),
      triggerPhrases: asStringArray(obj.triggerPhrases ?? obj.trigger_phrases),
      capabilities: normalizeAiToolCapabilityNames(asStringArray(obj.capabilities ?? obj.capabilityDeps ?? obj.capability_deps) || []),
      internalTools: asStringArray(obj.internalTools ?? obj.internal_tools),
      mode: normalizeMode(obj.mode),
      promptTemplate: String((obj.promptTemplate ?? obj.prompt_template) || '').trim() || undefined,
      mcpPolicy:
        obj.mcpPolicy && typeof obj.mcpPolicy === 'object' && !Array.isArray(obj.mcpPolicy)
          ? {
              serverIds: asStringArray((obj.mcpPolicy as Record<string, unknown>).serverIds),
              allowedToolIds: asStringArray((obj.mcpPolicy as Record<string, unknown>).allowedToolIds),
              blockedToolIds: asStringArray((obj.mcpPolicy as Record<string, unknown>).blockedToolIds)
            }
          : undefined
    }
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
      const id = this.nextUniqueId(descriptor.id || descriptor.name, existingIds)
      existingIds.add(id)
      const nextDescriptor = { ...descriptor, id }
      const markdown = buildSkillMarkdown(nextDescriptor)
      const installPath = path.join(root, id)
      await fs.mkdir(installPath, { recursive: true })
      const skillMdPath = path.join(installPath, 'SKILL.md')
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
      fallbackId: path.basename(sourceDir),
      fallbackName: path.basename(sourceDir)
    })
    const id = this.nextUniqueId(parsed.id || parsed.name, existingIds)
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
      const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'intools-skill-install-'))
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
      const markdown = buildSkillMarkdown(nextRecord.descriptor)
      const filePath = nextRecord.skillMdPath || path.join(nextRecord.installPath, 'SKILL.md')
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

  private modeAllowed(descriptorMode: AiSkillDescriptor['mode'], requestedMode: 'manual' | 'auto'): boolean {
    if (!descriptorMode || descriptorMode === 'both') return true
    return descriptorMode === requestedMode
  }

  private scoreAutoSkill(record: AiSkillRecord, promptText: string): number {
    const text = promptText.toLowerCase()
    let score = 0
    const name = record.descriptor.name.toLowerCase()
    if (name && text.includes(name)) score += 2
    const triggers = record.descriptor.triggerPhrases || []
    for (const trigger of triggers) {
      if (text.includes(trigger.toLowerCase())) score += 3
    }
    const tags = record.descriptor.tags || []
    for (const tag of tags) {
      if (text.includes(tag.toLowerCase())) score += 1
    }
    return score
  }

  resolveForAiCall(option: AiOption): AiSkillResolveResult {
    const settings = this.getSkillSettings()
    if (!settings.enabled) {
      return { selectedSkillIds: [], selectedSkillNames: [], systemPrompts: [], reasons: ['skills disabled'] }
    }

    const requestedMode = option.skills?.mode
    const mode: 'off' | 'manual' | 'auto' =
      requestedMode ||
      (settings.autoSelect?.enabled ? 'auto' : settings.activeSkillIds.length > 0 ? 'manual' : 'off')
    if (mode === 'off') {
      return { selectedSkillIds: [], selectedSkillNames: [], systemPrompts: [], reasons: ['mode off'] }
    }

    const candidates = settings.records.filter((record) => record.enabled && record.trustLevel !== 'untrusted')
    const reasons: string[] = []
    let selected: AiSkillRecord[] = []

    if (mode === 'manual') {
      const requestedIds = option.skills?.skillIds && option.skills.skillIds.length > 0
        ? option.skills.skillIds
        : settings.activeSkillIds
      const include = new Set(requestedIds)
      selected = candidates.filter((record) => include.has(record.id) && this.modeAllowed(record.descriptor.mode, 'manual'))
      reasons.push(`manual:${selected.length}`)
    } else {
      const promptText = collectPromptText(option.messages)
      const minScore = Math.max(Math.floor(settings.autoSelect?.minScore || 1), 1)
      const maxSkills = Math.max(Math.floor(settings.autoSelect?.maxSkillsPerCall || 3), 1)
      const scored = candidates
        .filter((record) => this.modeAllowed(record.descriptor.mode, 'auto'))
        .map((record) => ({ record, score: this.scoreAutoSkill(record, promptText) }))
        .filter((item) => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
      selected = scored.slice(0, maxSkills).map((item) => item.record)
      reasons.push(`auto:${selected.length}`)
    }

    const prompts: string[] = []
    for (const record of selected) {
      const promptTemplate = record.descriptor.promptTemplate?.trim()
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
      const policy = record.descriptor.mcpPolicy
      for (const capability of normalizeAiToolCapabilityNames(record.descriptor.capabilities || [])) {
        capabilities.add(capability)
      }
      for (const toolName of record.descriptor.internalTools || []) {
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
      systemPrompts: prompts,
      capabilities: Array.from(capabilities),
      internalTools: Array.from(internalToolNames),
      mergedMcp: mcpSelection,
      toolContextPatch: scope,
      reasons
    }
  }

  applyResolutionToOption(option: AiOption, resolution: AiSkillResolveResult): AiOption {
    if (resolution.selectedSkillIds.length === 0) return option
    const injectedSystemPrompt = resolution.systemPrompts.join('\n\n')
    const messages = injectedSystemPrompt
      ? [{ role: 'system' as const, content: injectedSystemPrompt }, ...option.messages]
      : option.messages
    const hasExplicitMcpSelection = !!option.mcp
    const hasExplicitSkillSelection = !!option.skills
    // 显式 mcp 代表调用方已确定本次工具边界；隐式全局技能不应覆盖该边界。
    const shouldMergeSkillMcpPolicies = hasExplicitSkillSelection || !hasExplicitMcpSelection
    const mergedMcp = shouldMergeSkillMcpPolicies
      ? mergeMcpSelections(option.mcp, resolution.mergedMcp)
      : option.mcp
    const toolContext = shouldMergeSkillMcpPolicies
      ? mergeToolContext(option.toolContext, resolution.toolContextPatch)
      : option.toolContext
    if (option.mcp?.mode && mergedMcp) {
      mergedMcp.mode = option.mcp.mode
    }
    const capabilities = Array.from(
      new Set([
        ...(option.capabilities || []),
        ...(resolution.capabilities || [])
      ])
    )
    const internalTools = Array.from(
      new Set([
        ...(option.internalTools || []),
        ...(resolution.internalTools || [])
      ])
    )
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
          .flatMap((record) => record.descriptor.mcpPolicy?.blockedToolIds || [])
          .filter(Boolean)
      )
    )
    return {
      selected,
      systemPrompt: resolution.systemPrompts.join('\n\n'),
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
