import type { AiProviderConfig } from '../../../shared/types/ai'
import { BaseFileService } from './BaseFileService'
import { OpenAIFileService } from './OpenAIFileService'
import { GeminiFileService } from './GeminiFileService'
import { AnthropicFileService } from './AnthropicFileService'

export class FileServiceManager {
  private static instance: FileServiceManager
  private services = new Map<string, BaseFileService>()

  private constructor() {}

  static getInstance(): FileServiceManager {
    if (!this.instance) {
      this.instance = new FileServiceManager()
    }
    return this.instance
  }

  getService(provider: AiProviderConfig): BaseFileService {
    const key = `${provider.id}|${provider.label || ''}|${provider.baseURL || ''}`
    const existing = this.services.get(key)
    if (existing) return existing

    let service: BaseFileService
    switch (provider.id) {
      case 'openai':
        service = new OpenAIFileService(provider)
        break
      case 'google':
        service = new GeminiFileService(provider)
        break
      case 'anthropic':
        service = new AnthropicFileService(provider)
        break
      default:
        throw new Error(`File service not supported for provider: ${provider.id}`)
    }

    this.services.set(key, service)
    return service
  }
}
