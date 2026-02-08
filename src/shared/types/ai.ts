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
  /**
   * 流式事件类型（仅 onChunk 过程中出现），用于统一 text/reasoning/tool/error/end 协议。
   */
  chunkType?: 'text' | 'reasoning' | 'tool-call' | 'tool-result' | 'error' | 'end'
  tool_call?: {
    id: string
    name: string
    args?: unknown
  }
  tool_result?: {
    id: string
    name: string
    result?: unknown
  }
  error?: {
    message: string
    code?: string
    category?: string
    retryable?: boolean
    statusCode?: number
  }
  usage?: AiTokenBreakdown
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
  maxToolSteps?: number  // 工具调用的最大步骤数，默认为 10
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
  /**
   * 绑定的 Provider 实例 ID（优先级高于 providerLabel）。
   */
  providerRef?: string
  providerLabel?: string
  /**
   * new-api / cherryin 族模型的协议路由类型。
   */
  endpointType?: AiEndpointType
  /**
   * 模型声明支持的 endpoint 类型列表（可选）。
   */
  supportedEndpointTypes?: AiEndpointType[]
  params?: AiModelParameters
  capabilities?: AiModelCapability[]
}

export type AiProviderId =
  | 'openai'
  | 'openai-response'
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'gemini'
  | 'deepseek'
  | 'openrouter'
  | 'azure'
  | 'azure-openai'
  | 'new-api'
  | 'cherryin'
  | 'ollama'
  | 'custom'

export type AiEndpointType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'image-generation'
  | 'jina-rerank'

export interface AiProviderConfig {
  /**
   * Provider 实例 ID（用于区分多个同类型实例，如 v3-openai / official-openai）。
   */
  id: AiProviderId | string
  /**
   * Provider 实现类型（不填时向后兼容为 id）。
   */
  type?: AiProviderId | string
  label?: string
  enabled: boolean
  /**
   * 支持单 key 或多 key（逗号分隔，支持转义逗号：`\\,`）。
   */
  apiKey?: string
  baseURL?: string
  apiVersion?: string
  anthropicBaseURL?: string
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

export interface AiImageGenerateProgressChunk {
  type: 'status' | 'preview'
  stage?: 'start' | 'partial' | 'finalizing' | 'completed' | 'fallback'
  message?: string
  image?: string
  index?: number
  received?: number
  total?: number
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
    estimate: (input: {
      model?: string
      messages: AiMessage[]
      attachments?: AiAttachmentRef[]
      outputText?: string
    }) => Promise<AiTokenBreakdown>
  }
  images: {
    generate: (input: { prompt: string; model: string; size?: string; count?: number }) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
    generateStream: (
      input: { prompt: string; model: string; size?: string; count?: number },
      onChunk: (chunk: AiImageGenerateProgressChunk) => void
    ) => AiPromiseLike<{ images: string[]; tokens: AiTokenBreakdown }>
    edit: (input: { imageAttachmentId: string; prompt: string; model: string }) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
  }
}
