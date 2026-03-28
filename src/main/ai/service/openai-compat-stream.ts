import type {
  AiCapabilityDebugInfo,
  AiMessage,
  AiModelParameters,
  AiOption,
  AiPolicyDebugInfo,
  AiTool,
  AiToolContext
} from '../../../shared/types/ai'
import { supportsReasoning } from '../modelCapabilities'
import { getRotatedApiKey } from '../../../shared/ai/apiKeyPool'
import {
  buildApiKeyScope,
  extractOpenAICompatContentText,
  extractUsage,
  parseCompatToolCallArgs,
  pickOpenAICompatContentSource,
  resolveMaxToolSteps,
  stringifyToolResult
} from './utils'
import {
  createThinkTagStreamState,
  finalizeThinkTagStream,
  parseThinkTaggedChunk
} from '../thinkTagParser'
import {
  createRuntimeCapabilityIntrospectionSnapshot,
  isRuntimeCapabilityIntrospectionToolName
} from '../tools/runtime-capability-introspection-tool'
import { resolveCompatToolCallName } from '../tool-name-matching'
import { isMcpToolName } from '../mcp'

/**
 * 将 reader.read() 与 AbortSignal 竞争：
 * 当 abort 触发时立刻 cancel reader 并 throw，不等轮询检查。
 */
async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSignal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!abortSignal) return reader.read()
  if (abortSignal.aborted) {
    await reader.cancel().catch(() => {})
    throw new Error('AI stream aborted by user')
  }
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const onAbort = () => {
      reader.cancel().catch(() => {}).finally(() => {
        reject(new Error('AI stream aborted by user'))
      })
    }
    abortSignal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (result) => {
        abortSignal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (err) => {
        abortSignal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

export interface OpenAICompatContext {
  resolveCompatBaseURL: (explicitBaseURL?: string, providerType?: string) => string
  resolveGenerationParams: (option: AiOption, modelId?: string) => AiModelParameters
  assertNotAborted: (abortSignal?: AbortSignal) => void
  emitReasoningChunk: (onChunk: ((chunk: AiMessage) => void) | undefined, text: string) => void
  emitTextChunk: (onChunk: ((chunk: AiMessage) => void) | undefined, text: string) => void
  emitToolCallChunk: (
    onChunk: ((chunk: AiMessage) => void) | undefined,
    toolCall: { id: string; name: string; args?: unknown }
  ) => void
  emitToolResultChunk: (
    onChunk: ((chunk: AiMessage) => void) | undefined,
    toolResult: { id: string; name: string; result?: unknown }
  ) => void
  trackMcpCall: (requestId: string | undefined, callId: string | undefined) => void
  untrackMcpCall: (requestId: string | undefined, callId: string | undefined) => void
  toolExecutor?: (input: {
    name: string
    args: unknown
    context?: AiToolContext
    callId?: string
    abortSignal?: AbortSignal
  }) => Promise<unknown>
}

export async function streamOpenAICompat(
  context: OpenAICompatContext,
  input: { model?: string; providerId?: string; providerType?: string; apiKey?: string; baseURL?: string },
  onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
): Promise<{ content: string; reasoning: string }> {
  const allowReasoning = supportsReasoning(input.model)
  const baseURL = context.resolveCompatBaseURL(input.baseURL, input.providerType || input.providerId)
  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`
  const modelId = input.model?.includes(':') ? input.model.split(':', 2)[1] : input.model
  if (!modelId) {
    throw new Error('Model is required for provider test')
  }

  const params = context.resolveGenerationParams({ model: input?.model, messages: [] }, input?.model)
  const requestApiKey = getRotatedApiKey(
    input.apiKey,
    buildApiKeyScope({
      providerId: input.providerId,
      providerType: input.providerType,
      baseURL: input.baseURL
    })
  )
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(requestApiKey ? { Authorization: `Bearer ${requestApiKey}` } : {})
    },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      messages: [{ role: 'user', content: 'ping' }],
      temperature: params.temperature,
      top_p: params.topP,
      max_tokens: params.maxOutputTokens ? Math.min(params.maxOutputTokens, 256) : 128,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      stop: params.stopSequences,
      seed: params.seed
    })
  })

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  const thinkTagState = allowReasoning ? createThinkTagStreamState(input.model) : undefined

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')

      if (!line || !line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        if (allowReasoning && thinkTagState) {
          const tail = finalizeThinkTagStream(thinkTagState)
          if (tail.reasoning) {
            reasoning += tail.reasoning
            onChunk({ type: 'reasoning', text: tail.reasoning })
          }
          if (tail.content) {
            content += tail.content
            onChunk({ type: 'content', text: tail.content })
          }
        }
        return { content, reasoning }
      }
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta || {}
        const reasoningChunk = delta.reasoning_content || delta.reasoning
        const contentChunk = delta.content
        const hasStructuredReasoning = !!reasoningChunk && allowReasoning

        if (reasoningChunk && allowReasoning) {
          reasoning += reasoningChunk
          onChunk({ type: 'reasoning', text: reasoningChunk })
        }
        if (contentChunk) {
          const contentText = String(contentChunk)
          if (allowReasoning && thinkTagState) {
            const parsed = parseThinkTaggedChunk(contentText, thinkTagState)
            if (parsed.reasoning && !hasStructuredReasoning) {
              reasoning += parsed.reasoning
              onChunk({ type: 'reasoning', text: parsed.reasoning })
            }
            if (parsed.content) {
              content += parsed.content
              onChunk({ type: 'content', text: parsed.content })
            }
          } else {
            content += contentText
            onChunk({ type: 'content', text: contentText })
          }
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  if (allowReasoning && thinkTagState) {
    const tail = finalizeThinkTagStream(thinkTagState)
    if (tail.reasoning) {
      reasoning += tail.reasoning
      onChunk({ type: 'reasoning', text: tail.reasoning })
    }
    if (tail.content) {
      content += tail.content
      onChunk({ type: 'content', text: tail.content })
    }
  }

  return { content, reasoning }
}

export async function streamOpenAICompatChat(
  context: OpenAICompatContext,
  input: {
    model: string
    providerType?: string
    messages: Array<{
      role: 'system' | 'user' | 'assistant'
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } }
          >
    }>
    apiKey?: string
    baseURL?: string
    params: AiModelParameters
    tools?: AiTool[]
  },
  onChunk?: (chunk: AiMessage) => void,
  abortSignal?: AbortSignal
): Promise<{ content: string; reasoning: string }> {
  context.assertNotAborted(abortSignal)
  const allowReasoning = supportsReasoning(`openai:${input.model}`)
  const baseURL = context.resolveCompatBaseURL(input.baseURL, input.providerType)
  const url = `${baseURL}/chat/completions`
  const requestApiKey = getRotatedApiKey(
    input.apiKey,
    buildApiKeyScope({
      providerType: input.providerType,
      baseURL: input.baseURL
    })
  )
  const res = await fetch(url, {
    method: 'POST',
    signal: abortSignal,
    headers: {
      'Content-Type': 'application/json',
      ...(requestApiKey ? { Authorization: `Bearer ${requestApiKey}` } : {})
    },
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: input.messages,
      tools: input.tools,
      temperature: input.params.temperature,
      top_p: input.params.topP,
      max_tokens: input.params.maxOutputTokens,
      presence_penalty: input.params.presencePenalty,
      frequency_penalty: input.params.frequencyPenalty,
      stop: input.params.stopSequences,
      seed: input.params.seed
    })
  })

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  const thinkTagState = allowReasoning ? createThinkTagStreamState(input.model) : undefined

  while (true) {
    context.assertNotAborted(abortSignal)
    const { value, done } = await readWithAbort(reader, abortSignal)
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')
      context.assertNotAborted(abortSignal)

      if (!line || !line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        if (allowReasoning && thinkTagState) {
          const tail = finalizeThinkTagStream(thinkTagState)
          if (tail.reasoning) {
            reasoning += tail.reasoning
            context.emitReasoningChunk(onChunk, tail.reasoning)
          }
          if (tail.content) {
            content += tail.content
            context.emitTextChunk(onChunk, tail.content)
          }
        }
        return { content, reasoning }
      }
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta || {}
        const reasoningChunk = delta.reasoning_content || delta.reasoning
        const contentChunk = delta.content
        const hasStructuredReasoning = !!reasoningChunk && allowReasoning

        if (reasoningChunk && allowReasoning) {
          reasoning += reasoningChunk
          context.emitReasoningChunk(onChunk, reasoningChunk)
        }
        if (contentChunk) {
          const contentText = String(contentChunk)
          if (allowReasoning && thinkTagState) {
            const parsed = parseThinkTaggedChunk(contentText, thinkTagState)
            if (parsed.reasoning && !hasStructuredReasoning) {
              reasoning += parsed.reasoning
              context.emitReasoningChunk(onChunk, parsed.reasoning)
            }
            if (parsed.content) {
              content += parsed.content
              context.emitTextChunk(onChunk, parsed.content)
            }
          } else {
            content += contentText
            context.emitTextChunk(onChunk, contentText)
          }
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  if (allowReasoning && thinkTagState) {
    const tail = finalizeThinkTagStream(thinkTagState)
    if (tail.reasoning) {
      reasoning += tail.reasoning
      context.emitReasoningChunk(onChunk, tail.reasoning)
    }
    if (tail.content) {
      content += tail.content
      context.emitTextChunk(onChunk, tail.content)
    }
  }

  return { content, reasoning }
}

export async function runOpenAICompatToolLoop(
  context: OpenAICompatContext,
  input: {
    model: string
    providerType?: string
    messages: unknown[]
    apiKey?: string
    baseURL?: string
    params: AiModelParameters
    tools: AiTool[]
    maxToolSteps?: number
    toolContext?: AiToolContext
    allowReasoning: boolean
    requestId?: string
    capabilityDebug?: AiCapabilityDebugInfo
    policyDebug?: AiPolicyDebugInfo
  },
  onChunk?: (chunk: AiMessage) => void,
  abortSignal?: AbortSignal
): Promise<{ content: string; reasoning: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const maxSteps = resolveMaxToolSteps(input.maxToolSteps)
  const conversationMessages = [...input.messages]
  let fullContent = ''
  let fullReasoning = ''
  let inputTokens = 0
  let outputTokens = 0
  let hasInputUsage = false
  let hasOutputUsage = false

  for (let step = 0; step < maxSteps; step += 1) {
    context.assertNotAborted(abortSignal)
    const stepResult = await streamOpenAICompatToolStep(context, {
      model: input.model,
      providerType: input.providerType,
      messages: conversationMessages,
      apiKey: input.apiKey,
      baseURL: input.baseURL,
      params: input.params,
      tools: input.tools,
      allowReasoning: input.allowReasoning
    }, onChunk, abortSignal)

    if (stepResult.usage?.inputTokens !== undefined) {
      inputTokens += stepResult.usage.inputTokens
      hasInputUsage = true
    }
    if (stepResult.usage?.outputTokens !== undefined) {
      outputTokens += stepResult.usage.outputTokens
      hasOutputUsage = true
    }

    if (stepResult.content) fullContent += stepResult.content
    if (stepResult.reasoning && input.allowReasoning) fullReasoning += stepResult.reasoning

    const assistantMessage: Record<string, unknown> = {
      role: 'assistant',
      content: stepResult.content || ''
    }
    if (input.allowReasoning && stepResult.reasoning) {
      assistantMessage.reasoning_content = stepResult.reasoning
    }
    if (stepResult.toolCalls.length > 0) {
      assistantMessage.tool_calls = stepResult.toolCalls
    }
    conversationMessages.push(assistantMessage)

    const needsToolRound = stepResult.finishReason === 'tool_calls' || stepResult.toolCalls.length > 0
    if (!needsToolRound) {
      return {
        content: fullContent,
        reasoning: fullReasoning,
        usage: hasInputUsage || hasOutputUsage
          ? {
              inputTokens: hasInputUsage ? inputTokens : undefined,
              outputTokens: hasOutputUsage ? outputTokens : undefined
            }
          : undefined
      }
    }

    for (const call of stepResult.toolCalls) {
      context.assertNotAborted(abortSignal)
      const rawToolName = call.function?.name
      const toolName = resolveCompatToolCallName(rawToolName, input.tools)

      const parsedArgs = parseCompatToolCallArgs(call.function?.arguments || '{}')

      context.emitToolCallChunk(onChunk, {
        id: call.id,
        name: String(rawToolName || ''),
        args: parsedArgs
      })

      if (!toolName) {
        const fallbackResult = {
          success: false,
          error: `Unknown tool "${String(rawToolName || '')}"`,
          availableTools: input.tools
            .map((item) => item.function?.name)
            .filter((name): name is string => !!name)
        }
        console.warn('[AI] 工具执行跳过：工具名未匹配', {
          rawToolName,
          availableTools: fallbackResult.availableTools
        })
        context.emitToolResultChunk(onChunk, {
          id: call.id,
          name: String(rawToolName || ''),
          result: fallbackResult
        })
        conversationMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: stringifyToolResult(fallbackResult)
        })
        continue
      }

      if (rawToolName && rawToolName !== toolName) {
        console.warn('[AI] 工具名自动纠正', {
          rawToolName,
          resolvedToolName: toolName
        })
      }

      console.log('[AI] 工具执行开始', { toolName, input: parsedArgs, context: input.toolContext })
      let result: unknown
      if (isRuntimeCapabilityIntrospectionToolName(toolName)) {
        result = createRuntimeCapabilityIntrospectionSnapshot({
          tools: input.tools,
          args: parsedArgs,
          capabilityDebug: input.capabilityDebug,
          policyDebug: input.policyDebug
        })
      } else {
        if (!context.toolExecutor) {
          throw new Error('AI tool executor is not configured')
        }
        const mcpExecutionCallId = isMcpToolName(toolName)
          ? `${String(input.requestId || 'request')}:${String(call.id || 'tool')}`
          : undefined
        context.trackMcpCall(input.requestId, mcpExecutionCallId)
        try {
          result = await context.toolExecutor({
            name: toolName,
            args: parsedArgs,
            context: input.toolContext,
            callId: mcpExecutionCallId,
            abortSignal
          })
        } catch (error) {
          if (abortSignal?.aborted) {
            throw new Error('AI stream aborted by user')
          }
          const message = error instanceof Error ? error.message : String(error)
          console.warn('[AI] 工具执行失败（返回错误结果给模型）', { toolName, error: message })
          result = {
            success: false,
            error: message,
            hint: 'Tool execution failed. Please check the arguments format and retry. Arguments must be a valid JSON object.'
          }
        } finally {
          context.untrackMcpCall(input.requestId, mcpExecutionCallId)
        }
      }
      console.log('[AI] 工具执行完成', { toolName, result })

      context.emitToolResultChunk(onChunk, {
        id: call.id,
        name: toolName,
        result
      })

      conversationMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: stringifyToolResult(result)
      })
    }
  }

  throw new Error(`Tool execution exceeded maxToolSteps (${maxSteps})`)
}

export async function streamOpenAICompatToolStep(
  context: OpenAICompatContext,
  input: {
    model: string
    providerType?: string
    messages: unknown[]
    apiKey?: string
    baseURL?: string
    params: AiModelParameters
    tools: AiTool[]
    allowReasoning: boolean
  },
  onChunk?: (chunk: AiMessage) => void,
  abortSignal?: AbortSignal
): Promise<{
  content: string
  reasoning: string
  toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  finishReason?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}> {
  context.assertNotAborted(abortSignal)
  const toolLoopStepTimeoutMs = 120_000
  const baseURL = context.resolveCompatBaseURL(input.baseURL, input.providerType)
  const url = `${baseURL}/chat/completions`
  const requestApiKey = getRotatedApiKey(
    input.apiKey,
    buildApiKeyScope({
      providerType: input.providerType,
      baseURL: input.baseURL
    })
  )
  const timeoutController = new AbortController()
  let parentAbortListener: (() => void) | undefined
  const timeoutHandle = setTimeout(() => {
    timeoutController.abort(new Error(`OpenAI compat tool step timeout after ${Math.floor(toolLoopStepTimeoutMs / 1000)}s`))
  }, toolLoopStepTimeoutMs)
  if (abortSignal) {
    if (abortSignal.aborted) {
      timeoutController.abort(abortSignal.reason)
    } else {
      parentAbortListener = () => timeoutController.abort(abortSignal.reason)
      abortSignal.addEventListener('abort', parentAbortListener, { once: true })
    }
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: timeoutController.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(requestApiKey ? { Authorization: `Bearer ${requestApiKey}` } : {})
      },
      body: JSON.stringify({
        model: input.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: input.messages,
        tools: input.tools,
        tool_choice: 'auto',
        temperature: input.params.temperature,
        top_p: input.params.topP,
        max_tokens: input.params.maxOutputTokens,
        presence_penalty: input.params.presencePenalty,
        frequency_penalty: input.params.frequencyPenalty,
        stop: input.params.stopSequences,
        seed: input.params.seed
      })
    })
  } catch (error) {
    const abortedByCaller = !!abortSignal?.aborted
    const abortedByTimeout = timeoutController.signal.aborted && !abortedByCaller
    if (abortedByTimeout) {
      throw new Error(`OpenAI compatible tool loop request timeout after ${Math.floor(toolLoopStepTimeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
    if (abortSignal && parentAbortListener) {
      abortSignal.removeEventListener('abort', parentAbortListener)
    }
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finishReason: string | undefined
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  const thinkTagState = input.allowReasoning ? createThinkTagStreamState(input.model) : undefined
  const toolCallsMap = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>()

  while (true) {
    context.assertNotAborted(abortSignal)
    const { value, done } = await readWithAbort(reader, abortSignal)
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')
      context.assertNotAborted(abortSignal)

      if (!line || !line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        if (input.allowReasoning && thinkTagState) {
          const tail = finalizeThinkTagStream(thinkTagState)
          if (tail.reasoning) {
            reasoning += tail.reasoning
            context.emitReasoningChunk(onChunk, tail.reasoning)
          }
          if (tail.content) {
            content += tail.content
            context.emitTextChunk(onChunk, tail.content)
          }
        }
        const toolCalls = [...toolCallsMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([index, call]) => ({
            ...call,
            id: call.id || `call_${index}`
          }))

        return {
          content,
          reasoning,
          toolCalls,
          finishReason: finishReason || (toolCalls.length > 0 ? 'tool_calls' : undefined),
          usage
        }
      }

      try {
        const json = JSON.parse(data)
        usage = extractUsage(json) || usage

        const choice = json.choices?.[0]
        if (!choice) continue
        const contentSource = pickOpenAICompatContentSource(choice)
        if (!contentSource) {
          if (choice.finish_reason) {
            finishReason = choice.finish_reason
          }
          continue
        }

        const reasoningChunk = contentSource.reasoning_content || contentSource.reasoning
        const hasStructuredReasoning = !!reasoningChunk && input.allowReasoning
        if (reasoningChunk && input.allowReasoning) {
          const reasoningText = String(reasoningChunk)
          reasoning += reasoningText
          context.emitReasoningChunk(onChunk, reasoningText)
        }

        const contentChunk = extractOpenAICompatContentText(contentSource.content)
        if (contentChunk) {
          if (input.allowReasoning && thinkTagState) {
            const parsed = parseThinkTaggedChunk(contentChunk, thinkTagState)
            if (parsed.reasoning && !hasStructuredReasoning) {
              reasoning += parsed.reasoning
              context.emitReasoningChunk(onChunk, parsed.reasoning)
            }
            if (parsed.content) {
              content += parsed.content
              context.emitTextChunk(onChunk, parsed.content)
            }
          } else {
            content += contentChunk
            context.emitTextChunk(onChunk, contentChunk)
          }
        }

        if (Array.isArray(contentSource.tool_calls)) {
          for (const chunk of contentSource.tool_calls) {
            const chunkRecord = chunk && typeof chunk === 'object' ? chunk as Record<string, unknown> : undefined
            const chunkFunction = chunkRecord?.function && typeof chunkRecord.function === 'object'
              ? chunkRecord.function as Record<string, unknown>
              : undefined
            const index = typeof chunkRecord?.index === 'number' ? chunkRecord.index : 0
            const current = toolCallsMap.get(index) || {
              id: '',
              type: 'function' as const,
              function: { name: '', arguments: '' }
            }
            if (typeof chunkRecord?.id === 'string') current.id = chunkRecord.id
            if (chunkRecord?.type === 'function') current.type = 'function'
            if (typeof chunkFunction?.name === 'string') current.function.name += chunkFunction.name
            if (typeof chunkFunction?.arguments === 'string') current.function.arguments += chunkFunction.arguments
            toolCallsMap.set(index, current)
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  const toolCalls = [...toolCallsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({
      ...call,
      id: call.id || `call_${index}`
    }))

  if (input.allowReasoning && thinkTagState) {
    const tail = finalizeThinkTagStream(thinkTagState)
    if (tail.reasoning) {
      reasoning += tail.reasoning
      context.emitReasoningChunk(onChunk, tail.reasoning)
    }
    if (tail.content) {
      content += tail.content
      context.emitTextChunk(onChunk, tail.content)
    }
  }

  return {
    content,
    reasoning,
    toolCalls,
    finishReason: finishReason || (toolCalls.length > 0 ? 'tool_calls' : undefined),
    usage
  }
}
