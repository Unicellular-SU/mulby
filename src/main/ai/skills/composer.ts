import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AiMessage,
  AiModel,
  AiSettings,
  AiSkillMulbyExtensions,
  AiSkillCreateProgressChunk,
  AiSkillCreateStage
} from '../../../shared/types/ai'
import { getAiSettings } from '../config'
import { aiService } from '..'
import { aiSkillService } from './service'
import { AI_TOOL_CAPABILITY_NAMES, normalizeAiToolCapabilityNames } from '../tools/capabilities'
import { normalizeAiInternalToolNames } from '../tools/internal-tools'
import { AI_RUN_COMMAND_TOOL_NAME } from '../tools/run-command-tool'
import {
  loadSkillCreatorResourcePack,
  type SkillCreatorResourcePack
} from './creator-resources'
import type {
  AiSkillCreateModelOptionItem,
  AiSkillCreateWithAiInput,
  AiSkillCreateWithAiResult,
  AiSkillCreateWithAiStreamCallbacks,
  AiSkillGeneratedFile
} from './types'

const SUPPORTED_METADATA_MULBY_KEYS = new Set([
  'mode',
  'triggerPhrases',
  'capabilities',
  'internalTools',
  'mcpPolicy'
])
const GENERATED_FILE_PATH_PATTERN = /^((scripts|references|assets)\/)[^?*:|"<>]+$/
const DEFAULT_SKILL_CREATOR_WORKSPACE_DIR = path.resolve(os.tmpdir(), 'mulby-skill-creator-workspace')

interface GeneratedSkillPayload {
  id?: unknown
  name?: unknown
  description?: unknown
  license?: unknown
  compatibility?: unknown
  metadata?: unknown
  metadataMulby?: unknown
  allowedTools?: unknown
  ['allowed-tools']?: unknown
  promptTemplate?: unknown
  mode?: unknown
  triggerPhrases?: unknown
  capabilities?: unknown
  internalTools?: unknown
  mcpPolicy?: unknown
  skillMd?: unknown
  skillMarkdown?: unknown
  files?: unknown
}

interface NormalizeMetadataMulbyResult {
  value?: AiSkillMulbyExtensions
  droppedKeys: string[]
  droppedCapabilities: string[]
}

interface NormalizeFilesResult {
  files?: AiSkillGeneratedFile[]
  pathOnlyPaths: string[]
  invalidPaths: string[]
}

function extractSkillCreatorSnippet(content: string): string {
  const text = String(content || '')
  if (!text.trim()) return ''
  const anatomyIdx = text.indexOf('### Anatomy of a Skill')
  const skillMdIdx = text.indexOf('#### SKILL.md (required)')
  const endIdx = text.indexOf('#### Bundled Resources')
  const start = anatomyIdx >= 0 ? anatomyIdx : (skillMdIdx >= 0 ? skillMdIdx : 0)
  const end = endIdx > start ? endIdx : Math.min(text.length, start + 4000)
  const raw = text.slice(start, end).trim()
  return raw.slice(0, 2500)
}

function emitProgress(callbacks: AiSkillCreateWithAiStreamCallbacks | undefined, chunk: AiSkillCreateProgressChunk) {
  callbacks?.onChunk?.(chunk)
}

function emitStageStatus(
  callbacks: AiSkillCreateWithAiStreamCallbacks | undefined,
  stage: AiSkillCreateStage,
  stageStatus: 'start' | 'done' | 'error',
  text: string
) {
  emitProgress(callbacks, {
    type: 'status',
    stage,
    stageStatus,
    text
  })
}

function normalizeTextFromMessage(message: AiMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((item) => item.type === 'text')
    .map((item) => ('text' in item ? item.text : ''))
    .join('\n')
}

function extractJsonPayload(rawText: string): GeneratedSkillPayload {
  const tryParse = (value: string): GeneratedSkillPayload | null => {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as GeneratedSkillPayload
      }
    } catch {
      // ignore
    }
    return null
  }

  const direct = tryParse(rawText)
  if (direct) return direct

  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1]) {
    const parsed = tryParse(fenced[1])
    if (parsed) return parsed
  }

  const objectLike = rawText.match(/\{[\s\S]*\}/)
  if (objectLike && objectLike[0]) {
    const parsed = tryParse(objectLike[0])
    if (parsed) return parsed
  }

  throw new Error('AI 生成结果不是有效 JSON，请重试')
}

function asString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.map((item) => String(item ?? '').trim()).filter(Boolean)
  return out.length > 0 ? out : undefined
}

function normalizeMode(value: unknown): 'manual' | 'auto' | 'both' | undefined {
  return value === 'manual' || value === 'auto' || value === 'both' ? value : undefined
}

function normalizeMcpPolicy(value: unknown): {
  serverIds?: string[]
  allowedToolIds?: string[]
  blockedToolIds?: string[]
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const policy = value as Record<string, unknown>
  return {
    serverIds: asStringArray(policy.serverIds),
    allowedToolIds: asStringArray(policy.allowedToolIds),
    blockedToolIds: asStringArray(policy.blockedToolIds)
  }
}

function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = asString(rawKey)
    if (!key) continue
    if (typeof rawValue !== 'string') continue
    out[key] = rawValue
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeAllowedTools(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const out = value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
    return out.length > 0 ? Array.from(new Set(out)) : undefined
  }
  if (!Array.isArray(value)) return undefined
  const out = value.map((item) => String(item ?? '').trim()).filter(Boolean)
  return out.length > 0 ? Array.from(new Set(out)) : undefined
}

function normalizeMetadataMulby(payload: GeneratedSkillPayload): NormalizeMetadataMulbyResult {
  const direct = payload.metadataMulby
  const fromDirect = direct && typeof direct === 'object' && !Array.isArray(direct)
    ? (direct as Record<string, unknown>)
    : null
  const droppedKeys = fromDirect
    ? Object.keys(fromDirect).filter((key) => !SUPPORTED_METADATA_MULBY_KEYS.has(key))
    : []
  const mode = normalizeMode(fromDirect?.mode ?? payload.mode)
  const triggerPhrases = asStringArray(fromDirect?.triggerPhrases ?? payload.triggerPhrases)
  const rawCapabilities = asStringArray(fromDirect?.capabilities ?? payload.capabilities) || []
  const capabilities = normalizeAiToolCapabilityNames(rawCapabilities)
  const droppedCapabilities = rawCapabilities.filter((value) => normalizeAiToolCapabilityNames([value]).length === 0)
  const internalTools = normalizeAiInternalToolNames(asStringArray(fromDirect?.internalTools ?? payload.internalTools) || [])
  const mcpPolicy = normalizeMcpPolicy(fromDirect?.mcpPolicy ?? payload.mcpPolicy)
  const out: AiSkillMulbyExtensions = {
    ...(mode ? { mode } : {}),
    ...(triggerPhrases ? { triggerPhrases } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(internalTools.length > 0 ? { internalTools } : {}),
    ...(mcpPolicy ? { mcpPolicy } : {})
  }
  return {
    value: Object.keys(out).length > 0 ? out : undefined,
    droppedKeys,
    droppedCapabilities
  }
}

function normalizeGeneratedFilePath(value: unknown): string | undefined {
  const normalized = String(value ?? '').replace(/\\/g, '/').trim()
  if (!normalized) return undefined
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return undefined
  if (normalized.includes('..')) return undefined
  if (!GENERATED_FILE_PATH_PATTERN.test(normalized)) return undefined
  return normalized
}

function dedupeGeneratedFiles(files: AiSkillGeneratedFile[] | undefined): AiSkillGeneratedFile[] | undefined {
  if (!files || files.length === 0) return undefined
  const map = new Map<string, AiSkillGeneratedFile>()
  for (const item of files) {
    map.set(item.path, item)
  }
  return Array.from(map.values())
}

function normalizeFiles(value: unknown): NormalizeFilesResult {
  if (!Array.isArray(value)) {
    return {
      files: undefined,
      pathOnlyPaths: [],
      invalidPaths: []
    }
  }
  const out: AiSkillGeneratedFile[] = []
  const pathOnlyPaths: string[] = []
  const invalidPaths: string[] = []
  const seenPathOnly = new Set<string>()
  for (const item of value) {
    if (typeof item === 'string') {
      const filePath = normalizeGeneratedFilePath(item)
      if (!filePath) {
        invalidPaths.push(String(item))
        continue
      }
      if (!seenPathOnly.has(filePath)) {
        seenPathOnly.add(filePath)
        pathOnlyPaths.push(filePath)
      }
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const filePath = normalizeGeneratedFilePath(row.path)
    const content = asString(row.content)
    if (!filePath) {
      invalidPaths.push(String(row.path ?? ''))
      continue
    }
    if (content === undefined) {
      if (!seenPathOnly.has(filePath)) {
        seenPathOnly.add(filePath)
        pathOnlyPaths.push(filePath)
      }
      continue
    }
    out.push({ path: filePath, content })
  }
  return {
    files: dedupeGeneratedFiles(out),
    pathOnlyPaths,
    invalidPaths
  }
}

function resolveSkillCreatorWorkspaceRoot(): string {
  const envPath = String(process.env.MULBY_SKILL_CREATOR_WORKSPACE || '').trim()
  return envPath ? path.resolve(envPath) : DEFAULT_SKILL_CREATOR_WORKSPACE_DIR
}

function pathInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return undefined
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

async function hydrateFilesFromWorkspace(input: {
  paths: string[]
  skillNameCandidates: string[]
}): Promise<{ files: AiSkillGeneratedFile[]; missingPaths: string[] }> {
  const workspaceRoot = resolveSkillCreatorWorkspaceRoot()
  const skillNames = Array.from(
    new Set(
      input.skillNameCandidates
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  )
  const files: AiSkillGeneratedFile[] = []
  const missingPaths: string[] = []
  for (const relativePath of input.paths) {
    let foundContent: string | undefined
    for (const skillName of skillNames) {
      const candidateSkillDir = path.join(workspaceRoot, skillName)
      const candidate = path.join(candidateSkillDir, relativePath)
      if (!pathInside(candidateSkillDir, candidate)) continue
      const content = await readFileIfExists(candidate)
      if (content !== undefined) {
        foundContent = content
        break
      }
    }
    if (foundContent === undefined) {
      missingPaths.push(relativePath)
      continue
    }
    files.push({
      path: relativePath,
      content: foundContent
    })
  }
  return {
    files,
    missingPaths
  }
}

async function repairFilesWithAi(input: {
  model: string
  requirements: string
  rawModelOutput: string
  skillMarkdown?: string
  filePaths: string[]
}): Promise<AiSkillGeneratedFile[] | undefined> {
  if (!input.filePaths || input.filePaths.length === 0) return undefined
  const systemPrompt = [
    'You are fixing a malformed skill generation payload.',
    'Return JSON only.',
    'Output exactly: {"files":[{"path":"...","content":"..."}]}',
    'Do not include any fields other than files.',
    'Each files item must include both path and full content.',
    'Never return string-only file paths.',
    'Each path must stay under scripts/, references/, or assets/.'
  ].join('\n')
  const userPrompt = [
    `User requirement:\n${input.requirements}`,
    `Expected file paths:\n${input.filePaths.map((item) => `- ${item}`).join('\n')}`,
    input.skillMarkdown
      ? `Current SKILL.md draft:\n${input.skillMarkdown}`
      : '',
    `Previous malformed JSON output:\n${input.rawModelOutput}`
  ]
    .filter(Boolean)
    .join('\n\n')
  const repaired = await aiService.call({
    model: input.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    skills: { mode: 'off' }
  })
  const repairedText = normalizeTextFromMessage(repaired)
  const repairedPayload = extractJsonPayload(repairedText)
  const normalized = normalizeFiles(repairedPayload.files)
  if (normalized.pathOnlyPaths.length > 0 || normalized.invalidPaths.length > 0) return undefined
  if (!normalized.files || normalized.files.length === 0) return undefined
  const requested = new Set(input.filePaths)
  const filtered = normalized.files.filter((item) => requested.has(item.path))
  if (filtered.length !== input.filePaths.length) return undefined
  return dedupeGeneratedFiles(filtered)
}

function formatCapabilityList(): string {
  return AI_TOOL_CAPABILITY_NAMES.join(', ')
}

function buildMetadataMulbyNotes(input: NormalizeMetadataMulbyResult): string[] {
  const notes: string[] = []
  if (input.droppedKeys.length > 0) {
    notes.push(`metadataMulby unsupported keys ignored: ${input.droppedKeys.join(', ')}`)
  }
  if (input.droppedCapabilities.length > 0) {
    notes.push(`metadataMulby.capabilities unsupported values ignored: ${input.droppedCapabilities.join(', ')}`)
  }
  return notes
}

function buildFilesNormalizationNotes(input: NormalizeFilesResult): string[] {
  const notes: string[] = []
  if (input.invalidPaths.length > 0) {
    notes.push(`files invalid paths ignored: ${input.invalidPaths.join(', ')}`)
  }
  return notes
}

function deriveSkillName(requirements: string): string {
  const cleaned = requirements
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return cleaned || 'ai-generated-skill'
}

function normalizeSkillName(value: unknown, fallback: string): string {
  const raw = String(value ?? fallback).trim().toLowerCase()
  const normalized = raw
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return normalized || fallback
}

function sliceForPrompt(input: string, limit: number): string {
  const text = String(input || '').trim()
  if (!text) return ''
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated]`
}

function buildSkillCreatorContext(pack: SkillCreatorResourcePack | null): string {
  if (!pack) {
    return ''
  }

  const scriptPaths = pack.scriptFiles.map((file) => `- ${file}`).join('\n')
  const referencesText = pack.referenceFiles
    .map((item) => `## ${item.filename}\n${sliceForPrompt(item.content, 3000)}`)
    .join('\n\n')

  return [
    'Built-in skill-creator package (load as constraints):',
    `root: ${pack.rootPath}`,
    `skill_md: ${pack.skillMdPath}`,
    '',
    '### SKILL.md excerpt',
    sliceForPrompt(extractSkillCreatorSnippet(pack.skillMdContent) || pack.skillMdContent, 6000),
    '',
    scriptPaths ? `### scripts/\n${scriptPaths}` : '',
    referencesText ? `### references\n${referencesText}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function normalizeToolCallArgs(value: unknown): { command?: string; args?: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return {
    command: asString(input.command),
    args: asStringArray(input.args)
  }
}

function summarizeToolResult(value: unknown): string {
  if (!value || typeof value !== 'object') return '命令执行完成'
  const input = value as Record<string, unknown>
  const success = input.success === true
  const code = typeof input.exitCode === 'number' ? `exit=${input.exitCode}` : ''
  const timedOut = input.timedOut === true ? 'timeout' : ''
  const message = asString(input.error) || asString(input.message) || ''
  const hints = [code, timedOut, message].filter(Boolean).join(', ')
  if (!hints) return success ? '命令执行成功' : '命令执行结束'
  return success ? `命令执行成功（${hints}）` : `命令执行返回（${hints}）`
}

function isSkillCreatorCommandEnabled(): boolean {
  const disabledRaw = String(process.env.MULBY_DISABLE_SKILL_CREATOR_TOOLS || '').trim().toLowerCase()
  if (disabledRaw === '1' || disabledRaw === 'true' || disabledRaw === 'yes') {
    return false
  }
  const enabledRaw = String(process.env.MULBY_ENABLE_SKILL_CREATOR_TOOLS || '').trim().toLowerCase()
  if (!enabledRaw) return true
  return enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes'
}

async function buildPrompts(
  input: AiSkillCreateWithAiInput,
  pack: SkillCreatorResourcePack | null,
  allowToolCalls: boolean
): Promise<{ systemPrompt: string; userPrompt: string }> {
  const isRevision = Boolean(String(input.previousRawText || '').trim())
  const builtinGuide = buildSkillCreatorContext(pack)
  const systemPrompt = [
    'You are an expert skill author.',
    'Create or revise a practical AI skill package following Agent Skills conventions.',
    'Respond with JSON only (no markdown prose).',
    'Return fields: id, name, description, license, compatibility, metadata, allowedTools, metadataMulby, promptTemplate, skillMd, files.',
    'SKILL.md frontmatter may only contain: name, description, license, compatibility, metadata, allowed-tools.',
    'metadata must be a string key-value map.',
    'Do not output unsupported top-level frontmatter fields (mode, capabilities, triggerPhrases, mcpPolicy, etc).',
    'Put project-specific extensions under metadataMulby only.',
    'metadataMulby supports keys only: mode, triggerPhrases, capabilities, internalTools, mcpPolicy.',
    `metadataMulby.capabilities supports only: ${formatCapabilityList()}.`,
    'Do not output metadataMulby.platform or any unknown metadataMulby key.',
    'skillMd must start with YAML frontmatter enclosed by --- and include required name/description.',
    'Prefer kebab-case for name/id. Keep description specific about when to use the skill.',
    'Only include files when needed; paths must stay under scripts/, references/, or assets/.',
    'files is optional and must be an array of objects: {"path":"...","content":"..."} only.',
    'Never return files as string path list.',
    'If user asks for scripts/libraries, you MUST include full script content in files[].content.',
    'If no files are needed, return "files": [].',
    allowToolCalls ? 'Tool-call policy (strict):' : 'Tool-call policy: disabled for safety. Do not call tools.',
    allowToolCalls ? `- Use ${AI_RUN_COMMAND_TOOL_NAME} for command execution.` : '',
    allowToolCalls ? '- run_command args must be a JSON object: {"command":"...","args":[...],"cwd":"...","timeoutMs":30000,"shell":false}.' : '',
    allowToolCalls ? '- Prefer using python3 with absolute script path under <skill-creator-root>/scripts/*.py.' : '',
    allowToolCalls ? '- Auxiliary dependency command allowed: python3 -m pip install/show/list/freeze <package> (or pip direct form).' : '',
    allowToolCalls ? '- When quick_validate reports missing module yaml, install pyyaml then retry validation.' : '',
    allowToolCalls ? '- Never use shell=true, never use -c probes, and never use command discovery loops.' : '',
    allowToolCalls ? '- Do not run --help probes. Use scripts directly with concrete arguments.' : '',
    allowToolCalls ? '- If a tool fails, adapt once and continue. Do not repeat the same probe loop.' : '',
    builtinGuide
      ? `Use this built-in "skill-creator" package context as hard constraints:\n${builtinGuide}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
  const promptParts = [
    `User requirements:\n${input.requirements}`,
    `Preferred mode: ${input.modePreference || 'both'}`
  ]
  if (isRevision) {
    promptParts.push(
      [
        'You are revising an existing skill draft.',
        'Keep the same skill intent and keep id stable unless user explicitly asks to rename.',
        'Previous model output JSON:',
        input.previousRawText || ''
      ].join('\n')
    )
  }
  promptParts.push('Output strict JSON.')
  const userPrompt = promptParts.join('\n\n')
  return { systemPrompt, userPrompt }
}

function resolveProviderByModel(settings: AiSettings, model: AiModel): { id?: string; label?: string } {
  if (model.providerRef) {
    const provider = settings.providers.find((item) => String(item.id) === String(model.providerRef))
    return {
      id: provider ? String(provider.id) : String(model.providerRef),
      label: provider?.label || model.providerLabel
    }
  }
  if (model.providerLabel) {
    const provider = settings.providers.find((item) => (item.label || String(item.id)) === model.providerLabel)
    return {
      id: provider ? String(provider.id) : undefined,
      label: model.providerLabel
    }
  }
  if (model.id.includes(':')) {
    const token = model.id.split(':', 1)[0]
    const provider = settings.providers.find((item) => String(item.id) === token || String(item.type || item.id) === token)
    return {
      id: provider ? String(provider.id) : undefined,
      label: provider?.label
    }
  }
  return {}
}

export async function listSkillCreateModels(): Promise<AiSkillCreateModelOptionItem[]> {
  const settings = getAiSettings()
  const allModels = await aiService.allModels()
  const enabledProviders = new Set(
    (settings.providers || [])
      .filter((provider) => provider.enabled !== false)
      .map((provider) => String(provider.id))
  )
  const entries = new Map<string, AiSkillCreateModelOptionItem>()

  for (const model of allModels) {
    const provider = resolveProviderByModel(settings, model)
    if (provider.id && !enabledProviders.has(provider.id)) continue
    entries.set(model.id, {
      id: model.id,
      label: model.label || model.id,
      providerRef: provider.id,
      providerLabel: provider.label
    })
  }

  const fromSettings = settings.models || []
  for (const model of fromSettings) {
    const providerId = model.providerRef ? String(model.providerRef) : undefined
    if (providerId && !enabledProviders.has(providerId)) continue
    entries.set(model.id, {
      id: model.id,
      label: model.label || model.id,
      providerRef: providerId,
      providerLabel: model.providerLabel
    })
  }

  for (const provider of settings.providers || []) {
    if (provider.enabled === false || !provider.defaultModel) continue
    if (!entries.has(provider.defaultModel)) {
      entries.set(provider.defaultModel, {
        id: provider.defaultModel,
        label: provider.defaultModel,
        providerRef: String(provider.id),
        providerLabel: provider.label
      })
    }
  }

  return Array.from(entries.values()).sort((a, b) => a.label.localeCompare(b.label))
}

async function createSkillWithAiInternal(
  input: AiSkillCreateWithAiInput,
  callbacks?: AiSkillCreateWithAiStreamCallbacks,
  requestId?: string
): Promise<AiSkillCreateWithAiResult> {
  const requirements = String(input.requirements || '').trim()
  const model = String(input.model || '').trim()
  if (!requirements) {
    throw new Error('Skill 需求不能为空')
  }
  if (!model) {
    throw new Error('请选择用于创建 Skill 的模型')
  }
  let currentStage: AiSkillCreateStage = 'generating'
  emitStageStatus(callbacks, currentStage, 'start', '生成中：调用模型生成 Skill 内容…')

  const skillCreatorPack = await loadSkillCreatorResourcePack()
  if (skillCreatorPack) {
    emitProgress(callbacks, {
      type: 'status',
      stage: 'generating',
      stageStatus: 'start',
      text: `已加载内置 skill-creator：${skillCreatorPack.rootPath}`
    })
  } else {
    emitProgress(callbacks, {
      type: 'status',
      stage: 'generating',
      stageStatus: 'start',
      text: '未找到内置 skill-creator，继续使用基础约束生成'
    })
  }

  const allowToolCalls = isSkillCreatorCommandEnabled()
  if (!allowToolCalls) {
    emitProgress(callbacks, {
      type: 'status',
      stage: 'generating',
      stageStatus: 'start',
      text: '已禁用命令工具（MULBY_DISABLE_SKILL_CREATOR_TOOLS=1），仅使用结构化生成'
    })
  }
  const { systemPrompt, userPrompt } = await buildPrompts({ ...input, requirements }, skillCreatorPack, allowToolCalls)
  let generatedText = ''
  try {
    const finalMessage = await aiService.stream(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        skills: { mode: 'off' },
        capabilities: allowToolCalls ? ['shell.exec'] : undefined,
        maxToolSteps: 20
      },
      {
        onChunk: (chunk) => {
          if (chunk.chunkType === 'tool-call') {
            const callName = chunk.tool_call?.name
            if (callName === AI_RUN_COMMAND_TOOL_NAME) {
              const commandInput = normalizeToolCallArgs(chunk.tool_call?.args)
              const preview = [commandInput.command, ...(commandInput.args || [])].filter(Boolean).join(' ').trim()
              emitProgress(callbacks, {
                type: 'status',
                stage: 'generating',
                stageStatus: 'start',
                text: preview ? `执行命令：${preview}` : '执行命令：runCommand'
              })
            }
            return
          }
          if (chunk.chunkType === 'tool-result') {
            const resultName = chunk.tool_result?.name
            if (resultName === AI_RUN_COMMAND_TOOL_NAME) {
              emitProgress(callbacks, {
                type: 'status',
                stage: 'generating',
                stageStatus: 'done',
                text: summarizeToolResult(chunk.tool_result?.result)
              })
            }
            return
          }
          const chunkType = chunk.chunkType === 'reasoning' ? 'reasoning' : 'content'
          const text = normalizeTextFromMessage(chunk)
          if (!text) return
          generatedText += text
          emitProgress(callbacks, {
            type: chunkType,
            text
          })
        }
      },
      requestId
    )

    if (!generatedText.trim()) {
      generatedText = normalizeTextFromMessage(finalMessage)
    }
    emitStageStatus(callbacks, 'generating', 'done', '生成完成：已收到模型完整输出')

    currentStage = 'parsing'
    emitStageStatus(callbacks, currentStage, 'start', '解析中：提取并解析 JSON 结构…')
    const payload = extractJsonPayload(generatedText)
    emitStageStatus(callbacks, currentStage, 'done', '解析完成：JSON 结构有效')

    currentStage = 'validating'
    emitStageStatus(callbacks, currentStage, 'start', '校验中：标准化字段与文件定义…')
    const defaultName = deriveSkillName(requirements)
    const normalizedName = normalizeSkillName(payload.name, defaultName)
    const normalizedDescription = asString(payload.description) || `AI generated skill for: ${normalizedName}`
    const normalizedLicense = asString(payload.license)
    const normalizedCompatibility = asString(payload.compatibility)
    const normalizedMetadata = normalizeMetadata(payload.metadata)
    const normalizedAllowedTools = normalizeAllowedTools(payload.allowedTools ?? payload['allowed-tools'])
    const normalizedMetadataMulby = normalizeMetadataMulby(payload)
    const normalizedFilesResult = normalizeFiles(payload.files)
    const generationNotes: string[] = [
      ...buildMetadataMulbyNotes(normalizedMetadataMulby),
      ...buildFilesNormalizationNotes(normalizedFilesResult)
    ]
    let normalizedFiles = normalizedFilesResult.files

    if (normalizedFilesResult.pathOnlyPaths.length > 0) {
      emitProgress(callbacks, {
        type: 'status',
        stage: 'validating',
        stageStatus: 'start',
        text: '检测到 files 仅返回路径，尝试补全文件内容…'
      })
      const fromWorkspace = await hydrateFilesFromWorkspace({
        paths: normalizedFilesResult.pathOnlyPaths,
        skillNameCandidates: Array.from(
          new Set([
            normalizedName,
            normalizeSkillName(payload.id, normalizedName)
          ])
        )
      })
      normalizedFiles = dedupeGeneratedFiles([...(normalizedFiles || []), ...fromWorkspace.files])
      const existingPathSet = new Set((normalizedFiles || []).map((item) => item.path))
      const stillMissing = normalizedFilesResult.pathOnlyPaths.filter((item) => !existingPathSet.has(item))
      if (stillMissing.length > 0) {
        const repaired = await repairFilesWithAi({
          model,
          requirements,
          rawModelOutput: generatedText,
          skillMarkdown: asString(payload.skillMd) || asString(payload.skillMarkdown),
          filePaths: stillMissing
        })
        if (repaired && repaired.length > 0) {
          normalizedFiles = dedupeGeneratedFiles([...(normalizedFiles || []), ...repaired])
        }
      }

      const finalPathSet = new Set((normalizedFiles || []).map((item) => item.path))
      const unresolved = normalizedFilesResult.pathOnlyPaths.filter((item) => !finalPathSet.has(item))
      if (unresolved.length > 0) {
        throw new Error(
          `AI 生成的 files 缺少 content，无法写入：${unresolved.slice(0, 8).join(', ')}。` +
          '请让模型返回 files=[{path, content}]。'
        )
      }
      emitProgress(callbacks, {
        type: 'status',
        stage: 'validating',
        stageStatus: 'done',
        text: 'files 内容补全完成'
      })
    }
    emitStageStatus(callbacks, currentStage, 'done', '校验完成：准备写入本地目录')

    currentStage = 'writing'
    emitStageStatus(callbacks, currentStage, 'start', '写入中：保存 SKILL.md 与附属文件…')
    const record = await aiSkillService.createFromGenerated({
      id: asString(payload.id),
      replaceSkillId: asString(input.replaceSkillId),
      name: normalizedName,
      description: normalizedDescription,
      license: normalizedLicense,
      compatibility: normalizedCompatibility,
      metadata: normalizedMetadata,
      allowedTools: normalizedAllowedTools,
      metadataMulby: normalizedMetadataMulby.value,
      promptTemplate: asString(payload.promptTemplate),
      skillMarkdown: asString(payload.skillMd) || asString(payload.skillMarkdown),
      files: normalizedFiles,
      enabled: input.enabled ?? false,
      trustLevel: input.trustLevel ?? 'reviewed',
      source: 'manual'
    })
    emitStageStatus(callbacks, currentStage, 'done', '写入完成：已落盘到应用 skills 目录')

    currentStage = 'completed'
    emitStageStatus(callbacks, currentStage, 'done', `完成：${record.descriptor.name || record.id}`)

    return {
      record,
      generation: {
        model,
        rawText: generatedText,
        notes: generationNotes.length > 0 ? generationNotes : undefined
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitStageStatus(callbacks, currentStage, 'error', `${message}`)
    throw error
  }
}

export async function createSkillWithAi(input: AiSkillCreateWithAiInput): Promise<AiSkillCreateWithAiResult> {
  return await createSkillWithAiInternal(input)
}

export async function createSkillWithAiStream(
  input: AiSkillCreateWithAiInput,
  callbacks?: AiSkillCreateWithAiStreamCallbacks,
  requestId?: string
): Promise<AiSkillCreateWithAiResult> {
  return await createSkillWithAiInternal(input, callbacks, requestId)
}
