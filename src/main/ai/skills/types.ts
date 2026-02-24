import type {
  AiOption,
  AiSkillMulbyExtensions,
  AiSkillMcpPolicy,
  AiSkillRecord,
  AiSkillResolveResult,
  AiSkillTrustLevel
} from '../../../shared/types/ai'

export interface AiSkillCreateInput {
  id?: string
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
  metadataMulby?: AiSkillMulbyExtensions
  promptTemplate?: string
  enabled?: boolean
  trustLevel?: AiSkillTrustLevel
  /**
   * @deprecated Use metadataMulby.
   */
  triggerPhrases?: string[]
  /**
   * @deprecated Use metadataMulby.
   */
  mode?: 'manual' | 'auto' | 'both'
  /**
   * @deprecated Use metadataMulby.
   */
  capabilities?: string[]
  /**
   * @deprecated Use metadataMulby.capabilities.
   */
  internalTools?: string[]
  /**
   * @deprecated Use metadataMulby.
   */
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
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
  metadataMulby?: AiSkillMulbyExtensions
  promptTemplate?: string
  skillMarkdown?: string
  files?: AiSkillGeneratedFile[]
  enabled?: boolean
  trustLevel?: AiSkillTrustLevel
  source?: Exclude<import('../../../shared/types/ai').AiSkillSource, 'system'>
  /**
   * @deprecated Use metadataMulby.
   */
  triggerPhrases?: string[]
  /**
   * @deprecated Use metadataMulby.
   */
  mode?: 'manual' | 'auto' | 'both'
  /**
   * @deprecated Use metadataMulby.
   */
  capabilities?: string[]
  /**
   * @deprecated Use metadataMulby.capabilities.
   */
  internalTools?: string[]
  /**
   * @deprecated Use metadataMulby.
   */
  mcpPolicy?: AiSkillMcpPolicy
}
