import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiModel, AiSettings } from '../../../shared/types/ai'
import { useInAppNotice } from '../InAppNotice'
import { getProviderKey, getProviderTypeLabel, resolveProviderIdFromModel as resolveProviderIdFromModelInProviders } from './providerUtils'
import { classNames } from './shared'
import { useAiProviderController } from './useAiProviderController'
import { useAiModelController } from './useAiModelController'
import { useAiModalController } from './useAiModalController'

export function useAiSettingsController() {
  const [_aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [aiDraft, setAiDraft] = useState<AiSettings | null>(null)
  const [aiReasoning, setAiReasoning] = useState<string | null>(null)
  const notice = useInAppNotice()

  // 标记初始加载是否完成，避免加载阶段触发自动保存
  const initialLoadDone = useRef(false)
  // 用于 debounce 的计时器引用
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 标记是否正在保存中，避免保存回写触发重复保存
  const isSavingRef = useRef(false)

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

  // 初始加载设置
  useEffect(() => {
    if (window.mulby?.ai?.settings?.get) {
      window.mulby.ai.settings.get()
        .then((next) => {
          setAiSettings(next)
          setAiDraft(next)
          model.loadInferredCapabilities()
          // 延迟标记加载完成，确保 React 状态批量更新不会意外触发自动保存
          requestAnimationFrame(() => {
            initialLoadDone.current = true
          })
        })
        .catch((err) => {
          console.error('Failed to load AI settings:', err)
          setAiError('AI 设置加载失败')
        })
    } else {
      setAiError('AI 接口未就绪，请重启应用')
    }
  }, [])

  // 自动保存：监听 aiDraft 变化，使用 debounce 延迟保存
  useEffect(() => {
    // 初始加载未完成、或正在保存回写时不触发
    if (!initialLoadDone.current || isSavingRef.current || !aiDraft) return

    // 清除之前的计时器
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(async () => {
      if (!window.mulby?.ai?.settings?.update) {
        setAiError('AI 接口未就绪，请重启应用')
        return
      }
      try {
        isSavingRef.current = true
        const next = await window.mulby.ai.settings.update(aiDraft)
        setAiSettings(next)
        // 只在后端返回的数据和当前 draft 不同时才回写，减少不必要的渲染
        setAiDraft((currentDraft) => {
          if (currentDraft === aiDraft) return next
          // 如果在保存期间 draft 又被修改了，保留用户最新修改
          return currentDraft
        })
        model.loadInferredCapabilities()
      } catch (err) {
        console.error('Failed to auto-save AI settings:', err)
        setAiError('AI 设置自动保存失败')
      } finally {
        isSavingRef.current = false
      }
    }, 500)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [aiDraft])

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
    handleToggleProviderEnabled: provider.handleToggleProviderEnabled,
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
