import type { AiProviderConfig } from '../../../shared/types/ai'

export interface FileUploadResult {
  fileId: string
  displayName?: string
  status: 'success' | 'processing' | 'failed' | 'unknown'
  uri?: string
}

export abstract class BaseFileService {
  protected readonly provider: AiProviderConfig

  protected constructor(provider: AiProviderConfig) {
    this.provider = provider
  }

  abstract uploadFile(input: { buffer: Buffer; filename: string; mimeType?: string; purpose?: string }): Promise<FileUploadResult>
  abstract deleteFile(fileId: string): Promise<void>
  abstract retrieveFile(fileId: string): Promise<FileUploadResult>
}
