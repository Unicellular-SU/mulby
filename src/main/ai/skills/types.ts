import type {
  AiOption,
  AiSkillCreateModelOption,
  AiSkillCreateProgressChunk,
  AiSkillMcpPolicy,
  AiSkillRecord,
  AiSkillResolveResult,
  AiSkillTrustLevel
} from '../../../shared/types/ai'

export interface AiSkillCreateInput {
  id?: string
  name: string
  description?: string
  promptTemplate?: string
  tags?: string[]
  triggerPhrases?: string[]
  mode?: 'manual' | 'auto' | 'both'
  internalTools?: string[]
  enabled?: boolean
  trustLevel?: AiSkillTrustLevel
  mcpPolicy?: AiSkillMcpPolicy
}

export interface AiSkillInstallInput {
  source: 'local-dir' | 'zip'
  ref: string
  trustLevel?: AiSkillTrustLevel
  enabled?: boolean
}

export interface AiSkillImportJsonInput {
  json: string
  trustLevel?: AiSkillTrustLevel
  enabled?: boolean
}

export interface AiSkillPreviewInput {
  option?: Partial<AiOption>
  skillIds?: string[]
  prompt?: string
}

export interface AiSkillResolveContext {
  selected: AiSkillRecord[]
  result: AiSkillResolveResult
}

export interface AiSkillGeneratedFile {
  path: string
  content: string
}

export interface AiSkillCreateFromGeneratedInput {
  id?: string
  replaceSkillId?: string
  name: string
  description?: string
  promptTemplate?: string
  tags?: string[]
  triggerPhrases?: string[]
  mode?: 'manual' | 'auto' | 'both'
  internalTools?: string[]
  mcpPolicy?: AiSkillMcpPolicy
  skillMarkdown?: string
  files?: AiSkillGeneratedFile[]
  enabled?: boolean
  trustLevel?: AiSkillTrustLevel
  source?: Exclude<import('../../../shared/types/ai').AiSkillSource, 'system'>
}

export interface AiSkillCreateWithAiInput {
  requirements: string
  model: string
  previousRawText?: string
  replaceSkillId?: string
  enabled?: boolean
  trustLevel?: AiSkillTrustLevel
  modePreference?: 'manual' | 'auto' | 'both'
}

export interface AiSkillCreateWithAiResult {
  record: AiSkillRecord
  generation: {
    model: string
    rawText: string
    notes?: string[]
  }
}

export interface AiSkillCreateModelOptionItem extends AiSkillCreateModelOption {}

export interface AiSkillCreateWithAiStreamCallbacks {
  onChunk?: (chunk: AiSkillCreateProgressChunk) => void
}
