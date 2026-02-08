import type {
  AiMessage,
  AiModel,
  AiTool,
  AiSettings,
  AiSkillCreateProgressChunk,
  AiSkillCreateStage
} from '../../../shared/types/ai'
import { getAiSettings } from '../config'
import { aiService } from '..'
import { aiSkillService } from './service'
import {
  AI_SKILL_CREATOR_INTERNAL_TAG,
  AI_SKILL_CREATOR_TOOL_NAME,
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

function buildSkillCreatorTools(pack: SkillCreatorResourcePack | null): AiTool[] {
  if (!pack) return []
  return [
    {
      type: 'function',
      function: {
        name: AI_SKILL_CREATOR_TOOL_NAME,
        description: [
          'Run local script commands for skill scaffolding/validation.',
          `Only supports scripts under ${pack.rootPath}/scripts.`,
          'Use python3/node/bash with explicit script path as first non-flag arg.'
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Executable name or path, e.g. python3/node/bash'
            },
            args: {
              type: 'array',
              description: 'Command arguments',
              items: {
                type: 'string'
              }
            },
            cwd: {
              type: 'string',
              description: 'Optional working directory (defaults to skill-creator root)'
            },
            timeoutMs: {
              type: 'number',
              description: 'Optional timeout in milliseconds'
            },
            shell: {
              type: 'boolean',
              description: 'Optional shell mode. Default false.'
            }
          }
        },
        required: ['command']
      }
    }
  ]
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

async function buildPrompts(
  input: AiSkillCreateWithAiInput,
  pack: SkillCreatorResourcePack | null
): Promise<{ systemPrompt: string; userPrompt: string }> {
  const isRevision = Boolean(String(input.previousRawText || '').trim())
  const builtinGuide = buildSkillCreatorContext(pack)
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
    'When using command tool, execute only deterministic local scripts and use result to improve output quality.',
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

  const { systemPrompt, userPrompt } = await buildPrompts({ ...input, requirements }, skillCreatorPack)
  const tools = buildSkillCreatorTools(skillCreatorPack)
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
        tools: tools.length > 0 ? tools : undefined,
        maxToolSteps: 8,
        toolContext: {
          internalTag: AI_SKILL_CREATOR_INTERNAL_TAG
        }
      },
      {
        onChunk: (chunk) => {
          if (chunk.chunkType === 'tool-call') {
            const callName = chunk.tool_call?.name
            if (callName === AI_SKILL_CREATOR_TOOL_NAME) {
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
            if (resultName === AI_SKILL_CREATOR_TOOL_NAME) {
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
