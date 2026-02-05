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
  params?: AiModelParameters
  toolContext?: AiToolContext
}

export interface AiToolContext {
  pluginName?: string
}

export interface AiModelParameters {
  contextWindow?: number
  temperatureEnabled?: boolean
  topPEnabled?: boolean
  maxOutputTokensEnabled?: boolean
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stopSequences?: string[]
  seed?: number
}

export type AiModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank'

export interface AiModelCapability {
  type: AiModelType
  /**
   * 是否为用户手动选择，如果为true，则表示用户手动选择了该类型，否则表示用户手动禁止了该模型；如果为undefined，则表示使用默认值
   */
  isUserSelected?: boolean
}

export interface AiModel {
  id: string
  label: string
  description: string
  icon?: string
  providerLabel?: string
  params?: AiModelParameters
  capabilities?: AiModelCapability[]
}

export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'custom'

export interface AiProviderConfig {
  id: AiProviderId | string
  label?: string
  enabled: boolean
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  defaultModel?: string
  defaultParams?: AiModelParameters
}

export interface AiSettings {
  providers: AiProviderConfig[]
  models?: AiModel[]
  defaultParams?: AiModelParameters
}

export interface AiAttachmentRef {
  attachmentId: string
  mimeType: string
  size: number
  filename?: string
  expiresAt?: string
  purpose?: string
}

export interface AiTokenBreakdown {
  inputTokens: number
  outputTokens: number
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
    uploadToProvider: (input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }) => Promise<{ providerId: string; fileId: string; uri?: string }>
  }
  tokens: {
    estimate: (input: { model: string; messages: AiMessage[]; attachments?: AiAttachmentRef[] }) => Promise<AiTokenBreakdown>
  }
  images: {
    generate: (input: { prompt: string; model: string; size?: string; count?: number }) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
    edit: (input: { imageAttachmentId: string; prompt: string; model: string }) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
  }
  videos: {
    generate: (input: { prompt: string; model: string; duration?: number; size?: string }) => Promise<{ videos: string[]; tokens: AiTokenBreakdown }>
  }
}
