import { generateText, streamText, generateImage, stepCountIs } from 'ai'
import { jsonSchema, tool } from '@ai-sdk/provider-utils'
import type { AiAttachmentRef, AiMessage, AiModel, AiModelParameters, AiOption, AiProviderConfig, AiTokenBreakdown, AiToolContext, AiTool } from '../../shared/types/ai'
import { attachmentStore } from './attachments'
import { FileServiceManager } from './fileServices/FileServiceManager'
import {
  getFileSizeLimit,
  supportsEmbedding,
  supportsFunctionCalling,
  supportsImageInput,
  supportsLargeFileUpload,
  supportsPdfInput,
  supportsReasoning,
  supportsRerank,
  supportsWebSearch
} from './modelCapabilities'
import { countTokensForText, countTokensFromMessages, estimateTokens } from './tokens'
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
  private toolExecutor?: (input: { name: string; args: unknown; context?: AiToolContext }) => Promise<unknown>

  allModels() {
    return getAllModels()
  }

  async call(option: AiOption, onChunk?: (chunk: AiMessage) => void): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    console.log('[AI] call 开始', {
      model: option.model,
      messageCount: option.messages.length,
      hasTools: !!option.tools && option.tools.length > 0,
      toolContext: option.toolContext,
      hasOnChunk: !!onChunk
    })
    const tools = this.buildTools(option.tools, option.toolContext, option.model)
    const requestId = this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(requestId, controller)

    try {
      if (onChunk) {
        console.log('[AI] call: 使用流式模式')
        return await this.stream(option, { onChunk }, requestId)
      }

      const { modelKey } = this.resolveLanguageModel(option.model)
      const params = this.resolveGenerationParams(option, option.model)
      const trimmedMessages = this.applyContextWindow(option.messages, params.contextWindow)
      const providerConfig = this.resolveProviderConfig(option.model)
      const resolved = resolveModelId(option.model)

      if (resolved.providerId === 'anthropic' && this.hasMultimodalContent(trimmedMessages)) {
        console.log('[AI] call: 使用 Anthropic 原生 API')
        const anthropicPayload = await this.toAnthropicMessages(trimmedMessages, option.model, providerConfig)
        const { content, reasoning } = await this.callAnthropicMessages({
          model: resolved.modelId,
          messages: anthropicPayload.messages,
          system: anthropicPayload.system,
          apiKey: providerConfig?.apiKey,
          baseURL: providerConfig?.baseURL,
          params
        })
        const usage = normalizeUsage(
          undefined,
          countTokensFromMessages(trimmedMessages, option.model),
          countTokensForText(`${reasoning || ''}${content || ''}`, option.model)
        )
        return {
          role: 'assistant',
          content,
          reasoning_content: reasoning || undefined,
          usage
        }
      }

      console.log('[AI] call: 使用 Vercel AI SDK generateText', { hasTools: !!tools })
      const messages = await this.toSdkMessages(trimmedMessages, option.model)
      const maxSteps = option.maxToolSteps ?? 10
      const result = await generateText({
        model: modelKey,
        messages,
        abortSignal: controller.signal,
        tools,
        stopWhen: tools ? stepCountIs(maxSteps) : undefined,
        ...params
      })

      console.log('[AI] call: generateText 完成', {
        text: result.text?.substring(0, 100),
        hasToolCalls: !!(result as any).toolCalls,
        toolCallsCount: (result as any).toolCalls?.length,
        steps: (result as any).steps?.length,
        finishReason: result.finishReason
      })

      const reasoning = supportsReasoning(option.model) ? (result as any).reasoning : undefined
      const usage = normalizeUsage(
        extractUsage(result),
        countTokensFromMessages(trimmedMessages, option.model),
        countTokensForText(`${reasoning || ''}${result.text || ''}`, option.model)
      )

      return {
        role: 'assistant',
        content: result.text,
        reasoning_content: reasoning,
        usage
      }
    } finally {
      this.controllers.delete(requestId)
    }
  }

  async stream(option: AiOption, callbacks: StreamCallbacks, requestId?: string): Promise<AiMessage> {
    if (!option.messages || option.messages.length === 0) {
      throw new Error('AI messages are required')
    }
    const tools = this.buildTools(option.tools, option.toolContext, option.model)

    const id = requestId || this.createRequestId()
    const controller = new AbortController()
    this.controllers.set(id, controller)

    try {
      const { modelKey } = this.resolveLanguageModel(option.model)
      const params = this.resolveGenerationParams(option, option.model)
      const trimmedMessages = this.applyContextWindow(option.messages, params.contextWindow)
      const messages = await this.toSdkMessages(trimmedMessages, option.model)
      const providerConfig = this.resolveProviderConfig(option.model)
      const resolved = resolveModelId(option.model)

      if (resolved.providerId === 'anthropic' && this.hasMultimodalContent(trimmedMessages)) {
        const anthropicPayload = await this.toAnthropicMessages(trimmedMessages, option.model, providerConfig)
        const { content, reasoning } = await this.streamAnthropicMessages({
          model: resolved.modelId,
          messages: anthropicPayload.messages,
          system: anthropicPayload.system,
          apiKey: providerConfig?.apiKey,
          baseURL: providerConfig?.baseURL,
          params
        }, callbacks.onChunk, controller.signal)

        const usage = normalizeUsage(
          undefined,
          countTokensFromMessages(trimmedMessages, option.model),
          countTokensForText(`${reasoning || ''}${content || ''}`, option.model)
        )
        const finalMessage: AiMessage = {
          role: 'assistant',
          content,
          reasoning_content: reasoning || undefined,
          usage
        }
        callbacks.onEnd?.(finalMessage)
        return finalMessage
      }

      const useOpenAICompatChat = resolved.providerId === 'openai' && shouldUseChatApi(providerConfig?.baseURL)
      if (useOpenAICompatChat && !tools) {
        const { content, reasoning } = await this.streamOpenAICompatChat({
          model: resolved.modelId,
          messages: await this.toOpenAIChatMessages(option.messages, option.model),
          apiKey: providerConfig?.apiKey,
          baseURL: providerConfig?.baseURL,
          params,
          tools: option.tools
        }, callbacks.onChunk, controller.signal)

        const usage = normalizeUsage(
          undefined,
          countTokensFromMessages(trimmedMessages, option.model),
          countTokensForText(`${reasoning || ''}${content || ''}`, option.model)
        )
        const finalMessage: AiMessage = {
          role: 'assistant',
          content,
          reasoning_content: reasoning || undefined,
          usage
        }
        callbacks.onEnd?.(finalMessage)
        return finalMessage
      }
      if (useOpenAICompatChat && tools) {
        // 兼容 chat/completions 流式分支当前仅解析文本，不处理 tool_calls。
        // 启用工具时回退到 AI SDK 的 streamText，以支持工具执行与多步调用。
        console.log('[AI] stream: 检测到工具调用，使用 AI SDK streamText 分支', {
          model: option.model,
          maxToolSteps: option.maxToolSteps ?? 10
        })
      }

      const result = await streamText({
        model: modelKey,
        messages,
        abortSignal: controller.signal,
        tools,
        stopWhen: tools ? stepCountIs(option.maxToolSteps ?? 10) : undefined,
        ...params
      })

      let fullText = ''
      let reasoningText = ''
      const allowReasoning = supportsReasoning(option.model)

      if ((result as any).fullStream) {
        for await (const part of (result as any).fullStream) {
          console.log('[AI] stream part:', part?.type, part)
          if (part?.type === 'text-delta') {
            const textDelta = typeof (part as any).delta === 'string'
              ? (part as any).delta
              : (typeof (part as any).text === 'string' ? (part as any).text : '')
            if (textDelta) {
              fullText += textDelta
              callbacks.onChunk?.({ role: 'assistant', content: textDelta })
            }
          } else if (part?.type === 'reasoning-delta') {
            const reasoningDelta = typeof (part as any).delta === 'string'
              ? (part as any).delta
              : (typeof (part as any).text === 'string' ? (part as any).text : '')
            if (reasoningDelta && allowReasoning) {
              reasoningText += reasoningDelta
              callbacks.onChunk?.({ role: 'assistant', reasoning_content: reasoningDelta })
            }
          } else if (part?.type === 'tool-call') {
            console.log('[AI] tool-call detected:', part)
            callbacks.onChunk?.({
              role: 'assistant',
              tool_call: {
                id: part.toolCallId,
                name: part.toolName,
                args: (part as any).input ?? (part as any).args
              }
            } as any)
          } else if (part?.type === 'tool-result') {
            console.log('[AI] tool-result detected:', part)
            callbacks.onChunk?.({
              role: 'assistant',
              tool_result: {
                id: part.toolCallId,
                name: part.toolName,
                result: (part as any).result
              }
            } as any)
          }
        }
      } else {
        for await (const chunk of result.textStream) {
          if (!chunk) continue
          fullText += chunk
          callbacks.onChunk?.({ role: 'assistant', content: chunk })
        }
      }

      if (!fullText && (result as any).text) {
        fullText = await (result as any).text
      }
      if (!reasoningText && (result as any).reasoningText && allowReasoning) {
        reasoningText = (await (result as any).reasoningText) || ''
      }

      const usage = normalizeUsage(
        extractUsage(result),
        countTokensFromMessages(trimmedMessages, option.model),
        countTokensForText(`${reasoningText || ''}${fullText || ''}`, option.model)
      )

      const finalMessage: AiMessage = {
        role: 'assistant',
        content: fullText || '',
        reasoning_content: allowReasoning ? reasoningText || undefined : undefined,
        usage
      }
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

  async estimateTokens(input: { model?: string; messages: AiMessage[]; outputText?: string }): Promise<AiTokenBreakdown> {
    const params = this.resolveGenerationParams({ model: input.model, messages: input.messages }, input.model)
    const maxOutputTokens = params.maxOutputTokensEnabled === false ? undefined : params.maxOutputTokens
    return await estimateTokens({ ...input, maxOutputTokens })
  }

  setToolExecutor(executor?: (input: { name: string; args: unknown; context?: AiToolContext }) => Promise<unknown>): void {
    this.toolExecutor = executor
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
    const { modelKey, model } = this.resolveImageModel(input.model)
    console.info('[AI] generateImages:start', {
      modelInput: input.model,
      resolvedModel: model,
      size: input.size,
      count: input.count
    })
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
    const { modelKey, model } = this.resolveImageModel(input.model)
    console.info('[AI] editImage:start', {
      modelInput: input.model,
      resolvedModel: model,
      imageAttachmentId: input.imageAttachmentId
    })
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
      const allowReasoning = supportsReasoning(input?.model)
      const resolvedInput = this.resolveTestInput(input)
      console.info('[AI] testConnectionStream:start', {
        providerId: resolvedInput?.providerId,
        model: resolvedInput?.model,
        baseURL: resolvedInput?.baseURL
      })

      if (resolvedInput?.providerId === 'openai' && shouldUseChatApi(resolvedInput?.baseURL)) {
        const { content, reasoning } = await this.streamOpenAICompat(resolvedInput, (chunk) => {
          if (chunk.type === 'reasoning' && !allowReasoning) return
          onChunk(chunk)
        })
        console.info('[AI] testConnectionStream:success', {
          providerId: resolvedInput?.providerId,
          model: resolvedInput?.model
        })
        return { success: true, message: content || 'ok', reasoning: allowReasoning ? reasoning : '' }
      }

      const { modelKey } = this.resolveTestModel(resolvedInput)
      const params = this.resolveGenerationParams({ model: resolvedInput?.model, messages: [] }, resolvedInput?.model)
      const result = await streamText({
        model: modelKey,
        messages: [{ role: 'user', content: 'ping' }],
        ...params,
        maxOutputTokens: Math.min(params.maxOutputTokens ?? 128, 256)
      } as any)

      let fullText = ''
      let reasoning = ''

      if ((result as any).fullStream) {
        for await (const part of (result as any).fullStream) {
          console.info('[AI] testConnectionStream:chunk', {
            type: part?.type,
            delta: typeof part?.delta === 'string' ? part.delta.slice(0, 120) : undefined,
            hasDelta: typeof part?.delta === 'string' ? part.delta.length : 0
          })
          if (part?.type === 'text-delta') {
            fullText += part.delta || ''
            onChunk({ type: 'content', text: part.delta || '' })
          } else if (part?.type === 'reasoning-delta') {
            if (!allowReasoning) continue
            reasoning += part.delta || ''
            onChunk({ type: 'reasoning', text: part.delta || '' })
          }
        }
      } else {
        for await (const chunk of result.textStream) {
          fullText += chunk
          onChunk({ type: 'content', text: chunk })
        }
      }

      console.info('[AI] testConnectionStream:success', {
        providerId: resolvedInput?.providerId,
        model: resolvedInput?.model
      })
      return { success: true, message: fullText || 'ok', reasoning: allowReasoning ? reasoning : '' }
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
    const allowReasoning = supportsReasoning(input.model)
    const baseURL = (input.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')
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

          if (reasoningChunk && allowReasoning) {
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

  private async streamOpenAICompatChat(
    input: {
      model: string
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
    const allowReasoning = supportsReasoning(`openai:${input.model}`)
    const baseURL = (input.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const url = `${baseURL}/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      signal: abortSignal,
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
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

          if (reasoningChunk && allowReasoning) {
            reasoning += reasoningChunk
            onChunk?.({ role: 'assistant', reasoning_content: reasoningChunk })
          }
          if (contentChunk) {
            content += contentChunk
            onChunk?.({ role: 'assistant', content: contentChunk })
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

  private resolveTestInput(input?: { model?: string; providerId?: string; apiKey?: string; baseURL?: string }) {
    if (!input?.model || input.providerId) return input
    const providerConfig = this.resolveProviderConfig(input.model)
    if (!providerConfig?.id) return input

    return {
      ...input,
      providerId: providerConfig.id,
      apiKey: input.apiKey ?? providerConfig.apiKey,
      baseURL: input.baseURL ?? providerConfig.baseURL
    }
  }

  private async toOpenAIChatMessages(messages: AiMessage[], modelId?: string) {
    const maxFileBytes = 512 * 1024
    const providerConfig = this.resolveProviderConfig(modelId)
    const allowImages = supportsImageInput(modelId, providerConfig)
    const results: Array<{
      role: 'system' | 'user' | 'assistant'
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } }
          >
    }> = []

    for (const message of messages) {
      if (typeof message.content === 'string' || message.content === undefined) {
        results.push({ role: message.role, content: message.content || '' })
        continue
      }

      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      > = []

      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text })
          continue
        }
        if (part.type === 'image') {
          if (!allowImages) {
            parts.push({ type: 'text', text: '[image omitted: provider/model does not support image input]' })
            continue
          }
          const data = await attachmentStore.read(part.attachmentId)
          const mimeType = part.mimeType || 'image/png'
          const base64 = Buffer.from(data as any).toString('base64')
          parts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } })
          continue
        }
        if (part.type === 'file') {
          const attachment = attachmentStore.get(part.attachmentId)
          const data = await attachmentStore.read(part.attachmentId)
          const buffer = Buffer.from(data as any)
          const filename = part.filename || attachment?.filename || 'attachment'
          const mimeType = part.mimeType || attachment?.mimeType || 'application/octet-stream'
          if (buffer.length > maxFileBytes) {
            parts.push({
              type: 'text',
              text: `File ${filename} (${mimeType}) is too large to inline (${buffer.length} bytes).`
            })
            continue
          }
          const base64 = buffer.toString('base64')
          parts.push({
            type: 'text',
            text: `File ${filename} (${mimeType}) base64:\\n${base64}`
          })
        }
      }

      results.push({ role: message.role, content: parts.length > 0 ? parts : '' })
    }

    return results
  }

  private buildTools(tools?: AiTool[], context?: AiToolContext, modelId?: string) {
    if (!tools || tools.length === 0) return undefined
    if (modelId && !supportsFunctionCalling(modelId)) {
      console.log('[AI] buildTools: 模型不支持 function calling', { modelId })
      return undefined
    }
    if (modelId) {
      const toolNames = tools
        .map((item) => item?.type === 'function' ? item.function?.name : undefined)
        .filter((name): name is string => !!name)
        .map((name) => name.toLowerCase())
      if (toolNames.some((name) => name.includes('web_search') || name.includes('web-search'))) {
        if (!supportsWebSearch(modelId)) {
          throw new Error('Model does not support web_search capability')
        }
      }
      if (toolNames.some((name) => name.includes('embedding') || name.includes('embed'))) {
        if (!supportsEmbedding(modelId)) {
          throw new Error('Model does not support embedding capability')
        }
      }
      if (toolNames.some((name) => name.includes('rerank') || name.includes('re-rank'))) {
        if (!supportsRerank(modelId)) {
          throw new Error('Model does not support rerank capability')
        }
      }
    }
    if (!this.toolExecutor) {
      console.error('[AI] buildTools: toolExecutor 未配置')
      throw new Error('AI tool executor is not configured')
    }
    console.log('[AI] buildTools: 构建工具', {
      toolCount: tools.length,
      toolNames: tools.map(t => t.function?.name),
      hasExecutor: !!this.toolExecutor,
      context
    })
    const toolEntries = tools
      .map((item) => (item?.type === 'function' ? item.function : undefined))
      .filter((item): item is NonNullable<AiTool['function']> => !!item && !!item.name)
      .map((fn) => {
        const schema = fn.parameters || { type: 'object', properties: {} }
        return [
          fn.name,
          tool({
            description: fn.description,
            inputSchema: jsonSchema(schema as any),
            execute: async (input: unknown) => {
              console.log('[AI] 工具执行开始', { toolName: fn.name, input, context })
              const result = await this.toolExecutor?.({ name: fn.name, args: input, context })
              console.log('[AI] 工具执行完成', { toolName: fn.name, result })
              return result
            }
          })
        ] as const
      })

    if (toolEntries.length === 0) return undefined
    return Object.fromEntries(toolEntries)
  }

  async fetchModels(input: { providerId: string; baseURL?: string; apiKey?: string }): Promise<{ models: AiModel[]; message?: string }> {
    if (input.providerId !== 'openai') {
      return { models: [], message: '当前仅支持 OpenAI 兼容接口拉取模型列表' }
    }

    const baseURL = (input.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')
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

    const providerConfig = this.resolveProviderConfig(modelId, providerId)
    const provider = buildProvider({
      id: providerId,
      enabled: true,
      apiKey: providerConfig?.apiKey,
      baseURL: providerConfig?.baseURL,
      headers: providerConfig?.headers
    })
    console.info('[AI] resolveImageModel', {
      modelInput: modelId,
      resolvedModel: `${providerId}:${resolvedId}`,
      providerId,
      providerLabel: providerConfig?.label || providerConfig?.id,
      baseURL: providerConfig?.baseURL
    })
    if (provider) {
      const imageModelFactory = (provider as any).imageModel || (provider as any).image
      if (typeof imageModelFactory === 'function') {
        return { model: `${providerId}:${resolvedId}`, modelKey: imageModelFactory.call(provider, resolvedId) }
      }
    }

    const registry = getProviderRegistry()
    const modelKey = registry.imageModel(`${providerId}:${resolvedId}`)
    return { model: `${providerId}:${resolvedId}`, modelKey }
  }

  private async toSdkMessages(messages: AiMessage[], modelId?: string) {
    const providerConfig = this.resolveProviderConfig(modelId)
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
          if (!supportsImageInput(modelId, providerConfig)) {
            parts.push({ type: 'text', text: '[image omitted: provider/model does not support image input]' })
            continue
          }
          const image = await attachmentStore.read(part.attachmentId)
          let mediaType = part.mimeType
          if (providerConfig?.id === 'anthropic' && mediaType === 'image/jpg') {
            mediaType = 'image/jpeg'
          }
          parts.push({ type: 'image', image, mediaType })
        } else if (part.type === 'file') {
          const attachment = attachmentStore.get(part.attachmentId)
          const filename = part.filename || attachment?.filename || 'attachment'
          const mimeType = part.mimeType || attachment?.mimeType || 'application/octet-stream'
          const size = attachment?.size ?? 0
          const sizeLimit = getFileSizeLimit(modelId, providerConfig, mimeType)

          if (mimeType === 'application/pdf' && supportsPdfInput(modelId, providerConfig)) {
            if (size > sizeLimit && supportsLargeFileUpload(modelId, providerConfig)) {
              const remote = await this.uploadAttachmentToProviderInternal({
                attachmentId: part.attachmentId,
                filename,
                mimeType,
                purpose: this.getUploadPurpose(modelId)
              }, providerConfig)
              if (remote) {
                if (providerConfig?.id === 'openai') {
                  parts.push({
                    type: 'file',
                    data: `fileid://${remote.fileId}`,
                    mediaType: mimeType,
                    filename
                  })
                  continue
                }
                if (remote.uri) {
                  parts.push({
                    type: 'file',
                    data: remote.uri,
                    mediaType: mimeType,
                    filename
                  })
                  continue
                }
              }
            }
          }

          const data = await attachmentStore.read(part.attachmentId)
          parts.push({ type: 'file', data, mediaType: mimeType, filename })
        }
      }

      results.push({ role: message.role, content: parts })
    }

    return results
  }

  private hasMultimodalContent(messages: AiMessage[]): boolean {
    return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type !== 'text'))
  }

  private async toAnthropicMessages(messages: AiMessage[], modelId: string | undefined, providerConfig?: AiProviderConfig) {
    let systemText = ''
    const results: Array<{
      role: 'user' | 'assistant'
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
        | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } | { type: 'file'; file_id: string }; title?: string }
      >
    }> = []

    for (const message of messages) {
      if (typeof message.content === 'string' || message.content === undefined) {
        if (message.role === 'system') {
          systemText += `${message.content || ''}\n`
          continue
        }
        results.push({ role: message.role, content: [{ type: 'text', text: message.content || '' }] })
        continue
      }

      const parts: Array<any> = []
      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text })
          continue
        }
        if (part.type === 'image') {
          const image = await attachmentStore.read(part.attachmentId)
          let mediaType = part.mimeType || 'image/png'
          if (mediaType === 'image/jpg') mediaType = 'image/jpeg'
          parts.push({
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: Buffer.from(image).toString('base64') }
          })
          continue
        }
        if (part.type === 'file') {
          const attachment = attachmentStore.get(part.attachmentId)
          const filename = part.filename || attachment?.filename || 'document'
          const mimeType = part.mimeType || attachment?.mimeType || 'application/octet-stream'

          if (mimeType === 'application/pdf' || mimeType === 'text/plain') {
            const remote = await this.uploadAttachmentToProviderInternal({
              attachmentId: part.attachmentId,
              filename,
              mimeType,
              purpose: this.getUploadPurpose(modelId)
            }, providerConfig)

            if (remote?.fileId) {
              parts.push({
                type: 'document',
                source: { type: 'file', file_id: remote.fileId },
                title: filename
              })
              continue
            }

            const data = await attachmentStore.read(part.attachmentId)
            if (mimeType === 'text/plain') {
              parts.push({
                type: 'document',
                source: { type: 'base64', media_type: 'text/plain', data: Buffer.from(data).toString('base64') },
                title: filename
              })
              continue
            }
            parts.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(data).toString('base64') },
              title: filename
            })
            continue
          }

          parts.push({ type: 'text', text: `[file omitted: ${filename} (${mimeType}) is not supported by Anthropic]` })
        }
      }

      if (message.role === 'system') {
        const merged = parts
          .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
          .filter(Boolean)
          .join('\n')
        systemText += `${merged}\n`
        continue
      }

      results.push({ role: message.role, content: parts.length > 0 ? parts : [{ type: 'text', text: '' }] })
    }

    return { system: systemText.trim() || undefined, messages: results }
  }

  private async callAnthropicMessages(input: {
    model: string
    messages: Array<any>
    system?: string
    apiKey?: string
    baseURL?: string
    params: AiModelParameters
  }): Promise<{ content: string; reasoning: string }> {
    const baseURL = (input.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '')
    const url = `${baseURL}/messages`
    const apiKey = input.apiKey
    if (!apiKey) {
      throw new Error('Anthropic API key is required')
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14'
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        system: input.system,
        max_tokens: input.params.maxOutputTokens ?? 512,
        temperature: input.params.temperature,
        top_p: input.params.topP,
        stop_sequences: input.params.stopSequences,
        stream: false
      })
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic request failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string; thinking?: string }> }
    let content = ''
    let reasoning = ''
    for (const block of data.content || []) {
      if (block.type === 'text' && block.text) content += block.text
      if (block.type === 'thinking' && block.thinking) reasoning += block.thinking
    }
    return { content, reasoning }
  }

  private async streamAnthropicMessages(
    input: {
      model: string
      messages: Array<any>
      system?: string
      apiKey?: string
      baseURL?: string
      params: AiModelParameters
    },
    onChunk?: (chunk: AiMessage) => void,
    abortSignal?: AbortSignal
  ): Promise<{ content: string; reasoning: string }> {
    const baseURL = (input.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '')
    const url = `${baseURL}/messages`
    const apiKey = input.apiKey
    if (!apiKey) {
      throw new Error('Anthropic API key is required')
    }

    const res = await fetch(url, {
      method: 'POST',
      signal: abortSignal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14'
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        system: input.system,
        max_tokens: input.params.maxOutputTokens ?? 512,
        temperature: input.params.temperature,
        top_p: input.params.topP,
        stop_sequences: input.params.stopSequences,
        stream: true
      })
    })

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic request failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
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
          const type = json.type
          if (type === 'content_block_delta') {
            const delta = json.delta || {}
            if (delta.text) {
              content += delta.text
              onChunk?.({ role: 'assistant', content: delta.text })
            }
            if (delta.thinking) {
              reasoning += delta.thinking
              onChunk?.({ role: 'assistant', reasoning_content: delta.thinking })
            }
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    return { content, reasoning }
  }

  private getUploadPurpose(modelId?: string): string | undefined {
    if (!modelId) return undefined
    const normalized = modelId.toLowerCase()
    if (normalized.includes('qwen-long') || normalized.includes('qwen-doc')) {
      return 'file-extract'
    }
    return 'assistants'
  }

  async uploadAttachmentToProvider(
    input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }
  ): Promise<{ providerId: string; fileId: string; uri?: string }> {
    const providerConfig = input.model
      ? this.resolveProviderConfig(input.model)
      : this.resolveProviderById(input.providerId)
    if (!providerConfig) {
      console.error('[AI] uploadAttachmentToProvider:provider_not_found', { input })
      throw new Error('Provider config not found for attachment upload')
    }
    const attachment = attachmentStore.get(input.attachmentId)
    if (!attachment) {
      console.error('[AI] uploadAttachmentToProvider:attachment_not_found', { attachmentId: input.attachmentId })
      throw new Error(`Attachment not found: ${input.attachmentId}`)
    }
    const filename = attachment?.filename || 'attachment'
    const mimeType = attachment?.mimeType || 'application/octet-stream'
    try {
      const remote = await this.uploadAttachmentToProviderInternal(
        { attachmentId: input.attachmentId, filename, mimeType, purpose: input.purpose },
        providerConfig
      )
      if (!remote?.fileId) {
        console.error('[AI] uploadAttachmentToProvider:missing_file_id', {
          providerId: providerConfig.id,
          attachmentId: input.attachmentId
        })
        throw new Error('Failed to upload attachment to provider: missing file id')
      }
      return { providerId: String(providerConfig.id), fileId: remote.fileId, uri: remote.uri }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[AI] uploadAttachmentToProvider:fail', {
        providerId: providerConfig.id,
        attachmentId: input.attachmentId,
        baseURL: providerConfig.baseURL,
        error: message
      })
      throw new Error(message)
    }
  }

  private async uploadAttachmentToProviderInternal(
    input: { attachmentId: string; filename: string; mimeType: string; purpose?: string },
    providerConfig?: AiProviderConfig
  ): Promise<{ fileId: string; uri?: string } | null> {
    if (!providerConfig) return null
    if (!providerConfig.apiKey || !providerConfig.baseURL) {
      console.warn('[AI] uploadAttachmentToProvider:missing_credentials', {
        providerId: providerConfig.id,
        hasApiKey: Boolean(providerConfig.apiKey),
        hasBaseURL: Boolean(providerConfig.baseURL)
      })
      return null
    }
    const cached = attachmentStore.getRemote(input.attachmentId, {
      providerId: String(providerConfig.id),
      purpose: input.purpose
    })
    if (cached?.fileId) {
      return { fileId: cached.fileId, uri: cached.uri }
    }

    try {
      const service = FileServiceManager.getInstance().getService(providerConfig)
      const buffer = await attachmentStore.read(input.attachmentId)
      const result = await service.uploadFile({
        buffer,
        filename: input.filename,
        mimeType: input.mimeType,
        purpose: input.purpose
      })
      if (result?.fileId) {
        attachmentStore.setRemote(input.attachmentId, {
          providerId: String(providerConfig.id),
          fileId: result.fileId,
          purpose: input.purpose,
          uri: result.uri
        })
        return { fileId: result.fileId, uri: result.uri }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[AI] uploadAttachmentToProvider:service_fail', {
        providerId: providerConfig.id,
        attachmentId: input.attachmentId,
        error: message
      })
    }

    return null
  }

  private resolveProviderById(providerId?: string): AiProviderConfig | undefined {
    if (!providerId) return undefined
    const settings = getAiSettings()
    const matches = settings.providers.filter((provider) => String(provider.id) === String(providerId))
    if (matches.length === 1) return matches[0]
    if (matches.length > 0) return matches[0]
    const byLabel = settings.providers.find((provider) => (provider.label || provider.id) === providerId)
    return byLabel
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
      const matches = settings.providers.filter((provider) => String(provider.id) === String(providerId))
      if (matches.length === 1) return matches[0]
      if (matches.length > 1 && modelId) {
        const byDefaultModel = matches.find((provider) => provider.defaultModel === modelId)
        if (byDefaultModel) return byDefaultModel
      }
      if (matches.length > 0) return matches[0]
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

function shouldUseChatApi(baseURL?: string): boolean {
  if (!baseURL) return false
  return !baseURL.includes('api.openai.com')
}

function extractUsage(result: any): { inputTokens?: number; outputTokens?: number } | undefined {
  const usage = result?.usage || result?.response?.usage || result?.metadata?.usage
  if (!usage) return undefined
  const inputTokens =
    usage.inputTokens ??
    usage.promptTokens ??
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.totalTokens ??
    usage.total_tokens
  const outputTokens =
    usage.outputTokens ??
    usage.completionTokens ??
    usage.completion_tokens ??
    usage.output_tokens
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return {
    inputTokens: inputTokens !== undefined ? Number(inputTokens) : undefined,
    outputTokens: outputTokens !== undefined ? Number(outputTokens) : undefined
  }
}

function normalizeUsage(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  fallbackInput: number,
  fallbackOutput: number
): AiTokenBreakdown {
  return {
    inputTokens: usage?.inputTokens !== undefined ? usage.inputTokens : fallbackInput,
    outputTokens: usage?.outputTokens !== undefined ? usage.outputTokens : fallbackOutput
  }
}
