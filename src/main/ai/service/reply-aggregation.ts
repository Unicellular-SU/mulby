import {
  createThinkTagStreamState,
  finalizeThinkTagStream,
  parseThinkTaggedChunk,
  splitThinkTaggedText
} from '../thinkTagParser'

type SdkStreamPart = {
  type?: unknown
  delta?: unknown
  text?: unknown
  toolCallId?: unknown
  toolName?: unknown
  input?: unknown
  args?: unknown
  result?: unknown
  output?: unknown
}

type SdkStreamResultLike = {
  fullStream?: AsyncIterable<SdkStreamPart>
  textStream?: AsyncIterable<unknown>
  text?: unknown
  reasoningText?: unknown
}

interface AggregateSdkStreamResultInput {
  result: SdkStreamResultLike
  allowReasoning: boolean
  modelId?: string
  abortSignal?: AbortSignal
  assertNotAborted?: (abortSignal?: AbortSignal) => void
  onPart?: (part: SdkStreamPart) => void
  onText: (text: string) => void
  onReasoning: (text: string) => void
  onToolCall?: (toolCall: { id: string; name: string; args?: unknown }) => void
  onToolResult?: (toolResult: { id: string; name: string; result?: unknown }) => void
}

function toTextDelta(part: SdkStreamPart): string {
  if (typeof part.delta === 'string') return part.delta
  if (typeof part.text === 'string') return part.text
  return ''
}

function toToolCallPart(part: SdkStreamPart): { id: string; name: string; args?: unknown } | null {
  const id = typeof part.toolCallId === 'string' ? part.toolCallId : ''
  const name = typeof part.toolName === 'string' ? part.toolName : ''
  if (!id || !name) return null
  return { id, name, args: part.input ?? part.args }
}

function toToolResultPart(part: SdkStreamPart): { id: string; name: string; result?: unknown } | null {
  const id = typeof part.toolCallId === 'string' ? part.toolCallId : ''
  const name = typeof part.toolName === 'string' ? part.toolName : ''
  if (!id || !name) return null
  return { id, name, result: part.result ?? part.output }
}

async function resolveAsyncField(value: unknown): Promise<unknown> {
  if (!value || typeof value !== 'object') return value
  const thenable = value as { then?: (onfulfilled?: (value: unknown) => unknown) => unknown }
  if (typeof thenable.then !== 'function') return value
  return await (value as Promise<unknown>)
}

export async function aggregateSdkStreamResult(
  input: AggregateSdkStreamResultInput
): Promise<{ content: string; reasoning: string }> {
  let fullText = ''
  let reasoning = ''
  const thinkTagState = input.allowReasoning ? createThinkTagStreamState(input.modelId) : undefined
  let hasStructuredReasoningSignal = false

  if (input.result.fullStream) {
    for await (const part of input.result.fullStream) {
      input.assertNotAborted?.(input.abortSignal)
      input.onPart?.(part)
      if (part?.type === 'text-delta') {
        const textDelta = toTextDelta(part)
        if (!textDelta) continue
        if (input.allowReasoning && thinkTagState) {
          const parsed = parseThinkTaggedChunk(textDelta, thinkTagState)
          if (parsed.reasoning && !hasStructuredReasoningSignal) {
            reasoning += parsed.reasoning
            input.onReasoning(parsed.reasoning)
          }
          if (parsed.content) {
            fullText += parsed.content
            input.onText(parsed.content)
          }
          continue
        }
        fullText += textDelta
        input.onText(textDelta)
      } else if (part?.type === 'reasoning-delta') {
        const reasoningDelta = toTextDelta(part)
        if (reasoningDelta && input.allowReasoning) {
          hasStructuredReasoningSignal = true
          reasoning += reasoningDelta
          input.onReasoning(reasoningDelta)
        }
      } else if (part?.type === 'tool-call') {
        const toolCall = toToolCallPart(part)
        if (toolCall) input.onToolCall?.(toolCall)
      } else if (part?.type === 'tool-result') {
        const toolResult = toToolResultPart(part)
        if (toolResult) input.onToolResult?.(toolResult)
      }
    }
  } else if (input.result.textStream) {
    for await (const chunk of input.result.textStream) {
      input.assertNotAborted?.(input.abortSignal)
      if (!chunk) continue
      const text = String(chunk)
      if (input.allowReasoning && thinkTagState) {
        const parsed = parseThinkTaggedChunk(text, thinkTagState)
        if (parsed.reasoning) {
          reasoning += parsed.reasoning
          input.onReasoning(parsed.reasoning)
        }
        if (parsed.content) {
          fullText += parsed.content
          input.onText(parsed.content)
        }
      } else {
        fullText += text
        input.onText(text)
      }
    }
  }

  input.assertNotAborted?.(input.abortSignal)

  if (input.allowReasoning && thinkTagState) {
    const tail = finalizeThinkTagStream(thinkTagState)
    if (tail.reasoning) {
      reasoning += tail.reasoning
      input.onReasoning(tail.reasoning)
    }
    if (tail.content) {
      fullText += tail.content
      input.onText(tail.content)
    }
  }

  const rawText = await resolveAsyncField(input.result.text)
  if (!fullText && rawText) {
    const fallbackText = String(rawText || '')
    if (input.allowReasoning) {
      const parsed = splitThinkTaggedText(fallbackText, input.modelId)
      fullText = parsed.content
      if (!reasoning && parsed.reasoning) {
        reasoning = parsed.reasoning
      }
    } else {
      fullText = fallbackText
    }
  }
  const rawReasoning = await resolveAsyncField(input.result.reasoningText)
  if (!reasoning && rawReasoning && input.allowReasoning) {
    reasoning = String(rawReasoning)
  }

  return { content: fullText || '', reasoning }
}
