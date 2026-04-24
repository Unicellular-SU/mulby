import { jsonSchema, tool } from '@ai-sdk/provider-utils'
import type {
import log from 'electron-log'
  AiCapabilityDebugInfo,
  AiPolicyDebugInfo,
  AiTool,
  AiToolContext
} from '../../../shared/types/ai'
import {
  supportsEmbedding,
  supportsFunctionCalling,
  supportsRerank,
  supportsWebSearch
} from '../modelCapabilities'
import {
  createRuntimeCapabilityIntrospectionSnapshot,
  isRuntimeCapabilityIntrospectionToolName
} from '../tools/runtime-capability-introspection-tool'

export interface BuildToolsInput {
  tools?: AiTool[]
  context?: AiToolContext
  modelId?: string
  capabilityDebug?: AiCapabilityDebugInfo
  policyDebug?: AiPolicyDebugInfo
  abortSignal?: AbortSignal
  toolExecutor?: (input: {
    name: string
    args: unknown
    context?: AiToolContext
    callId?: string
    abortSignal?: AbortSignal
  }) => Promise<unknown>
}

function warnCapabilityKeywordMismatch(modelId: string, tools: AiTool[]): void {
  const toolNames = tools
    .map((item) => item?.type === 'function' ? item.function?.name : undefined)
    .filter((name): name is string => !!name)
    .map((name) => name.toLowerCase())
  const requiresWebSearch = toolNames.some((name) => name.includes('web_search') || name.includes('web-search'))
  const requiresEmbedding = toolNames.some((name) => name.includes('embedding') || name.includes('embed'))
  const requiresRerank = toolNames.some((name) => name.includes('rerank') || name.includes('re-rank'))
  const warnings: string[] = []
  if (requiresWebSearch && !supportsWebSearch(modelId)) warnings.push('web_search')
  if (requiresEmbedding && !supportsEmbedding(modelId)) warnings.push('embedding')
  if (requiresRerank && !supportsRerank(modelId)) warnings.push('rerank')
  if (warnings.length > 0) {
    // Tool name keyword may come from MCP/custom tools; keep function-calling available and avoid hard block.
    log.warn('[AI] buildTools: capability keyword mismatch (allowing custom tool execution)', {
      modelId,
      warnings,
      toolNames
    })
  }
}

function assertExternalToolExecutor(tools: AiTool[], toolExecutor?: BuildToolsInput['toolExecutor']): void {
  const requiresExternalExecutor = tools.some(
    (item) => !isRuntimeCapabilityIntrospectionToolName(String(item.function?.name || ''))
  )
  if (!toolExecutor && requiresExternalExecutor) {
    log.error('[AI] buildTools: toolExecutor 未配置')
    throw new Error('AI tool executor is not configured')
  }
}

export function buildTools(input: BuildToolsInput) {
  const { tools, context, modelId, capabilityDebug, policyDebug, abortSignal, toolExecutor } = input
  if (!tools || tools.length === 0) return undefined
  if (modelId && !supportsFunctionCalling(modelId)) {
    log.info('[AI] buildTools: 模型不支持 function calling', { modelId })
    return undefined
  }
  if (modelId) {
    warnCapabilityKeywordMismatch(modelId, tools)
  }
  assertExternalToolExecutor(tools, toolExecutor)

  log.info('[AI] buildTools: 构建工具', {
    toolCount: tools.length,
    toolNames: tools.map((item) => item.function?.name),
    hasExecutor: !!toolExecutor,
    context
  })
  const toolEntries = tools
    .map((item) => (item?.type === 'function' ? item.function : undefined))
    .filter((item): item is NonNullable<AiTool['function']> => !!item && !!item.name)
    .map((fn) => {
      const schemaBase = fn.parameters || { type: 'object', properties: {} }
      const schema = {
        ...schemaBase,
        required: schemaBase.required || fn.required
      }
      return [
        fn.name,
        tool({
          description: fn.description,
          inputSchema: jsonSchema(schema as unknown as Parameters<typeof jsonSchema>[0]),
          execute: async (toolInput: unknown) => {
            log.info('[AI] 工具执行开始', { toolName: fn.name, input: toolInput, context })
            let result: unknown
            if (isRuntimeCapabilityIntrospectionToolName(fn.name)) {
              result = createRuntimeCapabilityIntrospectionSnapshot({
                tools,
                args: toolInput,
                capabilityDebug,
                policyDebug
              })
            } else {
              if (!toolExecutor) {
                throw new Error('AI tool executor is not configured')
              }
              try {
                result = await toolExecutor({
                  name: fn.name,
                  args: toolInput,
                  context,
                  abortSignal
                })
              } catch (error) {
                if (abortSignal?.aborted) {
                  throw new Error('AI stream aborted by user')
                }
                const message = error instanceof Error ? error.message : String(error)
                log.warn('[AI] 工具执行失败（返回错误结果给模型）', { toolName: fn.name, error: message })
                result = {
                  success: false,
                  error: message,
                  hint: 'Tool execution failed. Please check the arguments format and retry. Arguments must be a valid JSON object.'
                }
              }
            }
            log.info('[AI] 工具执行完成', { toolName: fn.name, result })
            return result
          }
        })
      ] as const
    })

  if (toolEntries.length === 0) return undefined
  return Object.fromEntries(toolEntries)
}
