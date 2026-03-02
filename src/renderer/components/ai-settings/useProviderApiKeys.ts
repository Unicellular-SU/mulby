import { useEffect, useMemo, useState } from 'react'
import type { AiProviderConfig } from '../../../shared/types/ai'
import { splitApiKeyString } from '../../../shared/ai/apiKeyPool'
import { serializeApiKeys, type ApiKeyTestStatus, type ProviderModelOption } from './shared'

interface UseProviderApiKeysArgs {
  selectedProvider: AiProviderConfig | null
  selectedProviderIndex: number
  selectedProviderModelOptions: ProviderModelOption[]
  handleUpdateProvider: (index: number, patch: Partial<AiProviderConfig>) => void
  setAiError: (message: string | null) => void
  setAiInfo: (message: string | null) => void
}

export function useProviderApiKeys({
  selectedProvider,
  selectedProviderIndex,
  selectedProviderModelOptions,
  handleUpdateProvider,
  setAiError,
  setAiInfo
}: UseProviderApiKeysArgs) {
  const [showApiKeyManagerModal, setShowApiKeyManagerModal] = useState(false)
  const [newApiKeyInput, setNewApiKeyInput] = useState('')
  const [apiKeyTestModel, setApiKeyTestModel] = useState('')
  const [testingApiKeyIndex, setTestingApiKeyIndex] = useState<number | null>(null)
  const [apiKeyTestStatusMap, setApiKeyTestStatusMap] = useState<Record<string, ApiKeyTestStatus>>({})

  const selectedProviderApiKeys = useMemo(() => splitApiKeyString(selectedProvider?.apiKey), [selectedProvider?.apiKey])

  useEffect(() => {
    if (!showApiKeyManagerModal) return
    if (!selectedProviderModelOptions.length) {
      if (apiKeyTestModel) setApiKeyTestModel('')
      return
    }
    if (!apiKeyTestModel || !selectedProviderModelOptions.some((item) => item.id === apiKeyTestModel)) {
      const preferredModel =
        selectedProvider?.defaultModel && selectedProviderModelOptions.some((item) => item.id === selectedProvider.defaultModel)
          ? selectedProvider.defaultModel
          : selectedProviderModelOptions[0].id
      setApiKeyTestModel(preferredModel)
    }
  }, [showApiKeyManagerModal, apiKeyTestModel, selectedProviderModelOptions, selectedProvider?.defaultModel])

  const updateSelectedProviderApiKeys = (keys: string[]) => {
    if (!selectedProvider) return
    handleUpdateProvider(selectedProviderIndex, { apiKey: serializeApiKeys(keys) })
  }

  const openApiKeyManager = () => {
    if (!selectedProvider) return
    const preferredModel =
      selectedProvider.defaultModel && selectedProviderModelOptions.some((item) => item.id === selectedProvider.defaultModel)
        ? selectedProvider.defaultModel
        : (selectedProviderModelOptions[0]?.id || '')
    setApiKeyTestModel(preferredModel)
    setNewApiKeyInput('')
    setApiKeyTestStatusMap({})
    setShowApiKeyManagerModal(true)
  }

  const handleAddApiKey = () => {
    const pendingKeys = splitApiKeyString(newApiKeyInput)
    if (!pendingKeys.length) {
      setAiError('请输入有效的 API Key')
      return
    }
    const keySet = new Set(selectedProviderApiKeys)
    pendingKeys.forEach((key) => keySet.add(key))
    updateSelectedProviderApiKeys(Array.from(keySet))
    setNewApiKeyInput('')
    setApiKeyTestStatusMap({})
    setAiInfo(`已添加 ${pendingKeys.length} 个 API Key`)
    setAiError(null)
  }

  const handleRemoveApiKey = (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= selectedProviderApiKeys.length) return
    const nextKeys = selectedProviderApiKeys.filter((_, index) => index !== targetIndex)
    updateSelectedProviderApiKeys(nextKeys)
    setApiKeyTestStatusMap({})
  }

  const handleTestSingleApiKey = async (key: string, index: number) => {
    if (!selectedProvider) return
    if (!window.mulby?.ai?.testConnection) {
      setAiError('AI 接口未就绪，请重启应用')
      return
    }
    if (!apiKeyTestModel) {
      setAiError('请先选择一个模型')
      return
    }

    const statusKey = `${index}:${key}`
    setTestingApiKeyIndex(index)
    setApiKeyTestStatusMap((prev) => ({
      ...prev,
      [statusKey]: { state: 'testing', message: '测试中…' }
    }))

    try {
      const result = await window.mulby.ai.testConnection({
        model: apiKeyTestModel,
        providerId: String(selectedProvider.id),
        apiKey: key,
        baseURL: selectedProvider.baseURL
      })
      setApiKeyTestStatusMap((prev) => ({
        ...prev,
        [statusKey]: {
          state: result.success ? 'success' : 'error',
          message: result.success ? (result.message || '连接成功') : (result.message || '连接失败')
        }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : '连接失败'
      setApiKeyTestStatusMap((prev) => ({
        ...prev,
        [statusKey]: {
          state: 'error',
          message
        }
      }))
    } finally {
      setTestingApiKeyIndex(null)
    }
  }

  return {
    selectedProviderApiKeys,
    showApiKeyManagerModal,
    newApiKeyInput,
    apiKeyTestModel,
    testingApiKeyIndex,
    apiKeyTestStatusMap,
    setShowApiKeyManagerModal,
    setNewApiKeyInput,
    setApiKeyTestModel,
    openApiKeyManager,
    handleAddApiKey,
    handleTestSingleApiKey,
    handleRemoveApiKey
  }
}
