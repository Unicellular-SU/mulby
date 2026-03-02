import type { AiProviderConfig, AiSettings } from '../../../shared/types/ai'
import { useModelEditing } from './useModelEditing'
import { useModelFetchSync } from './useModelFetchSync'

interface UseAiModelControllerArgs {
  aiDraft: AiSettings | null
  selectedProvider: AiProviderConfig | null
  selectedProviderIndex: number
  updateAiDraft: (patch: Partial<AiSettings>) => void
  setAiError: (message: string | null) => void
  setAiInfo: (message: string | null) => void
}

export function useAiModelController({
  aiDraft,
  selectedProvider,
  selectedProviderIndex,
  updateAiDraft,
  setAiError,
  setAiInfo
}: UseAiModelControllerArgs) {
  const editing = useModelEditing({
    aiDraft,
    selectedProvider,
    selectedProviderIndex,
    updateAiDraft,
    setAiError
  })

  const fetchSync = useModelFetchSync({
    aiDraft,
    updateAiDraft,
    setAiError,
    setAiInfo
  })

  return {
    filteredModels: editing.filteredModels,
    isFetchingModels: fetchSync.isFetchingModels,
    showModelModal: fetchSync.showModelModal,
    fetchProviderLabel: fetchSync.fetchProviderLabel,
    fetchSearch: fetchSync.fetchSearch,
    filteredFetchedModels: fetchSync.filteredFetchedModels,
    selectedFetchedModelIds: fetchSync.selectedFetchedModelIds,
    showAddModelModal: editing.showAddModelModal,
    newModel: editing.newModel,
    newModelProviderIndex: editing.newModelProviderIndex,
    newModelNeedsEndpointType: editing.newModelNeedsEndpointType,
    inferredCapabilities: editing.inferredCapabilities,
    setShowModelModal: fetchSync.setShowModelModal,
    setFetchSearch: fetchSync.setFetchSearch,
    setShowAddModelModal: editing.setShowAddModelModal,
    setNewModel: editing.setNewModel,
    loadInferredCapabilities: editing.loadInferredCapabilities,
    getModelCapabilityState: editing.getModelCapabilityState,
    isCapabilityAuto: editing.isCapabilityAuto,
    updateModelCapabilities: editing.updateModelCapabilities,
    openAddModelModal: editing.openAddModelModal,
    handleAddModel: editing.handleAddModel,
    handleNewModelProviderIndexChange: editing.handleNewModelProviderIndexChange,
    handleRemoveModel: editing.handleRemoveModel,
    handleUpdateModel: editing.handleUpdateModel,
    handleUpdateModelParams: editing.handleUpdateModelParams,
    handleToggleModelParam: editing.handleToggleModelParam,
    handleToggleModelMaxTokens: editing.handleToggleModelMaxTokens,
    handleFetchModels: fetchSync.handleFetchModels,
    selectAllFetched: fetchSync.selectAllFetched,
    invertFetchedSelection: fetchSync.invertFetchedSelection,
    toggleFetchedModel: fetchSync.toggleFetchedModel,
    handleAddFetchedModels: fetchSync.handleAddFetchedModels,
    updateNewModelCapability: editing.updateNewModelCapability
  }
}
