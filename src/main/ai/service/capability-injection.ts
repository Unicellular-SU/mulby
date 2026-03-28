import type {
  AiCapabilityDebugInfo,
  AiMessage,
  AiOption,
  AiSkillSelectionMeta
} from '../../../shared/types/ai'
import { AI_RUN_COMMAND_TOOL_NAME } from '../tools/run-command-tool'
import { buildAiInternalTools, type AiInternalToolName } from '../tools/internal-tools'
import {
  mapCapabilitiesToInternalToolNames,
  mapInternalToolsToCapabilities,
  normalizeAiToolCapabilityNames,
  type AiToolCapabilityName
} from '../tools/capabilities'
import { resolveAiCapabilityPolicy } from '../tools/capability-policy'

export interface InjectedInternalToolResult {
  option: AiOption
  capabilityDebug: AiCapabilityDebugInfo
}

interface CapabilityDecision {
  allowedCapabilities: AiToolCapabilityName[]
  deniedCapabilities: AiToolCapabilityName[]
  reasons: string[]
}

export type CapabilityPolicyResolver = (input: {
  option: AiOption
  requestedCapabilities: AiToolCapabilityName[]
  selectedSkills?: AiSkillSelectionMeta[]
}) => { allowedCapabilities: string[]; deniedCapabilities?: string[]; reasons?: string[] }

interface InjectInternalRuntimeToolsDeps {
  capabilityPolicyResolver?: CapabilityPolicyResolver
}

interface InjectInternalRuntimeToolsInput {
  option: AiOption
  skillCapabilities?: string[]
  skillInternalTools?: string[]
  selectedSkills?: AiSkillSelectionMeta[]
}

function shouldAutoInjectRunCommandByIntent(messages: AiMessage[]): boolean {
  const hints = [
    'run command',
    'execute command',
    'run the command',
    'shell command',
    '```bash',
    '```sh',
    'npx ',
    '执行命令',
    '运行命令'
  ]
  for (const message of messages) {
    const chunks: string[] = []
    if (typeof message.content === 'string') {
      chunks.push(message.content.toLowerCase())
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type !== 'text') continue
        const text = String(part.text || '').toLowerCase()
        if (text) chunks.push(text)
      }
    }
    if (chunks.some((text) => hints.some((hint) => text.includes(hint)))) {
      return true
    }
  }
  return false
}

function resolveCapabilityDecision(
  input: {
    option: AiOption
    requestedCapabilities: AiToolCapabilityName[]
    selectedSkills?: AiSkillSelectionMeta[]
  },
  deps: InjectInternalRuntimeToolsDeps
): CapabilityDecision {
  const resolved = deps.capabilityPolicyResolver
    ? deps.capabilityPolicyResolver(input)
    : resolveAiCapabilityPolicy({
        option: input.option,
        requestedCapabilities: input.requestedCapabilities,
        selectedSkills: input.selectedSkills
      })
  return {
    allowedCapabilities: normalizeAiToolCapabilityNames(resolved.allowedCapabilities || []),
    deniedCapabilities: normalizeAiToolCapabilityNames(resolved.deniedCapabilities || []),
    reasons: Array.isArray(resolved.reasons)
      ? resolved.reasons.map((item) => String(item || '').trim()).filter(Boolean)
      : []
  }
}

export function injectInternalRuntimeTools(
  input: InjectInternalRuntimeToolsInput,
  deps: InjectInternalRuntimeToolsDeps
): InjectedInternalToolResult {
  const { option } = input
  const optionRequestedCapabilities = normalizeAiToolCapabilityNames(option.capabilities || [])
  const skillRequestedCapabilities = normalizeAiToolCapabilityNames(input.skillCapabilities || [])
  const legacyOptionCapabilities = mapInternalToolsToCapabilities(option.internalTools || [])
  const legacySkillCapabilities = mapInternalToolsToCapabilities(input.skillInternalTools || [])

  // ── Primary capabilities: from the caller/option (NOT from skills) ──
  // These determine whether the default capability baseline is used.
  // If empty (and no custom tools), resolveAiCapabilityPolicy adds ALL defaults.
  const primaryRequestedCapabilities: AiToolCapabilityName[] = normalizeAiToolCapabilityNames([
    ...optionRequestedCapabilities,
    ...legacyOptionCapabilities
  ])

  // ── Additive skill capabilities: ALWAYS merged on top of defaults ──
  // These should NOT suppress the default baseline. For example, progressive
  // disclosure adds 'skill.activate' — this must coexist with all default
  // tools (shell, fs, git, etc.), not replace them.
  // Legacy skill internalTools are also additive for the same reason.
  const additiveSkillCapabilities = normalizeAiToolCapabilityNames([
    ...skillRequestedCapabilities,
    ...legacySkillCapabilities
  ])

  const hasDeclaredTools = Array.isArray(option.tools) && option.tools.length > 0
  const fallbackRequested = primaryRequestedCapabilities.length === 0 &&
    !hasDeclaredTools &&
    option.toolingPolicy?.enableInternalTools !== false &&
    shouldAutoInjectRunCommandByIntent(option.messages)
  const withFallback = fallbackRequested ? normalizeAiToolCapabilityNames(['shell.exec']) : primaryRequestedCapabilities

  // Resolve policy against the primary capabilities (which may include
  // baseline defaults via resolveAiCapabilityPolicy's own fallback).
  const capabilityDecision = resolveCapabilityDecision({
    option,
    requestedCapabilities: withFallback,
    selectedSkills: input.selectedSkills
  }, deps)

  // Merge additive skill capabilities into the allowed set.
  // They go through a separate policy check to respect deny lists.
  const additiveDecision = additiveSkillCapabilities.length > 0
    ? resolveCapabilityDecision({
        option,
        requestedCapabilities: additiveSkillCapabilities,
        selectedSkills: input.selectedSkills
      }, deps)
    : { allowedCapabilities: [] as AiToolCapabilityName[], deniedCapabilities: [] as AiToolCapabilityName[], reasons: [] as string[] }

  const mergedAllowed = normalizeAiToolCapabilityNames([
    ...capabilityDecision.allowedCapabilities,
    ...additiveDecision.allowedCapabilities
  ])
  const mergedDenied = normalizeAiToolCapabilityNames([
    ...capabilityDecision.deniedCapabilities,
    ...additiveDecision.deniedCapabilities
  ])
  const mergedReasons = [
    ...capabilityDecision.reasons,
    ...additiveDecision.reasons,
    ...(fallbackRequested ? ['shell.exec requested by intent fallback'] : [])
  ]

  const capabilityDebug: AiCapabilityDebugInfo = {
    requested: normalizeAiToolCapabilityNames([...withFallback, ...additiveSkillCapabilities]),
    allowed: mergedAllowed,
    denied: mergedDenied,
    reasons: mergedReasons,
    selectedSkills: input.selectedSkills && input.selectedSkills.length > 0
      ? input.selectedSkills
      : undefined
  }

  const requestedTools: AiInternalToolName[] = mapCapabilitiesToInternalToolNames(mergedAllowed)
  if (requestedTools.length === 0) {
    return {
      option: {
        ...option,
        capabilities: mergedAllowed,
        internalTools: requestedTools
      },
      capabilityDebug
    }
  }

  const existingTools = Array.isArray(option.tools) ? option.tools : []
  const knownNames = new Set(
    existingTools
      .map((item) => item.function?.name)
      .filter((name): name is string => !!name)
  )
  const missing = requestedTools.filter((name) => !knownNames.has(name))
  const injectedTools = missing.length > 0 ? buildAiInternalTools(missing) : []
  const needsRunCommandGuidance = requestedTools.includes(AI_RUN_COMMAND_TOOL_NAME)
  const hasGuidance = option.messages.some((message) => {
    if (message.role !== 'system') return false
    if (typeof message.content !== 'string') return false
    return message.content.includes(`"${AI_RUN_COMMAND_TOOL_NAME}"`)
  })
  const messages = needsRunCommandGuidance && !hasGuidance
    ? [{
        role: 'system' as const,
        content: [
          'Tool runtime instruction:',
          `- If a task requires command execution, call "${AI_RUN_COMMAND_TOOL_NAME}" directly.`,
          '- Do not ask user to run commands manually.',
          '- After command execution, analyze stdout/stderr and continue when needed.',
          '- If blocked/failed, explain reason and provide fallback.'
        ].join('\n')
      }, ...option.messages]
    : option.messages

  return {
    option: {
      ...option,
      messages,
      tools: [...existingTools, ...injectedTools],
      capabilities: mergedAllowed,
      internalTools: requestedTools
    },
    capabilityDebug
  }
}
