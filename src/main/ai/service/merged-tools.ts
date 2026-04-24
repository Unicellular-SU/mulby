import type { AiOption, AiTool } from '../../../shared/types/ai'
import log from 'electron-log'

interface ResolveMergedToolsDeps {
  resolveMcpTools: (input: {
    selection: {
      mode?: 'off' | 'manual' | 'auto'
      serverIds?: string[]
      allowedToolIds?: string[]
    }
    context?: AiOption['toolContext']
  }) => Promise<AiTool[]>
  resolvePluginTools?: () => AiTool[]
}

export async function resolveMergedTools(
  option: AiOption,
  deps: ResolveMergedToolsDeps
): Promise<AiTool[] | undefined> {
  const declaredTools = Array.isArray(option.tools) ? option.tools : []
  // 当调用方明确禁用工具（enableInternalTools: false）时，不注入插件工具
  const pluginTools = option.toolingPolicy?.enableInternalTools === false
    ? []
    : (deps.resolvePluginTools?.() || [])
  const mcpMode = option.mcp ? (option.mcp.mode || 'auto') : 'off'

  // MCP 关闭时，仍需合并 declared + plugin tools
  if (mcpMode === 'off') {
    if (declaredTools.length === 0 && pluginTools.length === 0) {
      return undefined
    }
    return mergeToolLists(declaredTools, [], pluginTools)
  }

  const mcpTools = await deps.resolveMcpTools({
    selection: {
      ...option.mcp,
      mode: mcpMode
    },
    context: option.toolContext
  })
  console.info('[AI] resolveMergedTools:mcp', {
    mode: mcpMode,
    requestedServerIds: option.mcp?.serverIds || [],
    requestedAllowedToolIds: option.mcp?.allowedToolIds?.length || 0,
    scopeAllowedServerIds: option.toolContext?.mcpScope?.allowedServerIds || [],
    scopeAllowedToolIds: option.toolContext?.mcpScope?.allowedToolIds?.length || 0,
    resolvedMcpToolCount: mcpTools.length,
    pluginToolCount: pluginTools.length,
    declaredToolCount: declaredTools.length
  })
  if (mcpTools.length === 0) {
    log.warn('[AI] resolveMergedTools:mcp returned 0 tools', {
      mode: mcpMode,
      requestedServerIds: option.mcp?.serverIds || [],
      requestedAllowedToolIds: option.mcp?.allowedToolIds || [],
      scopeAllowedServerIds: option.toolContext?.mcpScope?.allowedServerIds || [],
      scopeAllowedToolIds: option.toolContext?.mcpScope?.allowedToolIds || []
    })
  }

  if (declaredTools.length === 0 && mcpTools.length === 0 && pluginTools.length === 0) {
    return undefined
  }

  return mergeToolLists(declaredTools, mcpTools, pluginTools)
}

/**
 * 合并工具列表，按优先级去重: declared > MCP > plugin tools
 * 同名时高优先级覆盖低优先级
 */
function mergeToolLists(declaredTools: AiTool[], mcpTools: AiTool[], pluginTools: AiTool[]): AiTool[] | undefined {
  const merged: AiTool[] = []
  const knownNames = new Set<string>()

  // 优先级 1: declared tools（来自 AiOption.tools 或 internal tools）
  for (const tool of declaredTools) {
    const name = tool.function?.name
    if (!name || knownNames.has(name)) continue
    merged.push(tool)
    knownNames.add(name)
  }

  // 优先级 2: MCP tools
  for (const tool of mcpTools) {
    const name = tool.function?.name
    if (!name || knownNames.has(name)) continue
    merged.push(tool)
    knownNames.add(name)
  }

  // 优先级 3: Plugin tools
  for (const tool of pluginTools) {
    const name = tool.function?.name
    if (!name || knownNames.has(name)) continue
    merged.push(tool)
    knownNames.add(name)
  }

  return merged.length > 0 ? merged : undefined
}
