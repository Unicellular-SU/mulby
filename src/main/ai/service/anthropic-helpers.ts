import type { AiMessage, AiModelParameters, AiProviderConfig } from '../../../shared/types/ai'
import { getRotatedApiKey } from '../../../shared/ai/apiKeyPool'
import { attachmentStore } from '../attachments'
import { buildApiKeyScope } from './utils'

type AnthropicContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } | { type: 'file'; file_id: string }; title?: string }

type UploadAttachmentToProviderInternal = (
  input: { attachmentId: string; filename: string; mimeType: string; purpose?: string },
  providerConfig?: AiProviderConfig
) => Promise<{ fileId: string; uri?: string } | null>

export async function toAnthropicMessages(input: {
  messages: AiMessage[]
  modelId?: string
  providerConfig?: AiProviderConfig
  getUploadPurpose: (modelId?: string) => string | undefined
  uploadAttachmentToProviderInternal: UploadAttachmentToProviderInternal
}): Promise<{
  system?: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: AnthropicContentPart[]
  }>
}> {
  let systemText = ''
  const results: Array<{
    role: 'user' | 'assistant'
    content: AnthropicContentPart[]
  }> = []

  for (const message of input.messages) {
    if (typeof message.content === 'string' || message.content === undefined) {
      if (message.role === 'system') {
        systemText += `${message.content || ''}\n`
        continue
      }
      results.push({ role: message.role, content: [{ type: 'text', text: message.content || '' }] })
      continue
    }

    const parts: AnthropicContentPart[] = []
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
          const remote = await input.uploadAttachmentToProviderInternal({
            attachmentId: part.attachmentId,
            filename,
            mimeType,
            purpose: input.getUploadPurpose(input.modelId)
          }, input.providerConfig)

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
        .map((p) => (p.type === 'text' ? p.text : ''))
        .filter(Boolean)
        .join('\n')
      systemText += `${merged}\n`
      continue
    }

    results.push({ role: message.role, content: parts.length > 0 ? parts : [{ type: 'text', text: '' }] })
  }

  return { system: systemText.trim() || undefined, messages: results }
}

export async function callAnthropicMessages(input: {
  model: string
  messages: Array<Record<string, unknown>>
  system?: string
  apiKey?: string
  baseURL?: string
  params: AiModelParameters
}): Promise<{ content: string; reasoning: string }> {
  const baseURL = (input.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '')
  const url = `${baseURL}/messages`
  const apiKey = getRotatedApiKey(input.apiKey, buildApiKeyScope({ providerType: 'anthropic', baseURL }))
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

export async function streamAnthropicMessages(
  input: {
    model: string
    messages: Array<Record<string, unknown>>
    system?: string
    apiKey?: string
    baseURL?: string
    params: AiModelParameters
  },
  options: {
    onChunk?: (chunk: AiMessage) => void
    abortSignal?: AbortSignal
    emitTextChunk: (onChunk: ((chunk: AiMessage) => void) | undefined, text: string) => void
    emitReasoningChunk: (onChunk: ((chunk: AiMessage) => void) | undefined, text: string) => void
  }
): Promise<{ content: string; reasoning: string }> {
  const baseURL = (input.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '')
  const url = `${baseURL}/messages`
  const apiKey = getRotatedApiKey(input.apiKey, buildApiKeyScope({ providerType: 'anthropic', baseURL }))
  if (!apiKey) {
    throw new Error('Anthropic API key is required')
  }

  const res = await fetch(url, {
    method: 'POST',
    signal: options.abortSignal,
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
            options.emitTextChunk(options.onChunk, delta.text)
          }
          if (delta.thinking) {
            reasoning += delta.thinking
            options.emitReasoningChunk(options.onChunk, delta.thinking)
          }
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  return { content, reasoning }
}
