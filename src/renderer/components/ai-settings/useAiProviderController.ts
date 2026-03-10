import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AiModel, AiModelParameters, AiProviderConfig, AiSettings } from '../../../shared/types/ai'
import { inferProviderType } from '../../../shared/ai/providerType'
import { isEndpointRoutedProviderType, supportsProviderEndpointRouting } from '../../../shared/ai/providerEndpointRouting'
import { buildProviderIdCounts, validateProviderConfig } from '../../../shared/ai/providerValidation'
import { getProviderDefaultBaseURL } from '../../../shared/ai/providerDefaults'
import { getProviderPreset } from '../../../shared/ai/providerPresets'
import { getSystemDefaultProviderById, isSystemDefaultProviderId } from '../../../shared/ai/systemProviders'
import { buildProviderInstanceId, getProviderKey, getProviderTypeLabel, modelBelongsToProvider } from './providerUtils'
import { DEFAULT_TEMPERATURE, DEFAULT_TOP_P, type ProviderListEntry, type ProviderModelOption } from './shared'
import { useProviderApiKeys } from './useProviderApiKeys'
import { useProviderConnection } from './useProviderConnection'

interface UseAiProviderControllerArgs {
  aiDraft: AiSettings | null
  setAiDraft: Dispatch<SetStateAction<AiSettings | null>>
  updateAiDraft: (patch: Partial<AiSettings>) => void
  setAiError: (message: string | null) => void
  setAiInfo: (message: string | null) => void
  setAiReasoning: (message: string | null) => void
}

export function useAiProviderController({
  aiDraft,
  setAiDraft,
  updateAiDraft,
  setAiError,
  setAiInfo,
  setAiReasoning
}: UseAiProviderControllerArgs) {
  const initialProviderPreset = getProviderPreset('openai')
  const [showAddProviderModal, setShowAddProviderModal] = useState(false)
  const [selectedProviderIndex, setSelectedProviderIndex] = useState<number>(0)
  const [newProvider, setNewProvider] = useState<AiProviderConfig>({
    id: initialProviderPreset.defaultId,
    type: initialProviderPreset.type,
    label: initialProviderPreset.defaultLabel,
    enabled: true,
    apiKey: '',
    baseURL: initialProviderPreset.defaultBaseURL || '',
    apiVersion: '',
    anthropicBaseURL: ''
  })

  const getDefaultAnthropicBaseURL = (providerId?: string) => {
    return getSystemDefaultProviderById(providerId)?.anthropicBaseURL || ''
  }

  const selectedProvider = (aiDraft?.providers || [])[selectedProviderIndex] || null
  const selectedProviderIsSystemDefault = selectedProvider ? isSystemDefaultProviderId(String(selectedProvider.id)) : false
  const selectedProviderType = selectedProvider ? getProviderTypeLabel(selectedProvider) : ''
  const selectedProviderSupportsEndpointRouting = selectedProvider ? supportsProviderEndpointRouting(selectedProvider) : false
  const selectedProviderPreset = getProviderPreset(selectedProviderType || undefined)
  const selectedProviderDefaultBaseURL = selectedProviderPreset.defaultBaseURL || getProviderDefaultBaseURL(selectedProviderType)
  const selectedProviderDefaultAnthropicBaseURL = selectedProvider ? getDefaultAnthropicBaseURL(String(selectedProvider.id)) : ''
  const newProviderPreset = getProviderPreset(newProvider)
  const newProviderDefaultBaseURL = newProviderPreset.defaultBaseURL || getProviderDefaultBaseURL(newProvider)
  const newProviderDefaultAnthropicBaseURL = getDefaultAnthropicBaseURL(String(newProvider.id || newProviderPreset.defaultId))
  const providerIdCounts = buildProviderIdCounts(aiDraft?.providers || [])
  const selectedProviderValidation = validateProviderConfig(selectedProvider, providerIdCounts)
  const hasProviderBlockingIssues = (aiDraft?.providers || []).some((provider) => {
    return validateProviderConfig(provider, providerIdCounts).issues.length > 0
  })

  const providerListEntries = useMemo<ProviderListEntry[]>(() => {
    return (aiDraft?.providers || []).map((provider, index) => ({ provider, index }))
  }, [aiDraft?.providers])

  const sortedProviderEntries = useMemo<ProviderListEntry[]>(() => {
    return [...providerListEntries].sort((a, b) => {
      const aEnabled = a.provider.enabled !== false ? 1 : 0
      const bEnabled = b.provider.enabled !== false ? 1 : 0
      if (aEnabled !== bEnabled) return bEnabled - aEnabled
      return a.index - b.index
    })
  }, [providerListEntries])

  const selectedProviderModelOptions = useMemo<ProviderModelOption[]>(() => {
    if (!selectedProvider) return []
    const modelMap = new Map<string, ProviderModelOption>()
    ;(aiDraft?.models || []).forEach((model) => {
      if (!model.id) return
      if (!modelBelongsToProvider(model, selectedProvider)) return
      modelMap.set(model.id, {
        id: model.id,
        label: model.label || model.id
      })
    })
    if (selectedProvider.defaultModel && !modelMap.has(selectedProvider.defaultModel)) {
      modelMap.set(selectedProvider.defaultModel, {
        id: selectedProvider.defaultModel,
        label: selectedProvider.defaultModel
      })
    }
    return Array.from(modelMap.values())
  }, [aiDraft?.models, selectedProvider])

  useEffect(() => {
    if (!aiDraft || aiDraft.providers.length === 0) {
      if (selectedProviderIndex !== 0) setSelectedProviderIndex(0)
      return
    }
    if (selectedProviderIndex >= aiDraft.providers.length) {
      setSelectedProviderIndex(Math.max(0, aiDraft.providers.length - 1))
    }
  }, [aiDraft, selectedProviderIndex])

  const applyProviderTypePreset = (input: AiProviderConfig, nextType: string): AiProviderConfig => {
    const currentType = inferProviderType(input)
    const currentPreset = getProviderPreset(currentType)
    const nextPreset = getProviderPreset(nextType)
    const currentId = String(input.id || '').trim()
    const currentLabel = String(input.label || '').trim()
    const currentBaseURL = String(input.baseURL || '').trim()

    const replaceId = !currentId || currentId === currentPreset.defaultId
    const replaceLabel = !currentLabel || currentLabel === currentPreset.defaultLabel
    const replaceBaseURL = !currentBaseURL || (currentPreset.defaultBaseURL && currentBaseURL === currentPreset.defaultBaseURL)

    const currentAnthropicBaseURL = String(input.anthropicBaseURL || '').trim()
    const currentDefaultAnthropicBaseURL = getDefaultAnthropicBaseURL(currentId || currentPreset.defaultId)
    const nextProviderId = String(replaceId ? nextPreset.defaultId : (input.id || '')).trim()
    const nextDefaultAnthropicBaseURL = getDefaultAnthropicBaseURL(nextProviderId)
    const replaceAnthropicBaseURL = !currentAnthropicBaseURL
      || (currentDefaultAnthropicBaseURL && currentAnthropicBaseURL === currentDefaultAnthropicBaseURL)

    const nextProvider: AiProviderConfig = {
      ...input,
      type: nextPreset.type,
      id: replaceId ? nextPreset.defaultId : input.id,
      label: replaceLabel ? nextPreset.defaultLabel : input.label,
      baseURL: replaceBaseURL ? (nextPreset.defaultBaseURL || '') : input.baseURL
    }
    if (nextPreset.type !== 'azure-openai') {
      nextProvider.apiVersion = ''
    }
    if (!isEndpointRoutedProviderType(nextPreset.type)) {
      nextProvider.anthropicBaseURL = ''
    } else if (replaceAnthropicBaseURL) {
      nextProvider.anthropicBaseURL = nextDefaultAnthropicBaseURL || ''
    }
    return nextProvider
  }

  const handleNewProviderTypeChange = (nextType: string) => {
    setNewProvider((prev) => applyProviderTypePreset(prev, nextType))
  }

  const handleAddProvider = () => {
    if (!aiDraft) return
    const providerType = inferProviderType(newProvider)
    const providerId = buildProviderInstanceId(aiDraft.providers || [], String(newProvider.id || ''), providerType)
    const providers = [...aiDraft.providers, {
      ...newProvider,
      id: providerId,
      type: providerType,
      anthropicBaseURL: newProvider.anthropicBaseURL || getDefaultAnthropicBaseURL(providerId)
    }]
    updateAiDraft({ providers })
    const resetPreset = getProviderPreset('openai')
    setNewProvider({
      id: resetPreset.defaultId,
      type: resetPreset.type,
      label: resetPreset.defaultLabel,
      enabled: true,
      apiKey: '',
      baseURL: resetPreset.defaultBaseURL || '',
      apiVersion: '',
      anthropicBaseURL: ''
    })
    setShowAddProviderModal(false)
  }

  const handleRemoveProvider = (index: number) => {
    if (!aiDraft) return
    const target = aiDraft.providers[index]
    if (target && isSystemDefaultProviderId(String(target.id))) {
      setAiInfo('系统默认供应商不可删除，可改为停用')
      return
    }
    const providers = aiDraft.providers.filter((_, i) => i !== index)
    updateAiDraft({ providers })
  }

  const handleUpdateProvider = (index: number, patch: Partial<AiProviderConfig>) => {
    if (!aiDraft) return
    setAiDraft((prev) => {
      if (!prev) return prev
      const currentProvider = prev.providers[index]
      if (!currentProvider) return prev
      const mergedProvider = { ...currentProvider, ...patch }
      const nextProvider = {
        ...mergedProvider,
        type: inferProviderType(mergedProvider)
      }
      const providers = prev.providers.map((provider, i) => (i === index ? nextProvider : provider))
      let models = prev.models
      const beforeId = String(currentProvider.id)
      const afterId = String(nextProvider.id)
      const beforeKey = getProviderKey(currentProvider)
      const afterKey = getProviderKey(nextProvider)
      if (prev.models && prev.models.length > 0) {
        models = prev.models.map((model) => {
          const patchModel: Partial<AiModel> = {}
          if (beforeId !== afterId && model.providerRef === beforeId) {
            patchModel.providerRef = afterId
          }
          if (beforeKey !== afterKey && model.providerLabel === beforeKey) {
            patchModel.providerLabel = afterKey
          }
          return Object.keys(patchModel).length > 0 ? { ...model, ...patchModel } : model
        })
      }
      return {
        ...prev,
        providers,
        models
      }
    })
  }

  const apiKeys = useProviderApiKeys({
    selectedProvider,
    selectedProviderIndex,
    selectedProviderModelOptions,
    handleUpdateProvider,
    setAiError,
    setAiInfo
  })

  const handleUpdateProviderParams = (index: number, patch: Partial<AiModelParameters>) => {
    if (!aiDraft) return
    const provider = aiDraft.providers[index]
    if (!provider) return
    handleUpdateProvider(index, { defaultParams: { ...(provider.defaultParams || {}), ...patch } })
  }

  const handleToggleProviderParam = (index: number, key: 'temperatureEnabled' | 'topPEnabled') => {
    if (!aiDraft) return
    const provider = aiDraft.providers[index]
    if (!provider) return
    const current = provider.defaultParams || {}
    const nextEnabled = !(current[key] ?? false)
    const patch: Partial<AiModelParameters> = { [key]: nextEnabled }
    if (nextEnabled && key === 'temperatureEnabled' && current.temperature === undefined) {
      patch.temperature = DEFAULT_TEMPERATURE
    }
    if (nextEnabled && key === 'topPEnabled' && current.topP === undefined) {
      patch.topP = DEFAULT_TOP_P
    }
    handleUpdateProviderParams(index, patch)
  }

  const handleToggleProviderMaxTokens = (index: number) => {
    if (!aiDraft) return
    const provider = aiDraft.providers[index]
    if (!provider) return
    const current = provider.defaultParams || {}
    const nextEnabled = !(current.maxOutputTokensEnabled ?? false)
    const patch: Partial<AiModelParameters> = { maxOutputTokensEnabled: nextEnabled }
    if (nextEnabled && current.maxOutputTokens === undefined) {
      patch.maxOutputTokens = 1024
    }
    handleUpdateProviderParams(index, patch)
  }

  const connection = useProviderConnection({
    selectedProvider,
    models: aiDraft?.models,
    setAiError,
    setAiInfo,
    setAiReasoning
  })

  const handleUpdateSelectedProvider = (patch: Partial<AiProviderConfig>) => {
    if (!selectedProvider) return
    handleUpdateProvider(selectedProviderIndex, patch)
  }

  const handleRemoveSelectedProvider = () => {
    handleRemoveProvider(selectedProviderIndex)
  }

  const handleSelectedProviderTypeChange = (nextType: string) => {
    if (!selectedProvider) return
    const nextProvider = applyProviderTypePreset(selectedProvider, nextType)
    handleUpdateProvider(selectedProviderIndex, nextProvider)
  }

  const handleUpdateSelectedProviderParams = (patch: Partial<AiModelParameters>) => {
    handleUpdateProviderParams(selectedProviderIndex, patch)
  }

  const handleToggleSelectedProviderParam = (key: 'temperatureEnabled' | 'topPEnabled') => {
    handleToggleProviderParam(selectedProviderIndex, key)
  }

  const handleToggleSelectedProviderMaxTokens = () => {
    handleToggleProviderMaxTokens(selectedProviderIndex)
  }

  const handleToggleProviderEnabled = (index: number) => {
    if (!aiDraft) return
    const provider = aiDraft.providers[index]
    if (!provider) return
    handleUpdateProvider(index, { enabled: provider.enabled === false })
  }

  return {
    hasProviderBlockingIssues,
    sortedProviderEntries,
    selectedProvider,
    selectedProviderIndex,
    selectedProviderValidation,
    selectedProviderIsSystemDefault,
    selectedProviderType,
    selectedProviderSupportsEndpointRouting,
    selectedProviderDefaultBaseURL,
    selectedProviderDefaultAnthropicBaseURL,
    selectedProviderApiKeys: apiKeys.selectedProviderApiKeys,
    selectedProviderModelOptions,
    isTestingConnection: connection.isTestingConnection,
    newProvider,
    newProviderDefaultBaseURL,
    newProviderDefaultAnthropicBaseURL,
    showAddProviderModal,
    showApiKeyManagerModal: apiKeys.showApiKeyManagerModal,
    newApiKeyInput: apiKeys.newApiKeyInput,
    apiKeyTestModel: apiKeys.apiKeyTestModel,
    testingApiKeyIndex: apiKeys.testingApiKeyIndex,
    apiKeyTestStatusMap: apiKeys.apiKeyTestStatusMap,
    setSelectedProviderIndex,
    handleToggleProviderEnabled,
    setShowAddProviderModal,
    setShowApiKeyManagerModal: apiKeys.setShowApiKeyManagerModal,
    setNewApiKeyInput: apiKeys.setNewApiKeyInput,
    setApiKeyTestModel: apiKeys.setApiKeyTestModel,
    setNewProvider,
    handleNewProviderTypeChange,
    handleAddProvider,
    handleUpdateSelectedProvider,
    handleRemoveSelectedProvider,
    handleSelectedProviderTypeChange,
    openApiKeyManager: apiKeys.openApiKeyManager,
    handleAddApiKey: apiKeys.handleAddApiKey,
    handleTestSingleApiKey: apiKeys.handleTestSingleApiKey,
    handleRemoveApiKey: apiKeys.handleRemoveApiKey,
    handleUpdateSelectedProviderParams,
    handleToggleSelectedProviderParam,
    handleToggleSelectedProviderMaxTokens,
    handleTestSelectedProviderConnection: connection.handleTestSelectedProviderConnection
  }
}
