import { useCallback, useEffect, useState } from 'react'
import type { AiModel, AiSettings } from '../../../shared/types/ai'
import { useInAppNotice } from '../InAppNotice'
import { getProviderKey, getProviderTypeLabel, resolveProviderIdFromModel as resolveProviderIdFromModelInProviders } from './providerUtils'
import { classNames } from './shared'
import { useAiProviderController } from './useAiProviderController'
import { useAiModelController } from './useAiModelController'
import { useAiModalController } from './useAiModalController'

export function useAiSettingsController() {
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [aiDraft, setAiDraft] = useState<AiSettings | null>(null)
  const [aiReasoning, setAiReasoning] = useState<string | null>(null)
  const notice = useInAppNotice()

  const setAiError = useCallback((message: string | null) => {
    if (message) notice.error(message)
  }, [notice])

  const setAiInfo = useCallback((message: string | null) => {
    if (message) notice.success(message)
  }, [notice])

  const updateAiDraft = useCallback((patch: Partial<AiSettings>) => {
    setAiDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...patch,
        providers: patch.providers ?? prev.providers,
        models: patch.models ?? prev.models
      }
    })
  }, [])

  const resolveProviderIdFromModel = useCallback((model: AiModel) => {
    return resolveProviderIdFromModelInProviders(model, aiDraft?.providers || [])
  }, [aiDraft?.providers])

  const provider = useAiProviderController({
    aiDraft,
    setAiDraft,
    updateAiDraft,
    setAiError,
    setAiInfo,
    setAiReasoning
  })

  const model = useAiModelController({
    aiDraft,
    selectedProvider: provider.selectedProvider,
    selectedProviderIndex: provider.selectedProviderIndex,
    updateAiDraft,
    setAiError,
    setAiInfo
  })

  const modal = useAiModalController({
    aiDraft,
    updateAiDraft,
    setAiError,
    setAiInfo,
    resolveProviderIdFromModel
  })

  useEffect(() => {
    if (window.mulby?.ai?.settings?.get) {
      window.mulby.ai.settings.get()
        .then((next) => {
          setAiSettings(next)
          setAiDraft(next)
          model.loadInferredCapabilities()
        })
        .catch((err) => {
          console.error('Failed to load AI settings:', err)
          setAiError('AI 设置加载失败')
        })
    } else {
      setAiError('AI 接口未就绪，请重启应用')
    }
  }, [])

  const handleSaveAiSettings = async () => {
    if (!aiDraft) return
    if (!window.mulby?.ai?.settings?.update) {
      setAiError('AI 接口未就绪，请重启应用')
      return
    }
    try {
      const next = await window.mulby.ai.settings.update(aiDraft)
      setAiSettings(next)
      setAiDraft(next)
      model.loadInferredCapabilities()
      setAiError(null)
      setAiInfo('已保存 AI 配置')
    } catch (err) {
      console.error('Failed to save AI settings:', err)
      setAiError('AI 设置保存失败')
    }
  }

  const handleResetAiSettings = () => {
    setAiDraft(aiSettings)
    modal.setGlobalDefaultModelSelection('')
    setAiError(null)
    setAiInfo(null)
    setAiReasoning(null)
  }

  const handleFetchModelsForSelectedProvider = () => {
    if (!provider.selectedProvider) return
    model.handleFetchModels(provider.selectedProvider)
  }

  const { pillClass, primaryPillClass } = classNames

  return {
    pillClass,
    primaryPillClass,
    hasProviderBlockingIssues: provider.hasProviderBlockingIssues,
    openGlobalDefaultModelModal: modal.openGlobalDefaultModelModal,
    handleResetAiSettings,
    handleSaveAiSettings,
    aiReasoning,
    aiDraft,
    sortedProviderEntries: provider.sortedProviderEntries,
    selectedProvider: provider.selectedProvider,
    selectedProviderIndex: provider.selectedProviderIndex,
    selectedProviderValidation: provider.selectedProviderValidation,
    selectedProviderIsSystemDefault: provider.selectedProviderIsSystemDefault,
    selectedProviderType: provider.selectedProviderType,
    selectedProviderSupportsEndpointRouting: provider.selectedProviderSupportsEndpointRouting,
    selectedProviderDefaultBaseURL: provider.selectedProviderDefaultBaseURL,
    selectedProviderDefaultAnthropicBaseURL: provider.selectedProviderDefaultAnthropicBaseURL,
    filteredModels: model.filteredModels,
    isTestingConnection: provider.isTestingConnection,
    isFetchingModels: model.isFetchingModels,
    setSelectedProviderIndex: provider.setSelectedProviderIndex,
    setShowAddProviderModal: provider.setShowAddProviderModal,
    handleTestSelectedProviderConnection: provider.handleTestSelectedProviderConnection,
    handleUpdateSelectedProvider: provider.handleUpdateSelectedProvider,
    handleRemoveSelectedProvider: provider.handleRemoveSelectedProvider,
    handleSelectedProviderTypeChange: provider.handleSelectedProviderTypeChange,
    openApiKeyManager: provider.openApiKeyManager,
    handleUpdateSelectedProviderParams: provider.handleUpdateSelectedProviderParams,
    handleToggleSelectedProviderParam: provider.handleToggleSelectedProviderParam,
    handleToggleSelectedProviderMaxTokens: provider.handleToggleSelectedProviderMaxTokens,
    handleFetchModelsForSelectedProvider,
    openAddModelModal: model.openAddModelModal,
    handleRemoveModel: model.handleRemoveModel,
    handleUpdateModel: model.handleUpdateModel,
    resolveProviderIdFromModel,
    getProviderKey,
    getProviderTypeLabel,
    getModelCapabilityState: model.getModelCapabilityState,
    isCapabilityAuto: model.isCapabilityAuto,
    updateModelCapabilities: model.updateModelCapabilities,
    handleUpdateModelParams: model.handleUpdateModelParams,
    handleToggleModelParam: model.handleToggleModelParam,
    handleToggleModelMaxTokens: model.handleToggleModelMaxTokens,
    showModelModal: model.showModelModal,
    fetchProviderLabel: model.fetchProviderLabel,
    fetchSearch: model.fetchSearch,
    filteredFetchedModels: model.filteredFetchedModels,
    selectedFetchedModelIds: model.selectedFetchedModelIds,
    setShowModelModal: model.setShowModelModal,
    setFetchSearch: model.setFetchSearch,
    selectAllFetched: model.selectAllFetched,
    invertFetchedSelection: model.invertFetchedSelection,
    toggleFetchedModel: model.toggleFetchedModel,
    handleAddFetchedModels: model.handleAddFetchedModels,
    showApiKeyManagerModal: provider.showApiKeyManagerModal,
    selectedProviderApiKeys: provider.selectedProviderApiKeys,
    selectedProviderModelOptions: provider.selectedProviderModelOptions,
    newApiKeyInput: provider.newApiKeyInput,
    apiKeyTestModel: provider.apiKeyTestModel,
    testingApiKeyIndex: provider.testingApiKeyIndex,
    apiKeyTestStatusMap: provider.apiKeyTestStatusMap,
    setShowApiKeyManagerModal: provider.setShowApiKeyManagerModal,
    setNewApiKeyInput: provider.setNewApiKeyInput,
    setApiKeyTestModel: provider.setApiKeyTestModel,
    handleAddApiKey: provider.handleAddApiKey,
    handleTestSingleApiKey: provider.handleTestSingleApiKey,
    handleRemoveApiKey: provider.handleRemoveApiKey,
    showAddProviderModal: provider.showAddProviderModal,
    newProvider: provider.newProvider,
    newProviderDefaultBaseURL: provider.newProviderDefaultBaseURL,
    newProviderDefaultAnthropicBaseURL: provider.newProviderDefaultAnthropicBaseURL,
    handleAddProvider: provider.handleAddProvider,
    handleNewProviderTypeChange: provider.handleNewProviderTypeChange,
    setNewProvider: provider.setNewProvider,
    showAddModelModal: model.showAddModelModal,
    newModel: model.newModel,
    newModelProviderIndex: model.newModelProviderIndex,
    newModelNeedsEndpointType: model.newModelNeedsEndpointType,
    inferredCapabilities: model.inferredCapabilities,
    setShowAddModelModal: model.setShowAddModelModal,
    handleAddModel: model.handleAddModel,
    handleNewModelProviderIndexChange: model.handleNewModelProviderIndexChange,
    setNewModel: model.setNewModel,
    updateNewModelCapability: model.updateNewModelCapability,
    showDefaultParamsModal: modal.showDefaultParamsModal,
    setShowDefaultParamsModal: modal.setShowDefaultParamsModal,
    handleUpdateDefaultParams: modal.handleUpdateDefaultParams,
    handleToggleDefaultParam: modal.handleToggleDefaultParam,
    handleToggleDefaultMaxTokens: modal.handleToggleDefaultMaxTokens,
    showGlobalDefaultModelModal: modal.showGlobalDefaultModelModal,
    globalDefaultModelOptions: modal.globalDefaultModelOptions,
    globalDefaultModelSelection: modal.globalDefaultModelSelection,
    currentGlobalDefaultModelId: aiDraft?.defaultModel,
    setShowGlobalDefaultModelModal: modal.setShowGlobalDefaultModelModal,
    setGlobalDefaultModelSelection: modal.setGlobalDefaultModelSelection,
    handleConfirmGlobalDefaultModel: modal.handleConfirmGlobalDefaultModel,
    handleClearGlobalDefaultModel: modal.handleClearGlobalDefaultModel
  }
}
