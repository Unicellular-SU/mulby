import { useCallback, useMemo, useState } from 'react'
import type { AiModel, AiModelCapability, AiModelParameters, AiModelType, AiProviderConfig, AiSettings } from '../../../shared/types/ai'
import { supportsProviderEndpointRouting } from '../../../shared/ai/providerEndpointRouting'
import { getProviderKey, modelBelongsToProvider } from './providerUtils'
import { DEFAULT_TEMPERATURE, DEFAULT_TOP_P, getModelCapabilityState as getSharedModelCapabilityState, isCapabilityAuto as getSharedIsCapabilityAuto } from './shared'

interface UseModelEditingArgs {
  aiDraft: AiSettings | null
  selectedProvider: AiProviderConfig | null
  selectedProviderIndex: number
  updateAiDraft: (patch: Partial<AiSettings>) => void
  setAiError: (message: string | null) => void
}

export function useModelEditing({
  aiDraft,
  selectedProvider,
  selectedProviderIndex,
  updateAiDraft,
  setAiError
}: UseModelEditingArgs) {
  const [showAddModelModal, setShowAddModelModal] = useState(false)
  const [newModel, setNewModel] = useState<AiModel>({
    id: '',
    label: '',
    description: ''
  })
  const [newModelProviderIndex, setNewModelProviderIndex] = useState<number>(0)
  const [inferredCapabilities, setInferredCapabilities] = useState<Record<string, Set<AiModelType>>>({})

  const filteredModels = useMemo(() => {
    return (aiDraft?.models || []).filter((model) => {
      if (!selectedProvider) return false
      return modelBelongsToProvider(model, selectedProvider)
    })
  }, [aiDraft?.models, selectedProvider])

  const newModelProvider = aiDraft?.providers?.[newModelProviderIndex]
  const newModelNeedsEndpointType = newModelProvider ? supportsProviderEndpointRouting(newModelProvider) : false

  const loadInferredCapabilities = useCallback(async () => {
    if (!window.mulby?.ai?.allModels) return
    try {
      const list = await window.mulby.ai.allModels()
      const next: Record<string, Set<AiModelType>> = {}
      if (Array.isArray(list)) {
        list.forEach((item) => {
          const caps = (item.capabilities || []).map((cap: AiModelCapability) => cap.type)
          next[item.id] = new Set(caps)
        })
      }
      setInferredCapabilities(next)
    } catch (err) {
      console.warn('Failed to load inferred model capabilities', err)
    }
  }, [])

  const getModelCapabilityState = (model: AiModel, type: AiModelType) => {
    return getSharedModelCapabilityState(model, type, inferredCapabilities)
  }

  const isCapabilityAuto = (model: AiModel, type: AiModelType) => {
    return getSharedIsCapabilityAuto(model, type)
  }

  const handleUpdateModel = (index: number, patch: Partial<AiModel>) => {
    if (!aiDraft?.models) return
    const models = aiDraft.models.map((model, i) => (i === index ? { ...model, ...patch } : model))
    updateAiDraft({ models })
  }

  const updateModelCapabilities = (modelId: string, type: AiModelType, enabled: boolean) => {
    const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === modelId)
    if (actualIndex < 0) return
    const model = (aiDraft?.models || [])[actualIndex]
    const prev = model?.capabilities || []
    const next = prev.filter((cap) => cap.type !== type)
    next.push({ type, isUserSelected: enabled })
    handleUpdateModel(actualIndex, { capabilities: next })
  }

  const updateNewModelCapability = (type: AiModelType, enabled: boolean) => {
    setNewModel((prev) => {
      const nextCaps = (prev.capabilities || []).filter((cap) => cap.type !== type)
      nextCaps.push({ type, isUserSelected: enabled } as AiModelCapability)
      return { ...prev, capabilities: nextCaps }
    })
  }

  const handleAddModel = () => {
    if (!aiDraft) return
    if (!newModel.id || !newModel.label) {
      setAiError('请填写模型 ID 与名称')
      return
    }
    const provider = aiDraft.providers[newModelProviderIndex]
    const providerSupportsEndpointRouting = provider ? supportsProviderEndpointRouting(provider) : false
    if (providerSupportsEndpointRouting && !newModel.endpointType) {
      setAiError('当前 Provider 类型模型需要设置 endpoint type')
      return
    }
    const providerRef = provider ? String(provider.id) : undefined
    const providerLabel = provider ? getProviderKey(provider) : undefined
    const models = [...(aiDraft.models || []), { ...newModel, providerRef, providerLabel }]
    updateAiDraft({ models })
    setNewModel({ id: '', label: '', description: '', endpointType: undefined, supportedEndpointTypes: undefined })
    setNewModelProviderIndex(0)
    setShowAddModelModal(false)
  }

  const openAddModelModal = () => {
    if (!aiDraft || aiDraft.providers.length === 0) {
      setNewModelProviderIndex(0)
      setNewModel((prev) => ({ ...prev, endpointType: undefined, supportedEndpointTypes: undefined }))
      setShowAddModelModal(true)
      return
    }
    const setIndex = aiDraft.providers[selectedProviderIndex] ? selectedProviderIndex : 0
    const provider = aiDraft.providers[setIndex]
    const providerSupportsEndpointRouting = provider ? supportsProviderEndpointRouting(provider) : false
    setNewModel((prev) => ({
      ...prev,
      endpointType: providerSupportsEndpointRouting ? (prev.endpointType || 'openai') : undefined,
      supportedEndpointTypes: providerSupportsEndpointRouting ? prev.supportedEndpointTypes : undefined
    }))
    if (aiDraft.providers[selectedProviderIndex]) {
      setNewModelProviderIndex(selectedProviderIndex)
    } else {
      setNewModelProviderIndex(0)
    }
    setShowAddModelModal(true)
  }

  const handleNewModelProviderIndexChange = (nextIndex: number) => {
    setNewModelProviderIndex(nextIndex)
    const nextProvider = (aiDraft?.providers || [])[nextIndex]
    const nextProviderSupportsEndpointRouting = nextProvider ? supportsProviderEndpointRouting(nextProvider) : false
    setNewModel((prev) => ({
      ...prev,
      endpointType: nextProviderSupportsEndpointRouting ? (prev.endpointType || 'openai') : undefined,
      supportedEndpointTypes: nextProviderSupportsEndpointRouting ? prev.supportedEndpointTypes : undefined
    }))
  }

  const handleRemoveModel = (index: number) => {
    if (!aiDraft?.models) return
    const models = aiDraft.models.filter((_, i) => i !== index)
    updateAiDraft({ models })
  }

  const handleUpdateModelParams = (modelId: string, patch: Partial<AiModelParameters>) => {
    if (!aiDraft?.models) return
    const actualIndex = aiDraft.models.findIndex((item) => item.id === modelId)
    if (actualIndex < 0) return
    const model = aiDraft.models[actualIndex]
    handleUpdateModel(actualIndex, { params: { ...(model.params || {}), ...patch } })
  }

  const handleToggleModelParam = (modelId: string, key: 'temperatureEnabled' | 'topPEnabled') => {
    if (!aiDraft?.models) return
    const actualIndex = aiDraft.models.findIndex((item) => item.id === modelId)
    if (actualIndex < 0) return
    const model = aiDraft.models[actualIndex]
    const current = model.params || {}
    const nextEnabled = !(current[key] ?? false)
    const patch: Partial<AiModelParameters> = { [key]: nextEnabled }
    if (nextEnabled && key === 'temperatureEnabled' && current.temperature === undefined) {
      patch.temperature = DEFAULT_TEMPERATURE
    }
    if (nextEnabled && key === 'topPEnabled' && current.topP === undefined) {
      patch.topP = DEFAULT_TOP_P
    }
    handleUpdateModelParams(modelId, patch)
  }

  const handleToggleModelMaxTokens = (modelId: string) => {
    if (!aiDraft?.models) return
    const actualIndex = aiDraft.models.findIndex((item) => item.id === modelId)
    if (actualIndex < 0) return
    const model = aiDraft.models[actualIndex]
    const current = model.params || {}
    const nextEnabled = !(current.maxOutputTokensEnabled ?? false)
    const patch: Partial<AiModelParameters> = { maxOutputTokensEnabled: nextEnabled }
    if (nextEnabled && current.maxOutputTokens === undefined) {
      patch.maxOutputTokens = 1024
    }
    handleUpdateModelParams(modelId, patch)
  }

  return {
    filteredModels,
    showAddModelModal,
    newModel,
    newModelProviderIndex,
    newModelNeedsEndpointType,
    inferredCapabilities,
    setShowAddModelModal,
    setNewModel,
    loadInferredCapabilities,
    getModelCapabilityState,
    isCapabilityAuto,
    updateModelCapabilities,
    openAddModelModal,
    handleAddModel,
    handleNewModelProviderIndexChange,
    handleRemoveModel,
    handleUpdateModel,
    handleUpdateModelParams,
    handleToggleModelParam,
    handleToggleModelMaxTokens,
    updateNewModelCapability
  }
}
