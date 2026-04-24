import type { AiProviderConfig } from '../../../shared/types/ai'
import { getRotatedApiKey, hasApiKey } from '../../../shared/ai/apiKeyPool'
import { attachmentStore } from '../attachments'
import { FileServiceManager } from '../fileServices/FileServiceManager'
import { getProviderType } from '../providers'
import { buildApiKeyScope } from './utils'
import log from 'electron-log'

export function getUploadPurpose(modelId?: string): string | undefined {
  if (!modelId) return undefined
  const normalized = modelId.toLowerCase()
  if (normalized.includes('qwen-long') || normalized.includes('qwen-doc')) {
    return 'file-extract'
  }
  return 'assistants'
}

export async function uploadAttachmentToProviderInternal(
  input: { attachmentId: string; filename: string; mimeType: string; purpose?: string },
  providerConfig?: AiProviderConfig
): Promise<{ fileId: string; uri?: string } | null> {
  if (!providerConfig) return null
  if (!hasApiKey(providerConfig.apiKey) || !providerConfig.baseURL) {
    log.warn('[AI] uploadAttachmentToProvider:missing_credentials', {
      providerId: providerConfig.id,
      hasApiKey: hasApiKey(providerConfig.apiKey),
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
    const requestApiKey = getRotatedApiKey(
      providerConfig.apiKey,
      buildApiKeyScope({
        providerId: String(providerConfig.id),
        providerType: getProviderType(providerConfig),
        baseURL: providerConfig.baseURL
      })
    )
    if (!requestApiKey) {
      return null
    }
    const providerWithRequestKey: AiProviderConfig = {
      ...providerConfig,
      apiKey: requestApiKey
    }
    const service = FileServiceManager.getInstance().getService(providerWithRequestKey)
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
    log.warn('[AI] uploadAttachmentToProvider:service_fail', {
      providerId: providerConfig.id,
      attachmentId: input.attachmentId,
      error: message
    })
  }

  return null
}
