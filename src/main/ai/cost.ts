import type { AiCostBreakdown, AiMessage } from '../../shared/types/ai'
import { getModelById } from './models'

function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

function estimateTokensFromMessages(messages: AiMessage[]): number {
  return messages.reduce((sum, message) => {
    if (typeof message.content === 'string') {
      return sum + estimateTokens(message.content)
    }
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
      return sum + estimateTokens(text)
    }
    return sum
  }, 0)
}

export async function estimateCost(input: { model: string; messages: AiMessage[] }): Promise<AiCostBreakdown> {
  const model = getModelById(input.model)
  const inputTokens = estimateTokensFromMessages(input.messages)
  const outputTokens = 0
  const attachmentCost = 0
  const inputPrice = model?.pricing.inputPer1k || 0
  const outputPrice = model?.pricing.outputPer1k || 0
  const totalCost = (inputTokens / 1000) * inputPrice + (outputTokens / 1000) * outputPrice + attachmentCost

  return {
    inputTokens,
    outputTokens,
    attachmentCost,
    totalCost
  }
}
