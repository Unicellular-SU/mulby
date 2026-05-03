import { getRotatedApiKey } from '../../../shared/ai/apiKeyPool'
import type {
  AiCapabilityDebugInfo,
  AiMessage,
  AiModelParameters,
  AiOption,
  AiPolicyDebugInfo,
  AiProviderConfig,
  AiSkillSelectionMeta,
  AiTool,
  AiToolContext
} from '../../../shared/types/ai'
import { resolveModelId } from '../models'
import type { ProviderMethodAdapter } from '../providerMethodAdapters'
import { getProviderMethodAdapter } from '../providerMethodAdapters'
import { aiSkillService } from '../skills'
import { shouldUseCompatToolLoop } from '../toolLoopStrategy'
import { ensureRuntimeCapabilityIntrospectionTool } from '../tools/runtime-capability-introspection-tool'
import type { InjectedInternalToolResult } from './capability-injection'
import { resolveGenerationParams as resolveGenerationParamsHelper } from './generation-params'
import { resolveExecutionProviderContext as resolveExecutionProviderContextHelper } from './provider-helpers'
import { buildApiKeyScope } from './utils'
import { hasMultimodalContent as hasMultimodalContentHelper } from './stream-helpers'

export type AiSkillResolution = ReturnType<typeof aiSkillService.resolveForAiCall>

export interface PrepareChatRequestInput {
  option: AiOption
  controllerSignal: AbortSignal
  injectInternalRuntimeTools: (input: {
    option: AiOption
    skillCapabilities?: string[]
    skillInternalTools?: string[]
    selectedSkills?: AiSkillSelectionMeta[]
  }) => InjectedInternalToolResult
  buildPolicyDebugInfo: (input: {
    requestedOption: AiOption
    effectiveOption: AiOption
    skillResolution: AiSkillResolution
  }) => AiPolicyDebugInfo
  resolveMergedTools: (option: AiOption) => Promise<AiTool[] | undefined>
  buildTools: (
    tools?: AiTool[],
    context?: AiToolContext,
    modelId?: string,
    capabilityDebug?: AiCapabilityDebugInfo,
    policyDebug?: AiPolicyDebugInfo,
    abortSignal?: AbortSignal,
    onToolProgress?: (progress: { id?: string; name: string; progress: number; total?: number; message?: string }) => void
  ) => unknown
  resolveLanguageModel: (modelId?: string) => { model: string; modelKey: unknown }
  applyContextWindow: (messages: AiMessage[], limit?: number) => AiMessage[]
}

export interface PreparedChatRequest {
  skillResolution: AiSkillResolution
  effective: InjectedInternalToolResult
  effectiveOption: AiOption
  policyDebug: AiPolicyDebugInfo
  resolvedTools?: AiTool[]
  introspectionReadyTools?: AiTool[]
  tools?: unknown
  modelKey: unknown
  params: AiModelParameters
  trimmedMessages: AiMessage[]
  resolvedModelId: string
  providerType: string
  providerConfig?: AiProviderConfig
  requestApiKey?: string
  methodAdapter: ProviderMethodAdapter
  hasTools: boolean
  hasMultimodalContent: boolean
  compatToolLoop: boolean
}

export async function prepareChatRequest(input: PrepareChatRequestInput): Promise<PreparedChatRequest> {
  await aiSkillService.ensureCatalogLoaded()
  const skillResolution = aiSkillService.resolveForAiCall(input.option)
  const resolvedOption = aiSkillService.applyResolutionToOption(input.option, skillResolution)
  const effective = input.injectInternalRuntimeTools({
    option: resolvedOption,
    skillCapabilities: skillResolution.capabilities,
    skillInternalTools: skillResolution.internalTools,
    selectedSkills: skillResolution.selectedSkills
  })
  const effectiveOption = effective.option
  const policyDebug = input.buildPolicyDebugInfo({
    requestedOption: input.option,
    effectiveOption,
    skillResolution
  })

  const resolvedTools = await input.resolveMergedTools(effectiveOption)
  const introspectionReadyTools = ensureRuntimeCapabilityIntrospectionTool(resolvedTools)
  const tools = input.buildTools(
    introspectionReadyTools,
    effectiveOption.toolContext,
    effectiveOption.model,
    effective.capabilityDebug,
    policyDebug,
    input.controllerSignal
  )

  const { modelKey } = input.resolveLanguageModel(effectiveOption.model)
  const params = resolveGenerationParamsHelper(effectiveOption, effectiveOption.model)
  const trimmedMessages = input.applyContextWindow(effectiveOption.messages, params.contextWindow)
  const resolved = resolveModelId(effectiveOption.model)
  const { providerType, providerConfig } = resolveExecutionProviderContextHelper({
    modelId: effectiveOption.model,
    providerIdOverride: resolved.providerId
  })
  const requestApiKey = getRotatedApiKey(
    providerConfig?.apiKey,
    buildApiKeyScope({
      providerId: providerConfig?.id ? String(providerConfig.id) : undefined,
      providerType,
      baseURL: providerConfig?.baseURL
    })
  )
  const methodAdapter = getProviderMethodAdapter(providerType)
  const hasTools = !!tools
  const hasMultimodalContent = hasMultimodalContentHelper(trimmedMessages)
  const compatToolLoop = shouldUseCompatToolLoop(effectiveOption.model, providerConfig)

  return {
    skillResolution,
    effective,
    effectiveOption,
    policyDebug,
    resolvedTools,
    introspectionReadyTools,
    tools,
    modelKey,
    params,
    trimmedMessages,
    resolvedModelId: resolved.modelId,
    providerType,
    providerConfig,
    requestApiKey,
    methodAdapter,
    hasTools,
    hasMultimodalContent,
    compatToolLoop
  }
}
