import { useState } from 'react'
import type { AiModel, AiProviderConfig } from '../../../shared/types/ai'
import { modelBelongsToProvider } from './providerUtils'

interface UseProviderConnectionArgs {
  selectedProvider: AiProviderConfig | null
  models: AiModel[] | undefined
  setAiError: (message: string | null) => void
  setAiInfo: (message: string | null) => void
  setAiReasoning: (message: string | null) => void
}

export function useProviderConnection({
  selectedProvider,
  models,
  setAiError,
  setAiInfo,
  setAiReasoning
}: UseProviderConnectionArgs) {
  const [isTestingConnection, setIsTestingConnection] = useState(false)

  const handleTestSelectedProviderConnection = async () => {
    if (!selectedProvider) return
    setAiInfo(null)
    setAiError(null)
    if (!window.mulby?.ai?.testConnection) {
      setAiError('AI 接口未就绪，请重启应用')
      return
    }
    try {
      setIsTestingConnection(true)
      const providerModel = selectedProvider.defaultModel || models?.find((item) => modelBelongsToProvider(item, selectedProvider))?.id
      if (!providerModel) {
        setAiError('该 Provider 未配置模型，请先拉取或手动添加')
        return
      }
      const fallbackModel = providerModel
      let reasoningStreamed = ''
      setAiInfo('')
      setAiReasoning('')
      const result = await (window.mulby.ai.testConnectionStream
        ? window.mulby.ai.testConnectionStream({
          model: fallbackModel,
          providerId: String(selectedProvider.id),
          apiKey: selectedProvider.apiKey,
          baseURL: selectedProvider.baseURL
        }, (chunk) => {
          if (chunk.type === 'reasoning') {
            reasoningStreamed += chunk.text
            setAiReasoning(reasoningStreamed)
          }
        })
        : window.mulby.ai.testConnection({
          model: fallbackModel,
          providerId: String(selectedProvider.id),
          apiKey: selectedProvider.apiKey,
          baseURL: selectedProvider.baseURL
        }))
      if (result.success) {
        setAiInfo(`连接成功：${result.message || 'ok'}`)
        if ('reasoning' in result && typeof result.reasoning === 'string' && result.reasoning) {
          setAiReasoning(result.reasoning)
        }
      } else {
        setAiError(result.message || '连接失败')
      }
    } finally {
      setIsTestingConnection(false)
    }
  }

  return {
    isTestingConnection,
    handleTestSelectedProviderConnection
  }
}
