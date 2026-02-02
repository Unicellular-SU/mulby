export interface AiMessageContentText {
  type: 'text'
  text: string
}

export interface AiMessageContentImage {
  type: 'image'
  attachmentId: string
  mimeType?: string
}

export interface AiMessageContentFile {
  type: 'file'
  attachmentId: string
  mimeType?: string
  filename?: string
}

export type AiMessageContent = AiMessageContentText | AiMessageContentImage | AiMessageContentFile

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content?: string | AiMessageContent[]
  reasoning_content?: string
}

export interface AiToolFunction {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
  }
  required?: string[]
}

export interface AiTool {
  type: 'function'
  function?: AiToolFunction
}

export interface AiOption {
  model?: string
  messages: AiMessage[]
  tools?: AiTool[]
}

export interface AiModel {
  id: string
  label: string
  description: string
  icon?: string
  cost: number
}

export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'custom'

export interface AiProviderConfig {
  id: AiProviderId | string
  label?: string
  enabled: boolean
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
}

export interface AiSettings {
  providers: AiProviderConfig[]
  defaultModel?: string
  models?: AiModel[]
}

export interface AiAttachmentRef {
  attachmentId: string
  mimeType: string
  size: number
  filename?: string
  expiresAt?: string
  purpose?: string
}

export interface AiCostBreakdown {
  inputTokens: number
  outputTokens: number
  attachmentCost: number
  totalCost: number
}

export interface AiPromiseLike<T> extends Promise<T> {
  abort: () => void
}

export interface AiApi {
  call: (option: AiOption, streamCallback?: (chunk: AiMessage) => void) => AiPromiseLike<AiMessage>
  allModels: () => Promise<AiModel[]>
  testConnection: (input?: { model?: string; providerId?: string; apiKey?: string; baseURL?: string }) => Promise<{ success: boolean; message?: string }>
  testConnectionStream: (
    input: { model?: string; providerId?: string; apiKey?: string; baseURL?: string },
    onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
  ) => AiPromiseLike<{ success: boolean; message?: string; reasoning?: string }>
  models: {
    fetch: (input: { providerId: string; baseURL?: string; apiKey?: string }) => Promise<{ models: AiModel[]; message?: string }>
  }
  abort: (requestId: string) => Promise<void>
  settings: {
    get: () => Promise<AiSettings>
    update: (next: Partial<AiSettings>) => Promise<AiSettings>
  }
  attachments: {
    upload: (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => Promise<AiAttachmentRef>
    get: (attachmentId: string) => Promise<AiAttachmentRef | null>
    delete: (attachmentId: string) => Promise<void>
  }
  cost: {
    estimate: (input: { model: string; messages: AiMessage[]; attachments?: AiAttachmentRef[] }) => Promise<AiCostBreakdown>
  }
  images: {
    generate: (input: { prompt: string; model: string; size?: string; count?: number }) => Promise<{ images: string[]; cost: AiCostBreakdown }>
    edit: (input: { imageAttachmentId: string; prompt: string; model: string }) => Promise<{ images: string[]; cost: AiCostBreakdown }>
  }
  videos: {
    generate: (input: { prompt: string; model: string; duration?: number; size?: string }) => Promise<{ videos: string[]; cost: AiCostBreakdown }>
  }
}
