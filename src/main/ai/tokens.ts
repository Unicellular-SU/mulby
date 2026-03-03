import type { AiMessage, AiTokenBreakdown } from '../../shared/types/ai'
import { encodingForModel, getEncoding, type Tiktoken, type TiktokenEncoding } from 'js-tiktoken'

const encodingCache = new Map<string, Tiktoken>()

function normalizeModelForEncoding(model?: string): string | undefined {
  if (!model) return undefined
  const normalized = model.includes(':') ? model.split(':', 2)[1] : model
  return normalized || model
}

function getEncodingForModel(model?: string): Tiktoken | null {
  const normalized = normalizeModelForEncoding(model)
  const key = normalized || 'cl100k_base'
  const cached = encodingCache.get(key)
  if (cached) return cached

  try {
    if (normalized) {
      const encoding = encodingForModel(normalized as Parameters<typeof encodingForModel>[0])
      encodingCache.set(key, encoding)
      return encoding
    }
  } catch {
    // ignore and fallback
  }

  let fallbackName: TiktokenEncoding = 'cl100k_base'
  if (normalized && /gpt-4o|o1|o3|o4|4\.1/i.test(normalized)) {
    fallbackName = 'o200k_base'
  }
  const encoding = getEncoding(fallbackName)
  encodingCache.set(key, encoding)
  return encoding
}

export function countTokensForText(text: string, model?: string): number {
  if (!text) return 0
  const encoding = getEncodingForModel(model)
  if (!encoding) return Math.max(1, Math.ceil(text.length / 4))
  try {
    return encoding.encode(text).length
  } catch {
    return Math.max(1, Math.ceil(text.length / 4))
  }
}

export function countTokensFromMessages(messages: AiMessage[], model?: string): number {
  return messages.reduce((sum, message) => {
    if (typeof message.content === 'string') {
      return sum + countTokensForText(message.content, model)
    }
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
      return sum + countTokensForText(text, model)
    }
    return sum
  }, 0)
}

export async function estimateTokens(input: {
  model?: string
  messages: AiMessage[]
  maxOutputTokens?: number
  outputText?: string
}): Promise<AiTokenBreakdown> {
  const inputTokens = countTokensFromMessages(input.messages, input.model)
  const outputTokens = input.outputText
    ? countTokensForText(input.outputText, input.model)
    : input.maxOutputTokens ?? Math.min(512, Math.max(16, Math.ceil(inputTokens * 1.5)))

  return {
    inputTokens,
    outputTokens
  }
}
