import { AiService } from './service'

export const aiService = new AiService()

export function setAiToolExecutor(
  executor?: (input: { name: string; args: unknown; context?: import('../../shared/types/ai').AiToolContext }) => Promise<unknown>
) {
  aiService.setToolExecutor(executor)
}
