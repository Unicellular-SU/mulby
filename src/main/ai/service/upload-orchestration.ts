import type { AiAttachmentRef, AiProviderConfig } from '../../../shared/types/ai'
import log from 'electron-log'

interface ResolveUploadProviderConfigInput {
  model?: string
  providerId?: string
  resolveExecutionProviderContext: (input: {
    modelId: string
  }) => { providerConfig?: AiProviderConfig }
  resolveProviderById: (providerId?: string) => AiProviderConfig | undefined
}

interface ResolveUploadAttachmentMetaInput {
  attachmentId: string
  getAttachment: (attachmentId: string) => AiAttachmentRef | null | undefined
}

export function resolveUploadProviderConfig(input: ResolveUploadProviderConfigInput): AiProviderConfig {
  const providerConfig = input.model
    ? input.resolveExecutionProviderContext({ modelId: input.model }).providerConfig
    : input.resolveProviderById(input.providerId)
  if (!providerConfig) {
    log.error('[AI] uploadAttachmentToProvider:provider_not_found', {
      model: input.model,
      providerId: input.providerId
    })
    throw new Error('Provider config not found for attachment upload')
  }
  return providerConfig
}

export function resolveUploadAttachmentMeta(
  input: ResolveUploadAttachmentMetaInput
): { filename: string; mimeType: string } {
  const attachment = input.getAttachment(input.attachmentId)
  if (!attachment) {
    log.error('[AI] uploadAttachmentToProvider:attachment_not_found', {
      attachmentId: input.attachmentId
    })
    throw new Error(`Attachment not found: ${input.attachmentId}`)
  }
  return {
    filename: attachment.filename || 'attachment',
    mimeType: attachment.mimeType || 'application/octet-stream'
  }
}

export async function executeUploadAttachmentOrchestration(input: {
  attachmentId: string
  purpose?: string
  providerConfig: AiProviderConfig
  filename: string
  mimeType: string
  uploadAttachmentToProviderInternal: (
    input: { attachmentId: string; filename: string; mimeType: string; purpose?: string },
    providerConfig?: AiProviderConfig
  ) => Promise<{ fileId: string; uri?: string } | null>
}): Promise<{ providerId: string; fileId: string; uri?: string }> {
  try {
    const remote = await input.uploadAttachmentToProviderInternal(
      {
        attachmentId: input.attachmentId,
        filename: input.filename,
        mimeType: input.mimeType,
        purpose: input.purpose
      },
      input.providerConfig
    )
    if (!remote?.fileId) {
      log.error('[AI] uploadAttachmentToProvider:missing_file_id', {
        providerId: input.providerConfig.id,
        attachmentId: input.attachmentId
      })
      throw new Error('Failed to upload attachment to provider: missing file id')
    }
    return {
      providerId: String(input.providerConfig.id),
      fileId: remote.fileId,
      uri: remote.uri
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('[AI] uploadAttachmentToProvider:fail', {
      providerId: input.providerConfig.id,
      attachmentId: input.attachmentId,
      baseURL: input.providerConfig.baseURL,
      error: message
    })
    throw new Error(message)
  }
}
