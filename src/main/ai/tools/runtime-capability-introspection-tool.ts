import type { AiCapabilityDebugInfo, AiPolicyDebugInfo, AiTool } from '../../../shared/types/ai'
import { isAiInternalToolName } from './internal-tools'

export const AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME = 'intools_describe_runtime_capabilities'

const MAX_TOOLS_HARD_LIMIT = 500
const MAX_DESCRIPTION_LENGTH = 160

interface IntrospectionArgs {
  includeSchemas: boolean
  includePolicyDebug: boolean
  maxTools: number
}

interface RuntimeToolView {
  name: string
  source: 'meta' | 'internal' | 'mcp' | 'custom'
  brief: string
  serverId?: string
  toolName?: string
  requiredArgs?: string[]
  inputSchema?: unknown
}

function toShortDescription(input: string | undefined, fallback: string): string {
  const normalized = String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return fallback
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 3).trimEnd()}...`
}

function parseMcpToolId(name: string): { serverId: string; toolName: string } | null {
  const value = String(name || '').trim()
  if (!value.startsWith('mcp__')) return null
  const raw = value.slice('mcp__'.length)
  const separatorIndex = raw.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 2) return null
  return {
    serverId: raw.slice(0, separatorIndex),
    toolName: raw.slice(separatorIndex + 2)
  }
}

function normalizeIntrospectionArgs(args: unknown): IntrospectionArgs {
  let source: Record<string, unknown> = {}
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    source = args as Record<string, unknown>
  }
  const includeSchemas = source.includeSchemas === true
  const includePolicyDebug = source.includePolicyDebug === true
  const maxToolsRaw = Number(source.maxTools)
  const maxTools = Number.isFinite(maxToolsRaw) && maxToolsRaw > 0
    ? Math.min(Math.floor(maxToolsRaw), MAX_TOOLS_HARD_LIMIT)
    : 200
  return {
    includeSchemas,
    includePolicyDebug,
    maxTools
  }
}

function toRuntimeToolView(tool: AiTool, includeSchemas: boolean): RuntimeToolView | null {
  const fn = tool.type === 'function' ? tool.function : undefined
  const name = String(fn?.name || '').trim()
  if (!name) return null

  const mcp = parseMcpToolId(name)
  const source: RuntimeToolView['source'] = name === AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME
    ? 'meta'
    : mcp
      ? 'mcp'
      : isAiInternalToolName(name)
        ? 'internal'
        : 'custom'
  const requiredArgs = Array.isArray(fn?.parameters?.required)
    ? fn.parameters.required.map((item) => String(item || '')).filter(Boolean)
    : undefined

  const fallback = source === 'mcp'
    ? `[MCP:${mcp?.serverId}] ${mcp?.toolName}`
    : source === 'internal'
      ? 'Built-in runtime tool'
      : source === 'meta'
        ? 'Inspect effective tooling, MCP scope, and selected skills'
        : 'Custom tool'

  return {
    name,
    source,
    brief: toShortDescription(fn?.description, fallback),
    serverId: mcp?.serverId,
    toolName: mcp?.toolName,
    requiredArgs: requiredArgs && requiredArgs.length > 0 ? requiredArgs : undefined,
    inputSchema: includeSchemas ? fn?.parameters : undefined
  }
}

function uniqueByName(input: RuntimeToolView[]): RuntimeToolView[] {
  const out: RuntimeToolView[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    out.push(item)
  }
  return out
}

export function isRuntimeCapabilityIntrospectionToolName(name: string): boolean {
  return String(name || '').trim() === AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME
}

export function buildAiRuntimeCapabilityIntrospectionTool(): AiTool {
  return {
    type: 'function',
    function: {
      name: AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME,
      description: [
        'Inspect current callable capabilities before planning.',
        'Returns current available tools, MCP scope/selection, selected skills, and capability policy summary.'
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxTools: { type: 'number', description: 'Maximum number of tools to return. Default 200.' },
          includeSchemas: { type: 'boolean', description: 'Include input schemas for each tool.' },
          includePolicyDebug: { type: 'boolean', description: 'Include full policy_debug payload.' }
        }
      }
    }
  }
}

export function ensureRuntimeCapabilityIntrospectionTool(tools?: AiTool[]): AiTool[] | undefined {
  if (!tools || tools.length === 0) return tools
  const exists = tools.some(
    (tool) => tool.type === 'function' && tool.function?.name === AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME
  )
  if (exists) return tools
  return [...tools, buildAiRuntimeCapabilityIntrospectionTool()]
}

export function createRuntimeCapabilityIntrospectionSnapshot(input: {
  tools?: AiTool[]
  args?: unknown
  capabilityDebug?: AiCapabilityDebugInfo
  policyDebug?: AiPolicyDebugInfo
}): Record<string, unknown> {
  const args = normalizeIntrospectionArgs(input.args)
  const tools = uniqueByName(
    (Array.isArray(input.tools) ? input.tools : [])
      .map((item) => toRuntimeToolView(item, args.includeSchemas))
      .filter((item): item is RuntimeToolView => !!item)
  )
  const limitedTools = tools.slice(0, args.maxTools)

  const mcpTools = limitedTools.filter((item) => item.source === 'mcp')
  const internalTools = limitedTools.filter((item) => item.source === 'internal')
  const customTools = limitedTools.filter((item) => item.source === 'custom')
  const metaTools = limitedTools.filter((item) => item.source === 'meta')

  const mcpServerMap = new Map<string, number>()
  for (const tool of mcpTools) {
    const serverId = String(tool.serverId || '').trim()
    if (!serverId) continue
    mcpServerMap.set(serverId, (mcpServerMap.get(serverId) || 0) + 1)
  }
  const mcpServers = [...mcpServerMap.entries()].map(([serverId, toolCount]) => ({ serverId, toolCount }))

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    summary: {
      totalTools: limitedTools.length,
      internalToolCount: internalTools.length,
      mcpToolCount: mcpTools.length,
      customToolCount: customTools.length,
      metaToolCount: metaTools.length,
      selectedSkillCount: input.policyDebug?.skills?.selectedSkillIds?.length || 0,
      mcpMode: input.policyDebug?.mcp?.resolved?.mode || 'off'
    },
    tools: limitedTools,
    mcp: {
      mode: input.policyDebug?.mcp?.resolved?.mode || 'off',
      selectedServerIds: input.policyDebug?.mcp?.resolved?.serverIds || [],
      scopedServerIds: input.policyDebug?.toolContext?.resolved?.mcpScope?.allowedServerIds || [],
      allowedToolIds: input.policyDebug?.mcp?.resolved?.allowedToolIds || [],
      scopedAllowedToolIds: input.policyDebug?.toolContext?.resolved?.mcpScope?.allowedToolIds || [],
      discoveredServers: mcpServers
    },
    skills: {
      selectedSkillIds: input.policyDebug?.skills?.selectedSkillIds || [],
      selectedSkillNames: input.policyDebug?.skills?.selectedSkillNames || [],
      reasons: input.policyDebug?.skills?.reasons || []
    },
    capabilities: input.capabilityDebug
      ? {
          requested: input.capabilityDebug.requested || [],
          allowed: input.capabilityDebug.allowed || [],
          denied: input.capabilityDebug.denied || [],
          reasons: input.capabilityDebug.reasons || []
        }
      : undefined,
    policyDebug: args.includePolicyDebug ? (input.policyDebug || undefined) : undefined,
    guidance: [
      'Use this snapshot to plan with currently callable tools only.',
      'Prefer tools listed in `tools` and respect `mcp.allowedToolIds` and scope constraints.',
      'If a needed capability is missing, ask for settings/skill updates instead of assuming access.'
    ]
  }
}
