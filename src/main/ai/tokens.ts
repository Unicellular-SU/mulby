import type { AiMessage, AiTokenBreakdown } from '../../shared/types/ai'

function estimateTokenCount(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

function estimateTokensFromMessages(messages: AiMessage[]): number {
  return messages.reduce((sum, message) => {
    if (typeof message.content === 'string') {
      return sum + estimateTokenCount(message.content)
    }
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
      return sum + estimateTokenCount(text)
    }
    return sum
  }, 0)
}

export async function estimateTokens(input: { model: string; messages: AiMessage[] }): Promise<AiTokenBreakdown> {
  const inputTokens = estimateTokensFromMessages(input.messages)
  const outputTokens = 0

  return {
    inputTokens,
    outputTokens
  }
}
