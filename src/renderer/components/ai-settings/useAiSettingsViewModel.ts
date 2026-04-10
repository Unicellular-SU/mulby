import { type ComponentProps } from 'react'
import { ProviderSettingsSection } from './ProviderSettingsSection'
import AiSettingsHeader from './AiSettingsHeader'
import AiSettingsStatusPanels from './AiSettingsStatusPanels'
import AiSettingsModalsHost from './AiSettingsModalsHost'
import { useAiSettingsController } from './useAiSettingsController'

interface UseAiSettingsViewModelArgs {
  onBack: () => void
  onOpenMcpSettings?: () => void
  onOpenToolsSettings?: () => void
  onOpenSkillsSettings?: () => void
}

export function useAiSettingsViewModel({
  onBack,
  onOpenMcpSettings,
  onOpenToolsSettings,
  onOpenSkillsSettings
}: UseAiSettingsViewModelArgs): {
  headerProps: ComponentProps<typeof AiSettingsHeader>
  statusProps: ComponentProps<typeof AiSettingsStatusPanels>
  providerSectionProps: ComponentProps<typeof ProviderSettingsSection>
  modalsHostProps: ComponentProps<typeof AiSettingsModalsHost>
} {
  const controller = useAiSettingsController()

  const headerProps: ComponentProps<typeof AiSettingsHeader> = {
    onBack,
    onOpenGlobalDefaultModelModal: controller.openGlobalDefaultModelModal,
    onOpenDefaultParamsModal: () => controller.setShowDefaultParamsModal(true),
    onOpenToolSettings: onOpenToolsSettings,
    onOpenSkillsSettings,
    onOpenMcpSettings
  }

  const statusProps: ComponentProps<typeof AiSettingsStatusPanels> = {
    hasProviderBlockingIssues: controller.hasProviderBlockingIssues,
    aiReasoning: controller.aiReasoning
  }

  const providerSectionProps: ComponentProps<typeof ProviderSettingsSection> = {
    aiDraft: controller.aiDraft,
    sortedProviderEntries: controller.sortedProviderEntries,
    selectedProvider: controller.selectedProvider,
    selectedProviderIndex: controller.selectedProviderIndex,
    selectedProviderValidation: controller.selectedProviderValidation,
    selectedProviderIsSystemDefault: controller.selectedProviderIsSystemDefault,
    selectedProviderType: controller.selectedProviderType,
    selectedProviderSupportsEndpointRouting: controller.selectedProviderSupportsEndpointRouting,
    selectedProviderDefaultBaseURL: controller.selectedProviderDefaultBaseURL,
    selectedProviderDefaultAnthropicBaseURL: controller.selectedProviderDefaultAnthropicBaseURL,
    filteredModels: controller.filteredModels,
    isTestingConnection: controller.isTestingConnection,
    isFetchingModels: controller.isFetchingModels,
    setSelectedProviderIndex: controller.setSelectedProviderIndex,
    onToggleProviderEnabled: controller.handleToggleProviderEnabled,
    onOpenAddProviderModal: () => controller.setShowAddProviderModal(true),
    onTestConnection: controller.handleTestSelectedProviderConnection,
    onUpdateSelectedProvider: controller.handleUpdateSelectedProvider,
    onRemoveSelectedProvider: controller.handleRemoveSelectedProvider,
    onSelectedProviderTypeChange: controller.handleSelectedProviderTypeChange,
    openApiKeyManager: controller.openApiKeyManager,
    onUpdateSelectedProviderParams: controller.handleUpdateSelectedProviderParams,
    onToggleSelectedProviderParam: controller.handleToggleSelectedProviderParam,
    onToggleSelectedProviderMaxTokens: controller.handleToggleSelectedProviderMaxTokens,
    onFetchModelsForSelectedProvider: controller.handleFetchModelsForSelectedProvider,
    openAddModelModal: controller.openAddModelModal,
    handleRemoveModel: controller.handleRemoveModel,
    handleUpdateModel: controller.handleUpdateModel,
    resolveProviderIdFromModel: controller.resolveProviderIdFromModel,
    getProviderKey: controller.getProviderKey,
    getProviderTypeLabel: controller.getProviderTypeLabel,
    getModelCapabilityState: controller.getModelCapabilityState,
    isCapabilityAuto: controller.isCapabilityAuto,
    updateModelCapabilities: controller.updateModelCapabilities,
    handleUpdateModelParams: controller.handleUpdateModelParams,
    onToggleModelParam: controller.handleToggleModelParam,
    onToggleModelMaxTokens: controller.handleToggleModelMaxTokens
  }

  const modalsHostProps: ComponentProps<typeof AiSettingsModalsHost> = {
    fetchedModelsModalProps: {
      show: controller.showModelModal,
      fetchProviderLabel: controller.fetchProviderLabel,
      fetchSearch: controller.fetchSearch,
      filteredFetchedModels: controller.filteredFetchedModels,
      selectedFetchedModelIds: controller.selectedFetchedModelIds,
      onClose: () => controller.setShowModelModal(false),
      onFetchSearchChange: controller.setFetchSearch,
      onSelectAll: controller.selectAllFetched,
      onInvertSelection: controller.invertFetchedSelection,
      onToggleFetchedModel: controller.toggleFetchedModel,
      onAddSelected: controller.handleAddFetchedModels
    },
    apiKeyManagerModalProps: {
      show: controller.showApiKeyManagerModal,
      selectedProvider: controller.selectedProvider,
      selectedProviderApiKeys: controller.selectedProviderApiKeys,
      selectedProviderModelOptions: controller.selectedProviderModelOptions,
      newApiKeyInput: controller.newApiKeyInput,
      apiKeyTestModel: controller.apiKeyTestModel,
      testingApiKeyIndex: controller.testingApiKeyIndex,
      apiKeyTestStatusMap: controller.apiKeyTestStatusMap,
      onClose: () => controller.setShowApiKeyManagerModal(false),
      onNewApiKeyInputChange: controller.setNewApiKeyInput,
      onApiKeyTestModelChange: controller.setApiKeyTestModel,
      onAddApiKey: controller.handleAddApiKey,
      onTestSingleApiKey: controller.handleTestSingleApiKey,
      onRemoveApiKey: controller.handleRemoveApiKey,
      getProviderKey: controller.getProviderKey
    },
    addProviderModalProps: {
      show: controller.showAddProviderModal,
      newProvider: controller.newProvider,
      newProviderDefaultBaseURL: controller.newProviderDefaultBaseURL,
      newProviderDefaultAnthropicBaseURL: controller.newProviderDefaultAnthropicBaseURL,
      onClose: () => controller.setShowAddProviderModal(false),
      onAddProvider: controller.handleAddProvider,
      onNewProviderTypeChange: controller.handleNewProviderTypeChange,
      setNewProvider: controller.setNewProvider
    },
    addModelModalProps: {
      show: controller.showAddModelModal,
      aiDraft: controller.aiDraft,
      newModel: controller.newModel,
      newModelProviderIndex: controller.newModelProviderIndex,
      newModelNeedsEndpointType: controller.newModelNeedsEndpointType,
      inferredCapabilities: controller.inferredCapabilities,
      onClose: () => controller.setShowAddModelModal(false),
      onAddModel: controller.handleAddModel,
      onNewModelProviderIndexChange: controller.handleNewModelProviderIndexChange,
      setNewModel: controller.setNewModel,
      updateNewModelCapability: controller.updateNewModelCapability,
      getProviderKey: controller.getProviderKey
    },
    defaultParamsModalProps: {
      show: controller.showDefaultParamsModal,
      aiDraft: controller.aiDraft,
      onClose: () => controller.setShowDefaultParamsModal(false),
      onUpdateDefaultParams: controller.handleUpdateDefaultParams,
      onToggleDefaultParam: controller.handleToggleDefaultParam,
      onToggleDefaultMaxTokens: controller.handleToggleDefaultMaxTokens
    },
    globalDefaultModelModalProps: {
      show: controller.showGlobalDefaultModelModal,
      options: controller.globalDefaultModelOptions,
      selectedModelId: controller.globalDefaultModelSelection,
      currentModelId: controller.currentGlobalDefaultModelId,
      onClose: () => controller.setShowGlobalDefaultModelModal(false),
      onSelectedModelIdChange: controller.setGlobalDefaultModelSelection,
      onConfirm: controller.handleConfirmGlobalDefaultModel,
      onClear: controller.handleClearGlobalDefaultModel
    }
  }

  return {
    headerProps,
    statusProps,
    providerSectionProps,
    modalsHostProps
  }
}
