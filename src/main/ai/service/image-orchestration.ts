import { buildProviderIdCounts } from '../../../shared/ai/providerValidation'
import { getProviderProtocolCapabilityRule } from '../../../shared/ai/providerCapabilityGovernance'
import type {
  AiImageGenerateProgressChunk,
  AiProviderConfig,
  AiTokenBreakdown
} from '../../../shared/types/ai'
import type { ProviderMethodAdapter } from '../providerMethodAdapters'
import { getProviderMethodAdapter } from '../providerMethodAdapters'

type RetryStage = 'generateImages' | 'editImage'

interface ResolveImageProviderInput {
  stage: 'generateImages' | 'generateImagesStream' | 'editImage'
  model: string
  providers: AiProviderConfig[]
  resolveExecutionProviderContext: (input: {
    modelId: string
  }) => { providerType: string; providerConfig?: AiProviderConfig }
}

interface ResolvedImageProvider {
  providerType: string
  providerConfig?: AiProviderConfig
  methodAdapter: ProviderMethodAdapter
}

export function resolveImageProvider(input: ResolveImageProviderInput): ResolvedImageProvider {
  const { providerType, providerConfig } = input.resolveExecutionProviderContext({ modelId: input.model })
  const providerForCapability: AiProviderConfig = providerConfig || {
    id: providerType,
    type: providerType,
    enabled: true
  }
  const providerIdCounts = buildProviderIdCounts(input.providers)
  const imageCapability = getProviderProtocolCapabilityRule(providerForCapability, 'image', providerIdCounts)
  console.info('[AI] capability:protocol', {
    stage: input.stage,
    providerType,
    model: input.model,
    capability: imageCapability.capability,
    enabled: imageCapability.enabled,
    source: imageCapability.source,
    reason: imageCapability.reason
  })
  if (!imageCapability.enabled) {
    throw new Error(imageCapability.reason)
  }
  return {
    providerType,
    providerConfig,
    methodAdapter: getProviderMethodAdapter(providerType)
  }
}

export async function executeGenerateImagesOrchestration(input: {
  model: string
  prompt: string
  size?: string
  count?: number
  providerType: string
  providerConfig?: AiProviderConfig
  methodAdapter: ProviderMethodAdapter
  resolveImageModel: (modelId?: string) => { model: string; modelKey: unknown }
  executeImageWithRetry: <T>(
    stage: RetryStage,
    execute: () => Promise<T>,
    context: Record<string, unknown>
  ) => Promise<T>
  generateImageWithProgress: (input: {
    modelKey: unknown
    prompt: string
    size?: string
    n?: number
    providerType?: string
    providerConfig?: AiProviderConfig
  }) => Promise<{ images: string[] }>
  estimateTokens: (input: {
    model?: string
    messages: unknown[]
  }) => Promise<AiTokenBreakdown>
}): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
  return await input.methodAdapter.generateImages({
    executeSdkGenerate: async () => {
      const { modelKey, model } = input.resolveImageModel(input.model)
      console.info('[AI] generateImages:start', {
        modelInput: input.model,
        resolvedModel: model,
        size: input.size,
        count: input.count
      })
      const result = await input.executeImageWithRetry(
        'generateImages',
        async () =>
          await input.generateImageWithProgress({
            modelKey,
            prompt: input.prompt,
            size: input.size,
            n: input.count,
            providerType: input.providerType,
            providerConfig: input.providerConfig
          }),
        {
          modelInput: input.model,
          resolvedModel: model,
          size: input.size,
          count: input.count
        }
      )

      const images = result.images || []
      const tokens = await input.estimateTokens({ model: input.model, messages: [] })
      return { images, tokens }
    },
    executeSdkEdit: async () => {
      throw new Error('Unsupported path')
    }
  })
}

export async function executeGenerateImagesStreamOrchestration(input: {
  model: string
  prompt: string
  size?: string
  count?: number
  providerType: string
  providerConfig?: AiProviderConfig
  methodAdapter: ProviderMethodAdapter
  abortSignal: AbortSignal
  onChunk: (chunk: AiImageGenerateProgressChunk) => void
  resolveImageModel: (modelId?: string) => { model: string; modelKey: unknown }
  executeImageWithRetry: <T>(
    stage: RetryStage,
    execute: () => Promise<T>,
    context: Record<string, unknown>
  ) => Promise<T>
  generateImageWithProgress: (input: {
    modelKey: unknown
    prompt: string
    size?: string
    n?: number
    providerType?: string
    providerConfig?: AiProviderConfig
    abortSignal?: AbortSignal
    onChunk?: (chunk: AiImageGenerateProgressChunk) => void
  }) => Promise<{ images: string[] }>
  estimateTokens: (input: {
    model?: string
    messages: unknown[]
  }) => Promise<AiTokenBreakdown>
}): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
  return await input.methodAdapter.generateImages({
    executeSdkGenerate: async () => {
      const { modelKey, model } = input.resolveImageModel(input.model)
      console.info('[AI] generateImagesStream:start', {
        modelInput: input.model,
        resolvedModel: model,
        size: input.size,
        count: input.count
      })
      input.onChunk({
        type: 'status',
        stage: 'start',
        message: '开始生成图片...'
      })

      const result = await input.executeImageWithRetry(
        'generateImages',
        async () =>
          await input.generateImageWithProgress({
            modelKey,
            prompt: input.prompt,
            size: input.size,
            n: input.count,
            providerType: input.providerType,
            providerConfig: input.providerConfig,
            abortSignal: input.abortSignal,
            onChunk: input.onChunk
          }),
        {
          modelInput: input.model,
          resolvedModel: model,
          size: input.size,
          count: input.count
        }
      )

      const tokens = await input.estimateTokens({ model: input.model, messages: [] })
      input.onChunk({
        type: 'status',
        stage: 'completed',
        message: `生成完成，返回 ${result.images.length} 张`,
        received: result.images.length,
        total: input.count || result.images.length
      })
      return { images: result.images, tokens }
    },
    executeSdkEdit: async () => {
      throw new Error('Unsupported path')
    }
  })
}

export async function executeEditImageOrchestration(input: {
  model: string
  prompt: string
  imageAttachmentId: string
  providerType: string
  methodAdapter: ProviderMethodAdapter
  resolveImageModel: (modelId?: string) => { model: string; modelKey: unknown }
  readAttachment: (attachmentId: string) => Promise<unknown>
  executeImageWithRetry: <T>(
    stage: RetryStage,
    execute: () => Promise<T>,
    context: Record<string, unknown>
  ) => Promise<T>
  generateImageWithDecodeFallback: (input: {
    modelKey: unknown
    prompt: { text: string; images: unknown[] }
  }) => Promise<{ images: string[] }>
  estimateTokens: (input: {
    model?: string
    messages: unknown[]
  }) => Promise<AiTokenBreakdown>
}): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
  return await input.methodAdapter.editImage({
    executeSdkGenerate: async () => {
      throw new Error('Unsupported path')
    },
    executeSdkEdit: async () => {
      const { modelKey, model } = input.resolveImageModel(input.model)
      console.info('[AI] editImage:start', {
        modelInput: input.model,
        resolvedModel: model,
        imageAttachmentId: input.imageAttachmentId
      })
      const image = await input.readAttachment(input.imageAttachmentId)

      const result = await input.executeImageWithRetry(
        'editImage',
        async () =>
          await input.generateImageWithDecodeFallback({
            modelKey,
            prompt: {
              text: input.prompt,
              images: [image]
            }
          }),
        {
          modelInput: input.model,
          resolvedModel: model,
          imageAttachmentId: input.imageAttachmentId
        }
      )

      const images = result.images || []
      const tokens = await input.estimateTokens({ model: input.model, messages: [] })
      return { images, tokens }
    }
  })
}
