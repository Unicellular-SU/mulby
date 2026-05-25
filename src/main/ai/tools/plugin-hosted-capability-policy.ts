import type { AiToolCapabilityName } from './capabilities'

export interface CapabilityPolicyLikeResult {
  allowedCapabilities: string[]
  deniedCapabilities?: string[]
  reasons?: string[]
}

const COMMAND_BACKED_CAPABILITIES = new Set<AiToolCapabilityName>([
  'shell.exec',
  'shell.script',
  'git.status',
  'git.diff',
  'patch.apply'
])

export function filterPluginHostedAiCommandCapabilities(input: {
  result: CapabilityPolicyLikeResult
  pluginId: string
  aiCommandAllowed: boolean
}): CapabilityPolicyLikeResult {
  if (input.aiCommandAllowed) return input.result
  const deniedByPlugin = input.result.allowedCapabilities
    .filter((capability): capability is AiToolCapabilityName => COMMAND_BACKED_CAPABILITIES.has(capability as AiToolCapabilityName))
  if (deniedByPlugin.length === 0) return input.result

  return {
    allowedCapabilities: input.result.allowedCapabilities
      .filter((capability) => !COMMAND_BACKED_CAPABILITIES.has(capability as AiToolCapabilityName)),
    deniedCapabilities: [...(input.result.deniedCapabilities || []), ...deniedByPlugin],
    reasons: [
      ...(input.result.reasons || []),
      ...deniedByPlugin.map((capability) => `${capability}: denied because plugin ${input.pluginId} lacks permissions.commandExecution.ai.enabled`)
    ]
  }
}
