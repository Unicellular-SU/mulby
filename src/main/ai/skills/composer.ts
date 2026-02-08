import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AiMessage,
  AiModel,
  AiSettings,
  AiSkillCreateProgressChunk,
  AiSkillCreateStage
} from '../../../shared/types/ai'
import { getAiSettings } from '../config'
import { aiService } from '..'
import { aiSkillService } from './service'
import type {
  AiSkillCreateModelOptionItem,
  AiSkillCreateWithAiInput,
  AiSkillCreateWithAiResult,
  AiSkillCreateWithAiStreamCallbacks,
  AiSkillGeneratedFile
} from './types'

interface GeneratedSkillPayload {
  id?: unknown
  name?: unknown
  description?: unknown
  mode?: unknown
  tags?: unknown
  triggerPhrases?: unknown
  promptTemplate?: unknown
  mcpPolicy?: unknown
  skillMd?: unknown
  skillMarkdown?: unknown
  files?: unknown
}

let cachedSkillCreatorGuide: string | undefined

async function loadBuiltinSkillCreatorGuide(): Promise<string> {
  if (cachedSkillCreatorGuide !== undefined) {
    return cachedSkillCreatorGuide
  }

  const candidates = [
    path.resolve(process.cwd(), 'resources/skills/skill-creator/SKILL.md'),
    path.resolve(__dirname, '../../../../resources/skills/skill-creator/SKILL.md'),
    path.resolve(process.resourcesPath || '', 'resources/skills/skill-creator/SKILL.md'),
    path.resolve(process.resourcesPath || '', 'skills/skill-creator/SKILL.md')
  ].filter(Boolean)

  for (const filePath of candidates) {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const snippet = extractSkillCreatorSnippet(content)
      if (snippet) {
        cachedSkillCreatorGuide = snippet
        return snippet
      }
    } catch {
      // try next candidate
    }
  }

  cachedSkillCreatorGuide = ''
  return ''
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

function normalizeFiles(value: unknown): AiSkillGeneratedFile[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: AiSkillGeneratedFile[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const path = asString(row.path)
    const content = asString(row.content)
    if (!path || content === undefined) continue
    out.push({ path, content })
  }
  return out.length > 0 ? out : undefined
}

function deriveSkillName(requirements: string): string {
  const cleaned = requirements
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
  return cleaned || 'AI Generated Skill'
}

async function buildPrompts(input: AiSkillCreateWithAiInput): Promise<{ systemPrompt: string; userPrompt: string }> {
  const isRevision = Boolean(String(input.previousRawText || '').trim())
  const builtinGuide = await loadBuiltinSkillCreatorGuide()
  const systemPrompt = [
    'You are an expert skill author.',
    'Create or revise a practical AI skill package following Anthropic Skills conventions.',
    'Respond with JSON only (no markdown prose).',
    'Return fields: id, name, description, mode, tags, triggerPhrases, promptTemplate, skillMd, files.',
    'skillMd must start with YAML frontmatter enclosed by --- and include at least "name" and "description".',
    'Prefer kebab-case for name/id. Keep description specific about when to use the skill.',
    'Only include files when needed; paths must stay under scripts/, references/, or assets/.',
    'files is optional and must only contain paths under scripts/, references/, or assets/.',
    'If no files are needed, return "files": [].',
    builtinGuide
      ? `Use this built-in "skill-creator" reference excerpt as hard constraints:\n${builtinGuide}`
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

  const { systemPrompt, userPrompt } = await buildPrompts({ ...input, requirements })
  let generatedText = ''
  try {
    const finalMessage = await aiService.stream(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        skills: { mode: 'off' }
      },
      {
        onChunk: (chunk) => {
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
    const normalizedName = asString(payload.name) || deriveSkillName(requirements)
    const normalizedDescription = asString(payload.description) || `AI generated skill for: ${normalizedName}`
    const normalizedFiles = normalizeFiles(payload.files)
    emitStageStatus(callbacks, currentStage, 'done', '校验完成：准备写入本地目录')

    currentStage = 'writing'
    emitStageStatus(callbacks, currentStage, 'start', '写入中：保存 SKILL.md 与附属文件…')
    const record = await aiSkillService.createFromGenerated({
      id: asString(payload.id),
      replaceSkillId: asString(input.replaceSkillId),
      name: normalizedName,
      description: normalizedDescription,
      mode: normalizeMode(payload.mode),
      tags: asStringArray(payload.tags),
      triggerPhrases: asStringArray(payload.triggerPhrases),
      promptTemplate: asString(payload.promptTemplate),
      mcpPolicy: normalizeMcpPolicy(payload.mcpPolicy),
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
        rawText: generatedText
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
