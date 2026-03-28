import { AiService } from './service'
import type { AiOption, AiSkillSelectionMeta, AiTool } from '../../shared/types/ai'
import type { AiToolCapabilityName } from './tools/capabilities'

export const aiService = new AiService()

export function setAiToolExecutor(
  executor?: (input: {
    name: string
    args: unknown
    context?: import('../../shared/types/ai').AiToolContext
    callId?: string
    abortSignal?: AbortSignal
  }) => Promise<unknown>
) {
  aiService.setToolExecutor(executor)
}

export function setAiCapabilityPolicyResolver(
  resolver?: (input: {
    option: AiOption
    requestedCapabilities: AiToolCapabilityName[]
    selectedSkills?: AiSkillSelectionMeta[]
  }) => { allowedCapabilities: string[]; deniedCapabilities?: string[]; reasons?: string[] }
) {
  aiService.setCapabilityPolicyResolver(resolver)
}

export function setAiPluginToolResolver(resolver?: () => AiTool[]): void {
  aiService.setPluginToolResolver(resolver)
}

export function setAiSkillActivationScopeManager(manager?: {
  create: (requestId: string) => void
  cleanup: (requestId: string) => void
}): void {
  aiService.setSkillActivationScopeManager(manager)
}

