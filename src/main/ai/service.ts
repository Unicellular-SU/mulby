import { generateText, streamText, generateImage } from 'ai'
import type { AiAttachmentRef, AiMessage, AiModel, AiModelParameters, AiOption, AiProviderConfig, AiTokenBreakdown } from '../../shared/types/ai'
import { attachmentStore } from './attachments'
import { estimateTokens } from './tokens'
import { getAllModels, resolveModelId } from './models'
import { getAiSettings } from './config'
import { getProviderRegistry, hasProvider, buildProvider } from './providers'
import { createProviderRegistry } from 'ai'

interface StreamCallbacks {
  onChunk?: (chunk: AiMessage) => void
  onEnd?: (message: AiMessage) => void
  onError?: (error: Error) => void
}

export class AiService {
  private controllers = new Map<string, AbortController>()

  allModels() {
    return getAllModels()
  }

  async call(option: AiOption, onChunk?: (chunk: AiMessage) => void): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    if (option.tools && option.tools.length > 0) {
      console.warn('[AI] Function calling tools are not supported yet and will be ignored.')
    }
    const requestId = this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(requestId, controller)

    try {
      if (onChunk) {
        return await this.stream(option, { onChunk }, requestId)
      }

      const { modelKey } = this.resolveLanguageModel(option.model)
      const params = this.resolveGenerationParams(option, option.model)
      const messages = await this.toSdkMessages(this.applyContextWindow(option.messages, params.contextWindow))
      const result = await generateText({
        model: modelKey,
        messages,
        abortSignal: controller.signal,
        ...params
      })

      return {
        role: 'assistant',
        content: result.text,
        reasoning_content: (result as any).reasoning
      }
    } finally {
      this.controllers.delete(requestId)
    }
  }

  async stream(option: AiOption, callbacks: StreamCallbacks, requestId?: string): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    if (option.tools && option.tools.length > 0) {
      console.warn('[AI] Function calling tools are not supported yet and will be ignored.')
    }

    const id = requestId || this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(id, controller)

    try {
      const { modelKey } = this.resolveLanguageModel(option.model)
      const params = this.resolveGenerationParams(option, option.model)
      const messages = await this.toSdkMessages(this.applyContextWindow(option.messages, params.contextWindow))
      const result = await streamText({
        model: modelKey,
        messages,
        abortSignal: controller.signal,
        ...params
      })

      let fullText = ''
      for await (const chunk of result.textStream) {
        fullText += chunk
        callbacks.onChunk?.({ role: 'assistant', content: chunk })
      }

      const finalMessage: AiMessage = { role: 'assistant', content: fullText }
      callbacks.onEnd?.(finalMessage)
      return finalMessage
    } catch (err) {
      const error = err instanceof Error ? err : new Error('AI stream failed')
      callbacks.onError?.(error)
      throw error
    } finally {
      this.controllers.delete(id)
    }
  }

  abort(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (controller) {
      controller.abort()
      this.controllers.delete(requestId)
    }
  }

  async estimateTokens(input: { model: string; messages: AiMessage[] }): Promise<AiTokenBreakdown> {
    return await estimateTokens(input)
  }

  async uploadAttachment(input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }): Promise<AiAttachmentRef> {
    return await attachmentStore.upload(input)
  }

  async getAttachment(attachmentId: string): Promise<AiAttachmentRef | null> {
    return attachmentStore.get(attachmentId)
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    await attachmentStore.delete(attachmentId)
  }

  async generateImages(input: { prompt: string; model: string; size?: string; count?: number }): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
    const { modelKey } = this.resolveImageModel(input.model)
    const result = await generateImage({
      model: modelKey,
      prompt: input.prompt,
      size: input.size,
      n: input.count
    } as any)

    const images = (result as any).images?.map((img: any) => img.base64) || []
    const tokens = await this.estimateTokens({ model: input.model, messages: [] })
    return { images, tokens }
  }

  async editImage(input: { imageAttachmentId: string; prompt: string; model: string }): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
    const { modelKey } = this.resolveImageModel(input.model)
    const image = await attachmentStore.read(input.imageAttachmentId)

    const result = await generateImage({
      model: modelKey,
      prompt: {
        text: input.prompt,
        images: [image]
      }
    } as any)

    const images = (result as any).images?.map((img: any) => img.base64) || []
    const tokens = await this.estimateTokens({ model: input.model, messages: [] })
    return { images, tokens }
  }

  async generateVideo(_input?: { prompt: string; model: string; duration?: number; size?: string }): Promise<{ videos: string[]; tokens: AiTokenBreakdown }> {
    throw new Error('Video generation is not supported yet')
  }

  async testConnection(input?: { model?: string; providerId?: string; apiKey?: string; baseURL?: string }): Promise<{ success: boolean; message?: string }> {
    try {
      const { modelKey } = this.resolveTestModel(input)
      const params = this.resolveGenerationParams({ model: input?.model, messages: [] }, input?.model)
      console.info('[AI] testConnection:start', {
        providerId: input?.providerId,
        model: input?.model,
        baseURL: input?.baseURL
      })
      const result = await generateText({
        model: modelKey,
        messages: [{ role: 'user', content: 'ping' }],
        ...params,
        maxOutputTokens: Math.min(params.maxOutputTokens ?? 8, 32)
      } as any)
      console.info('[AI] testConnection:success', {
        providerId: input?.providerId,
        model: input?.model
      })
      return { success: true, message: result.text || 'ok' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI connection failed'
      console.error('[AI] testConnection:fail', {
        providerId: input?.providerId,
        model: input?.model,
        baseURL: input?.baseURL,
        error: message
      })
      return { success: false, message }
    }
  }

  async testConnectionStream(
    input: { model?: string; providerId?: string; apiKey?: string; baseURL?: string },
    onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
  ): Promise<{ success: boolean; message?: string; reasoning?: string }> {
    try {
      console.info('[AI] testConnectionStream:start', {
        providerId: input?.providerId,
        model: input?.model,
        baseURL: input?.baseURL
      })

      if (input?.providerId === 'openai' && shouldUseChatApi(input?.baseURL)) {
        const { content, reasoning } = await this.streamOpenAICompat(input, onChunk)
        console.info('[AI] testConnectionStream:success', {
          providerId: input?.providerId,
          model: input?.model
        })
        return { success: true, message: content || 'ok', reasoning }
      }

      const { modelKey } = this.resolveTestModel(input)
      const params = this.resolveGenerationParams({ model: input?.model, messages: [] }, input?.model)
      const result = await streamText({
        model: modelKey,
        messages: [{ role: 'user', content: 'ping' }],
        ...params,
        maxOutputTokens: Math.min(params.maxOutputTokens ?? 32, 64)
      } as any)

      let fullText = ''
      for await (const chunk of result.textStream) {
        fullText += chunk
        onChunk({ type: 'content', text: chunk })
      }

      console.info('[AI] testConnectionStream:success', {
        providerId: input?.providerId,
        model: input?.model
      })
      return { success: true, message: fullText || 'ok' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI connection failed'
      console.error('[AI] testConnectionStream:fail', {
        providerId: input?.providerId,
        model: input?.model,
        baseURL: input?.baseURL,
        error: message
      })
      return { success: false, message }
    }
  }

  private async streamOpenAICompat(
    input: { model?: string; providerId?: string; apiKey?: string; baseURL?: string },
    onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
  ): Promise<{ content: string; reasoning: string }> {
    const baseURL = normalizeOpenAIBaseURL(input.baseURL) || 'https://api.openai.com/v1'
    const url = `${baseURL.replace(/\/$/, '')}/chat/completions`
    const modelId = input.model?.includes(':') ? input.model.split(':', 2)[1] : input.model
    if (!modelId) {
      throw new Error('Model is required for provider test')
    }

    const params = this.resolveGenerationParams({ model: input?.model, messages: [] }, input?.model)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: modelId,
        stream: true,
        messages: [{ role: 'user', content: 'ping' }],
        temperature: params.temperature,
        top_p: params.topP,
        max_tokens: params.maxOutputTokens ? Math.min(params.maxOutputTokens, 64) : 32,
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
          return { content, reasoning }
        }
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta || {}
          const reasoningChunk = delta.reasoning_content || delta.reasoning
          const contentChunk = delta.content

          if (reasoningChunk) {
            reasoning += reasoningChunk
            onChunk({ type: 'reasoning', text: reasoningChunk })
          }
          if (contentChunk) {
            content += contentChunk
            onChunk({ type: 'content', text: contentChunk })
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    return { content, reasoning }
  }

  private resolveTestModel(input?: { model?: string; providerId?: string; apiKey?: string; baseURL?: string }) {
    if (!input?.providerId) {
      return this.resolveLanguageModel(input?.model)
    }

    const modelId = input.model?.includes(':') ? input.model.split(':', 2)[1] : input.model
    if (!modelId) {
      throw new Error('Model is required for provider test')
    }

    const providerConfig: AiProviderConfig = {
      id: input.providerId,
      enabled: true,
      apiKey: input.apiKey,
      baseURL: input.baseURL
    }

    const provider = buildProvider(providerConfig)
    if (!provider) {
      throw new Error(`Provider not supported: ${input.providerId}`)
    }

    if (input.providerId === 'openai' && shouldUseChatApi(input.baseURL) && (provider as any).chat) {
      return { modelKey: (provider as any).chat(modelId) }
    }

    const registry = createProviderRegistry({ [input.providerId]: provider })
    return { modelKey: registry.languageModel(`${input.providerId}:${modelId}`) }
  }

  async fetchModels(input: { providerId: string; baseURL?: string; apiKey?: string }): Promise<{ models: AiModel[]; message?: string }> {
    if (input.providerId !== 'openai') {
      return { models: [], message: '当前仅支持 OpenAI 兼容接口拉取模型列表' }
    }

    const baseURL = normalizeOpenAIBaseURL(input.baseURL) || 'https://api.openai.com/v1'
    const url = `${baseURL.replace(/\/$/, '')}/models`

    try {
      console.info('[AI] fetchModels:start', { providerId: input.providerId, url })
      const res = await fetch(url, {
        headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.warn('[AI] fetchModels:fail', { status: res.status, statusText: res.statusText, body })
        return { models: [], message: `拉取失败：${res.status} ${res.statusText}${body ? ` - ${body}` : ''}` }
      }
      const data = await res.json() as { data?: { id: string }[] }
      const models = (data.data || []).map((item) => ({
        id: `${input.providerId}:${item.id}`,
        label: item.id,
        description: ''
      }))
      console.info('[AI] fetchModels:success', { count: models.length })
      return { models }
    } catch (err) {
      const message = err instanceof Error ? err.message : '拉取模型失败'
      console.error('[AI] fetchModels:error', { error: message })
      return { models: [], message }
    }
  }

  private resolveLanguageModel(modelId?: string): { model: string; modelKey: any } {
    const { providerId, modelId: resolvedId } = resolveModelId(modelId)
    if (!hasProvider(providerId as any)) {
      throw new Error(`AI provider not available: ${providerId}`)
    }
    const providerConfig = this.resolveProviderConfig(modelId, providerId)
    if (providerId === 'openai' && shouldUseChatApi(providerConfig?.baseURL)) {
      const provider = buildProvider({
        id: providerId,
        enabled: true,
        apiKey: providerConfig?.apiKey,
        baseURL: providerConfig?.baseURL,
        headers: providerConfig?.headers
      })
      if (provider && (provider as any).chat) {
        return { model: `${providerId}:${resolvedId}`, modelKey: (provider as any).chat(resolvedId) }
      }
    }

    const registry = getProviderRegistry()
    const modelKey = registry.languageModel(`${providerId}:${resolvedId}`)
    return { model: `${providerId}:${resolvedId}`, modelKey }
  }

  private resolveImageModel(modelId?: string): { model: string; modelKey: any } {
    const { providerId, modelId: resolvedId } = resolveModelId(modelId)
    if (!hasProvider(providerId as any)) {
      throw new Error(`AI provider not available: ${providerId}`)
    }
    const registry = getProviderRegistry()
    const modelKey = registry.imageModel(`${providerId}:${resolvedId}`)
    return { model: `${providerId}:${resolvedId}`, modelKey }
  }

  private async toSdkMessages(messages: AiMessage[]) {
    const results: any[] = []
    for (const message of messages) {
      if (typeof message.content === 'string' || message.content === undefined) {
        results.push({ role: message.role, content: message.content || '' })
        continue
      }

      const parts: any[] = []
      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text })
        } else if (part.type === 'image') {
          const image = await attachmentStore.read(part.attachmentId)
          parts.push({ type: 'image', image, mediaType: part.mimeType })
        } else if (part.type === 'file') {
          const data = await attachmentStore.read(part.attachmentId)
          parts.push({ type: 'file', data, mediaType: part.mimeType, filename: part.filename })
        }
      }

      results.push({ role: message.role, content: parts })
    }

    return results
  }

  private createRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  private applyContextWindow(messages: AiMessage[], limit?: number): AiMessage[] {
    if (limit === undefined || limit <= 0 || limit >= 100) return messages
    const systemMessages = messages.filter((message) => message.role === 'system')
    const otherMessages = messages.filter((message) => message.role !== 'system')
    const trimmed = otherMessages.slice(Math.max(0, otherMessages.length - limit))
    return [...systemMessages, ...trimmed]
  }

  private resolveGenerationParams(option: AiOption, modelId?: string): AiModelParameters {
    const settings = getAiSettings()
    const modelConfig = this.resolveModelConfig(modelId)
    const providerConfig = this.resolveProviderConfig(modelId)
    const merged = mergeModelParams(
      settings.defaultParams,
      providerConfig?.defaultParams,
      modelConfig?.params,
      option.params
    )
    return normalizeModelParams(merged)
  }

  private resolveModelConfig(modelId?: string): AiModel | undefined {
    if (!modelId) return undefined
    const settings = getAiSettings()
    return settings.models?.find((model) => model.id === modelId)
  }

  private resolveProviderConfig(modelId?: string, providerIdOverride?: string): AiProviderConfig | undefined {
    const settings = getAiSettings()
    if (!settings.providers || settings.providers.length === 0) return undefined
    const modelConfig = this.resolveModelConfig(modelId)
    if (modelConfig?.providerLabel) {
      const match = settings.providers.find((provider) => (provider.label || provider.id) === modelConfig.providerLabel)
      if (match) return match
    }
    const providerId = providerIdOverride || (modelId?.includes(':') ? modelId.split(':', 2)[0] : undefined)
    if (providerId) {
      const match = settings.providers.find((provider) => String(provider.id) === String(providerId))
      if (match) return match
    }
    return settings.providers[0]
  }
}

function mergeModelParams(...params: Array<AiModelParameters | undefined>) {
  const result: AiModelParameters = {}
  for (const item of params) {
    if (!item) continue
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value) && value.length === 0) continue
      ;(result as any)[key] = value
    }
  }
  return result
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return undefined
  return Math.min(Math.max(value, min), max)
}

function normalizeModelParams(params: AiModelParameters): AiModelParameters {
  const normalized: AiModelParameters = {}
  if (params.contextWindow !== undefined) {
    const value = Math.max(0, Math.floor(params.contextWindow))
    if (value >= 0) normalized.contextWindow = value
  }
  if (params.temperatureEnabled !== undefined) normalized.temperatureEnabled = params.temperatureEnabled
  if (params.topPEnabled !== undefined) normalized.topPEnabled = params.topPEnabled
  if (params.maxOutputTokensEnabled !== undefined) normalized.maxOutputTokensEnabled = params.maxOutputTokensEnabled
  if (params.temperatureEnabled !== false && params.temperature !== undefined) {
    normalized.temperature = clampNumber(params.temperature, 0, 2)
  }
  if (params.topPEnabled !== false && params.topP !== undefined) {
    normalized.topP = clampNumber(params.topP, 0, 1)
  }
  if (params.topK !== undefined) normalized.topK = Math.max(0, params.topK)
  if (params.maxOutputTokensEnabled !== false && params.maxOutputTokens !== undefined) {
    normalized.maxOutputTokens = Math.max(1, params.maxOutputTokens)
  }
  if (params.presencePenalty !== undefined) normalized.presencePenalty = clampNumber(params.presencePenalty, -2, 2)
  if (params.frequencyPenalty !== undefined) normalized.frequencyPenalty = clampNumber(params.frequencyPenalty, -2, 2)
  if (params.stopSequences) normalized.stopSequences = params.stopSequences.filter((item) => item && item.trim().length > 0)
  if (params.seed !== undefined) normalized.seed = Math.floor(params.seed)
  return normalized
}

function normalizeOpenAIBaseURL(baseURL?: string): string | undefined {
  if (!baseURL) return undefined
  const trimmed = baseURL.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) return trimmed
  return `${trimmed}/v1`
}

function shouldUseChatApi(baseURL?: string): boolean {
  if (!baseURL) return false
  const normalized = normalizeOpenAIBaseURL(baseURL)
  if (!normalized) return false
  return !normalized.includes('api.openai.com')
}
