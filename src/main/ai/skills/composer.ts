import type { AiMessage, AiModel, AiSettings } from '../../../shared/types/ai'
import { getAiSettings } from '../config'
import { aiService } from '..'
import { aiSkillService } from './service'
import type { AiSkillCreateModelOptionItem, AiSkillCreateWithAiInput, AiSkillCreateWithAiResult } from './types'

interface GeneratedSkillPayload {
  id?: string
  name?: string
  description?: string
  mode?: 'manual' | 'auto' | 'both'
  tags?: string[]
  triggerPhrases?: string[]
  promptTemplate?: string
  mcpPolicy?: {
    serverIds?: string[]
    allowedToolIds?: string[]
    blockedToolIds?: string[]
  }
  skillMd?: string
  skillMarkdown?: string
  files?: Array<{
    path: string
    content: string
  }>
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

function deriveSkillName(requirements: string): string {
  const cleaned = requirements
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
  return cleaned || 'AI Generated Skill'
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

export async function createSkillWithAi(input: AiSkillCreateWithAiInput): Promise<AiSkillCreateWithAiResult> {
  const requirements = String(input.requirements || '').trim()
  const model = String(input.model || '').trim()
  if (!requirements) {
    throw new Error('Skill 需求不能为空')
  }
  if (!model) {
    throw new Error('请选择用于创建 Skill 的模型')
  }

  const systemPrompt = [
    'You are an expert skill author.',
    'Create a practical AI skill package following SKILL.md conventions.',
    'Respond with JSON only (no markdown prose).',
    'Return fields: id, name, description, mode, tags, triggerPhrases, promptTemplate, skillMd, files.',
    'files is optional and must only contain paths under scripts/, references/, or assets/.'
  ].join('\n')
  const userPrompt = [
    `User requirements:\n${requirements}`,
    `Preferred mode: ${input.modePreference || 'both'}`,
    'Output strict JSON.'
  ].join('\n\n')

  const message = await aiService.call({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    skills: { mode: 'off' }
  })

  const rawText = normalizeTextFromMessage(message)
  const payload = extractJsonPayload(rawText)
  const record = await aiSkillService.createFromGenerated({
    id: payload.id,
    name: String(payload.name || '').trim() || deriveSkillName(requirements),
    description: payload.description,
    mode: payload.mode,
    tags: payload.tags,
    triggerPhrases: payload.triggerPhrases,
    promptTemplate: payload.promptTemplate,
    mcpPolicy: payload.mcpPolicy,
    skillMarkdown: payload.skillMd || payload.skillMarkdown,
    files: payload.files,
    enabled: input.enabled ?? false,
    trustLevel: input.trustLevel ?? 'reviewed',
    source: 'manual'
  })

  return {
    record,
    generation: {
      model,
      rawText
    }
  }
}
