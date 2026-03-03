import type { AiMessage, AiProviderConfig } from '../../../shared/types/ai'
import type { ModelMessage } from 'ai'
import { attachmentStore } from '../attachments'
import {
  getFileSizeLimit,
  supportsImageInput,
  supportsLargeFileUpload,
  supportsPdfInput
} from '../modelCapabilities'

export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >
  reasoning_content?: string
}

export async function toOpenAIChatMessages(input: {
  messages: AiMessage[]
  modelId?: string
  includeReasoningContent?: boolean
  resolveExecutionProviderContext: (modelId?: string) => { providerType: string; providerConfig?: AiProviderConfig }
}): Promise<OpenAIChatMessage[]> {
  const maxFileBytes = 512 * 1024
  const { providerConfig } = input.resolveExecutionProviderContext(input.modelId)
  const allowImages = supportsImageInput(input.modelId, providerConfig)
  const results: OpenAIChatMessage[] = []

  for (const message of input.messages) {
    if (typeof message.content === 'string' || message.content === undefined) {
      const chatMessage: OpenAIChatMessage = { role: message.role, content: message.content || '' }
      if (input.includeReasoningContent && message.role === 'assistant' && message.reasoning_content) {
        chatMessage.reasoning_content = message.reasoning_content
      }
      results.push(chatMessage)
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
        const base64 = Buffer.from(data).toString('base64')
        parts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } })
        continue
      }
      if (part.type === 'file') {
        const attachment = attachmentStore.get(part.attachmentId)
        const data = await attachmentStore.read(part.attachmentId)
        const buffer = Buffer.from(data)
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

    const chatMessage: OpenAIChatMessage = { role: message.role, content: parts.length > 0 ? parts : '' }
    if (input.includeReasoningContent && message.role === 'assistant' && message.reasoning_content) {
      chatMessage.reasoning_content = message.reasoning_content
    }
    results.push(chatMessage)
  }

  return results
}

export async function toSdkMessages(input: {
  messages: AiMessage[]
  modelId?: string
  resolveExecutionProviderContext: (modelId?: string) => { providerType: string; providerConfig?: AiProviderConfig }
  getUploadPurpose: (modelId?: string) => string | undefined
  uploadAttachmentToProviderInternal: (
    item: { attachmentId: string; filename: string; mimeType: string; purpose?: string },
    providerConfig?: AiProviderConfig
  ) => Promise<{ fileId: string; uri?: string } | null>
}): Promise<ModelMessage[]> {
  const { providerType, providerConfig } = input.resolveExecutionProviderContext(input.modelId)
  const results: ModelMessage[] = []
  for (const message of input.messages) {
    if (typeof message.content === 'string' || message.content === undefined) {
      results.push({ role: message.role, content: message.content || '' } as ModelMessage)
      continue
    }

    const parts: Array<Record<string, unknown>> = []
    for (const part of message.content) {
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text })
      } else if (part.type === 'image') {
        if (!supportsImageInput(input.modelId, providerConfig)) {
          parts.push({ type: 'text', text: '[image omitted: provider/model does not support image input]' })
          continue
        }
        const image = await attachmentStore.read(part.attachmentId)
        let mediaType = part.mimeType
        if (providerType === 'anthropic' && mediaType === 'image/jpg') {
          mediaType = 'image/jpeg'
        }
        parts.push({ type: 'image', image, mediaType })
      } else if (part.type === 'file') {
        const attachment = attachmentStore.get(part.attachmentId)
        const filename = part.filename || attachment?.filename || 'attachment'
        const mimeType = part.mimeType || attachment?.mimeType || 'application/octet-stream'
        const size = attachment?.size ?? 0
        const sizeLimit = getFileSizeLimit(input.modelId, providerConfig, mimeType)

        if (mimeType === 'application/pdf' && supportsPdfInput(input.modelId, providerConfig)) {
          if (size > sizeLimit && supportsLargeFileUpload(input.modelId, providerConfig)) {
            const remote = await input.uploadAttachmentToProviderInternal({
              attachmentId: part.attachmentId,
              filename,
              mimeType,
              purpose: input.getUploadPurpose(input.modelId)
            }, providerConfig)
            if (remote) {
              if (providerType === 'openai') {
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

    results.push({ role: message.role, content: parts } as ModelMessage)
  }

  return results
}
