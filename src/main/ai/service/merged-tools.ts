import type { AiOption, AiTool } from '../../../shared/types/ai'

interface ResolveMergedToolsDeps {
  resolveMcpTools: (input: {
    selection: {
      mode?: 'off' | 'manual' | 'auto'
      serverIds?: string[]
      allowedToolIds?: string[]
    }
    context?: AiOption['toolContext']
  }) => Promise<AiTool[]>
}

export async function resolveMergedTools(
  option: AiOption,
  deps: ResolveMergedToolsDeps
): Promise<AiTool[] | undefined> {
  const declaredTools = Array.isArray(option.tools) ? option.tools : []
  const mcpMode = option.mcp ? (option.mcp.mode || 'auto') : 'off'
  if (mcpMode === 'off') {
    return declaredTools.length > 0 ? declaredTools : undefined
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
    declaredToolCount: declaredTools.length
  })
  if (mcpTools.length === 0) {
    console.warn('[AI] resolveMergedTools:mcp returned 0 tools', {
      mode: mcpMode,
      requestedServerIds: option.mcp?.serverIds || [],
      requestedAllowedToolIds: option.mcp?.allowedToolIds || [],
      scopeAllowedServerIds: option.toolContext?.mcpScope?.allowedServerIds || [],
      scopeAllowedToolIds: option.toolContext?.mcpScope?.allowedToolIds || []
    })
  }

  if (declaredTools.length === 0) {
    return mcpTools.length > 0 ? mcpTools : undefined
  }
  if (mcpTools.length === 0) {
    return declaredTools
  }

  const merged = [...declaredTools]
  const knownNames = new Set(
    declaredTools
      .map((item) => item.function?.name)
      .filter((name): name is string => !!name)
  )
  for (const toolItem of mcpTools) {
    const name = toolItem.function?.name
    if (!name) continue
    if (knownNames.has(name)) continue
    merged.push(toolItem)
    knownNames.add(name)
  }
  return merged
}
