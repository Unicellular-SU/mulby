import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiModel, AiModelCapability, AiModelParameters, AiModelType, AiProviderConfig, AiSettings } from '../../shared/types/ai'
import { inferProviderType } from '../../shared/ai/providerType'
import { isEndpointRoutedProviderType, supportsProviderEndpointRouting } from '../../shared/ai/providerEndpointRouting'
import { buildProviderIdCounts, validateProviderConfig } from '../../shared/ai/providerValidation'
import { getProviderDefaultBaseURL } from '../../shared/ai/providerDefaults'
import { getProviderPreset } from '../../shared/ai/providerPresets'
import { getSystemDefaultProviderById, isSystemDefaultProviderId } from '../../shared/ai/systemProviders'
import { getSystemDefaultModels } from '../../shared/ai/systemModels'
import { splitApiKeyString } from '../../shared/ai/apiKeyPool'
import { useInAppNotice } from './InAppNotice'
import {
  AddModelModal,
  AddProviderModal,
  ApiKeyManagerModal,
  DefaultParamsModal,
  FetchedModelsModal,
  GlobalDefaultModelModal,
  type GlobalDefaultModelOption
} from './ai-settings/AiSettingsModals'
import { ProviderSettingsSection } from './ai-settings/ProviderSettingsSection'
import {
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  classNames,
  getModelCapabilityState as getSharedModelCapabilityState,
  isCapabilityAuto as getSharedIsCapabilityAuto,
  serializeApiKeys,
  type ApiKeyTestStatus,
  type ProviderListEntry,
  type ProviderModelOption
} from './ai-settings/shared'


interface AiSettingsViewProps {
  onBack: () => void
  onOpenMcpSettings?: () => void
  onOpenSkillsSettings?: () => void
}

export default function AiSettingsView({ onBack, onOpenMcpSettings, onOpenSkillsSettings }: AiSettingsViewProps) {
  const initialProviderPreset = getProviderPreset('openai')
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [aiDraft, setAiDraft] = useState<AiSettings | null>(null)
  const [aiReasoning, setAiReasoning] = useState<string | null>(null)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<AiModel[]>([])
  const [showModelModal, setShowModelModal] = useState(false)
  const [selectedFetchedModelIds, setSelectedFetchedModelIds] = useState<Set<string>>(new Set())
  const [fetchSearch, setFetchSearch] = useState('')
  const [fetchProviderLabel, setFetchProviderLabel] = useState<string | null>(null)
  const [showAddProviderModal, setShowAddProviderModal] = useState(false)
  const [showAddModelModal, setShowAddModelModal] = useState(false)
  const [showApiKeyManagerModal, setShowApiKeyManagerModal] = useState(false)
  const [showDefaultParamsModal, setShowDefaultParamsModal] = useState(false)
  const [showGlobalDefaultModelModal, setShowGlobalDefaultModelModal] = useState(false)
  const [globalDefaultModelSelection, setGlobalDefaultModelSelection] = useState('')
  const [newApiKeyInput, setNewApiKeyInput] = useState('')
  const [apiKeyTestModel, setApiKeyTestModel] = useState('')
  const [testingApiKeyIndex, setTestingApiKeyIndex] = useState<number | null>(null)
  const [apiKeyTestStatusMap, setApiKeyTestStatusMap] = useState<Record<string, ApiKeyTestStatus>>({})
  const [newModelProviderIndex, setNewModelProviderIndex] = useState<number>(0)
  const [selectedProviderIndex, setSelectedProviderIndex] = useState<number>(0)
  const notice = useInAppNotice()
  const setAiError = useCallback((message: string | null) => {
    if (message) notice.error(message)
  }, [notice])
  const setAiInfo = useCallback((message: string | null) => {
    if (message) notice.success(message)
  }, [notice])
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
  const [newModel, setNewModel] = useState<AiModel>({
    id: '',
    label: '',
    description: ''
  })
  const { pillClass, primaryPillClass } = classNames

  const getProviderKey = (provider: AiProviderConfig) => {
    const label = (provider.label || '').trim()
    return label ? label : String(provider.id)
  }

  const getProviderTypeLabel = (provider: AiProviderConfig) => inferProviderType(provider)
  const getDefaultAnthropicBaseURL = (providerId?: string) => {
    return getSystemDefaultProviderById(providerId)?.anthropicBaseURL || ''
  }

  const modelBelongsToProvider = (model: AiModel, provider: AiProviderConfig) => {
    if (model.providerRef) return String(model.providerRef) === String(provider.id)
    const providerKey = getProviderKey(provider)
    if (model.providerLabel) return model.providerLabel === providerKey
    const providerType = getProviderTypeLabel(provider)
    if (model.id.includes(':')) {
      const providerToken = model.id.split(':', 2)[0]
      return providerToken === String(provider.id) || providerToken === providerType
    }
    return model.id.startsWith(`${provider.id}:`)
  }

  const modelKey = (model: AiModel) => `${model.id}::${model.providerRef || model.providerLabel || ''}`

  const resolveProviderIdFromModel = (model: AiModel) => {
    const providers = aiDraft?.providers || []
    if (model.providerRef && providers.some((provider) => String(provider.id) === String(model.providerRef))) {
      return String(model.providerRef)
    }
    if (model.providerLabel) {
      const byLabel = providers.find((provider) => getProviderKey(provider) === model.providerLabel)
      if (byLabel) return String(byLabel.id)
    }
    if (model.id.includes(':')) {
      const providerToken = model.id.split(':', 2)[0]
      const byToken = providers.find((provider) =>
        String(provider.id) === providerToken || getProviderTypeLabel(provider) === providerToken
      )
      if (byToken) return String(byToken.id)
    }
    return ''
  }

  const selectedProvider = (aiDraft?.providers || [])[selectedProviderIndex] || null
  const selectedProviderApiKeys = useMemo(() => splitApiKeyString(selectedProvider?.apiKey), [selectedProvider?.apiKey])
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
  const filteredModels = (aiDraft?.models || []).filter((model) => {
    if (!selectedProvider) return false
    return modelBelongsToProvider(model, selectedProvider)
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
    filteredModels.forEach((model) => {
      if (!model.id) return
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
  }, [filteredModels, selectedProvider])
  const globalDefaultModelOptions = useMemo<GlobalDefaultModelOption[]>(() => {
    if (!aiDraft) return []
    const enabledProviders = (aiDraft.providers || []).filter((provider) => provider.enabled !== false)
    if (enabledProviders.length === 0) return []
    const enabledProviderMap = new Map(
      enabledProviders.map((provider) => [String(provider.id), provider] as const)
    )
    const options: GlobalDefaultModelOption[] = []
    const seenModelIds = new Set<string>()

    ;(aiDraft.models || []).forEach((model) => {
      if (!model.id) return
      const providerId = resolveProviderIdFromModel(model)
      if (!providerId) return
      const provider = enabledProviderMap.get(String(providerId))
      if (!provider) return
      if (seenModelIds.has(model.id)) return
      seenModelIds.add(model.id)
      options.push({
        id: model.id,
        label: model.label || model.id,
        providerLabel: getProviderKey(provider)
      })
    })

    enabledProviders.forEach((provider) => {
      const modelId = String(provider.defaultModel || '').trim()
      if (!modelId) return
      if (seenModelIds.has(modelId)) return
      seenModelIds.add(modelId)
      options.push({
        id: modelId,
        label: modelId,
        providerLabel: getProviderKey(provider)
      })
    })

    return options.sort((a, b) => {
      const providerCompare = a.providerLabel.localeCompare(b.providerLabel)
      if (providerCompare !== 0) return providerCompare
      return a.label.localeCompare(b.label)
    })
  }, [aiDraft])
  const newModelProvider = aiDraft?.providers?.[newModelProviderIndex]
  const newModelNeedsEndpointType = newModelProvider ? supportsProviderEndpointRouting(newModelProvider) : false

  useEffect(() => {
    if (window.mulby?.ai?.settings?.get) {
      window.mulby.ai.settings.get()
        .then((next) => {
          setAiSettings(next)
          setAiDraft(next)
          loadInferredCapabilities()
        })
        .catch((err) => {
          console.error('Failed to load AI settings:', err)
          setAiError('AI 设置加载失败')
        })
    } else {
      setAiError('AI 接口未就绪，请重启应用')
    }
  }, [])

  const [inferredCapabilities, setInferredCapabilities] = useState<Record<string, Set<AiModelType>>>({})

  const loadInferredCapabilities = async () => {
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
  }

  const getModelCapabilityState = (model: AiModel, type: AiModelType) => {
    return getSharedModelCapabilityState(model, type, inferredCapabilities)
  }

  const isCapabilityAuto = (model: AiModel, type: AiModelType) => {
    return getSharedIsCapabilityAuto(model, type)
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

  const updateAiDraft = (patch: Partial<AiSettings>) => {
    setAiDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...patch,
        providers: patch.providers ?? prev.providers,
        models: patch.models ?? prev.models
      }
    })
  }

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
      loadInferredCapabilities()
      setAiError(null)
      setAiInfo('已保存 AI 配置')
    } catch (err) {
      console.error('Failed to save AI settings:', err)
      setAiError('AI 设置保存失败')
    }
  }

  const handleResetAiSettings = () => {
    setAiDraft(aiSettings)
    setGlobalDefaultModelSelection('')
    setAiError(null)
    setAiInfo(null)
    setAiReasoning(null)
  }

  const openGlobalDefaultModelModal = () => {
    const current = String(aiDraft?.defaultModel || '').trim()
    const selected =
      current && globalDefaultModelOptions.some((item) => item.id === current)
        ? current
        : (globalDefaultModelOptions[0]?.id || '')
    setGlobalDefaultModelSelection(selected)
    setShowGlobalDefaultModelModal(true)
  }

  const handleConfirmGlobalDefaultModel = () => {
    if (!aiDraft) return
    if (!globalDefaultModelSelection) {
      setAiError('请先选择一个模型')
      return
    }
    if (!globalDefaultModelOptions.some((item) => item.id === globalDefaultModelSelection)) {
      setAiError('所选模型不可用，请重新选择')
      return
    }
    updateAiDraft({ defaultModel: globalDefaultModelSelection })
    setShowGlobalDefaultModelModal(false)
    setAiError(null)
    setAiInfo(`已设置全局默认模型：${globalDefaultModelSelection}`)
  }

  const handleClearGlobalDefaultModel = () => {
    if (!aiDraft) return
    updateAiDraft({ defaultModel: undefined })
    setGlobalDefaultModelSelection('')
    setShowGlobalDefaultModelModal(false)
    setAiError(null)
    setAiInfo('已清空全局默认模型')
  }

  useEffect(() => {
    if (!aiDraft || aiDraft.providers.length === 0) {
      if (selectedProviderIndex !== 0) setSelectedProviderIndex(0)
      return
    }
    if (selectedProviderIndex >= aiDraft.providers.length) {
      setSelectedProviderIndex(Math.max(0, aiDraft.providers.length - 1))
    }
  }, [aiDraft, selectedProviderIndex])

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

  const buildProviderInstanceId = (preferred: string, type: string) => {
    const providers = aiDraft?.providers || []
    const seed = (preferred || type || 'provider').trim().toLowerCase().replace(/\s+/g, '-')
    const base = seed || 'provider'
    const existing = new Set(providers.map((provider) => String(provider.id)))
    if (!existing.has(base)) return base
    let index = 2
    while (existing.has(`${base}-${index}`)) index += 1
    return `${base}-${index}`
  }

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
    const providerId = buildProviderInstanceId(String(newProvider.id || ''), providerType)
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

  const updateSelectedProviderApiKeys = (keys: string[]) => {
    if (!selectedProvider) return
    handleUpdateProvider(selectedProviderIndex, { apiKey: serializeApiKeys(keys) })
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

  const handleUpdateModel = (index: number, patch: Partial<AiModel>) => {
    if (!aiDraft?.models) return
    const models = aiDraft.models.map((model, i) => (i === index ? { ...model, ...patch } : model))
    updateAiDraft({ models })
  }

  const handleUpdateDefaultParams = (patch: Partial<AiModelParameters>) => {
    if (!aiDraft) return
    const defaultParams = { ...(aiDraft.defaultParams || {}), ...patch }
    updateAiDraft({ defaultParams })
  }

  const handleToggleDefaultParam = (key: 'temperatureEnabled' | 'topPEnabled') => {
    if (!aiDraft) return
    const current = aiDraft.defaultParams || {}
    const nextEnabled = !(current[key] ?? false)
    const patch: Partial<AiModelParameters> = { [key]: nextEnabled }
    if (nextEnabled && key === 'temperatureEnabled' && current.temperature === undefined) {
      patch.temperature = DEFAULT_TEMPERATURE
    }
    if (nextEnabled && key === 'topPEnabled' && current.topP === undefined) {
      patch.topP = DEFAULT_TOP_P
    }
    handleUpdateDefaultParams(patch)
  }

  const handleToggleDefaultMaxTokens = () => {
    if (!aiDraft) return
    const current = aiDraft.defaultParams || {}
    const nextEnabled = !(current.maxOutputTokensEnabled ?? false)
    const patch: Partial<AiModelParameters> = { maxOutputTokensEnabled: nextEnabled }
    if (nextEnabled && current.maxOutputTokens === undefined) {
      patch.maxOutputTokens = 1024
    }
    handleUpdateDefaultParams(patch)
  }

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

  const handleFetchModels = async (provider: AiProviderConfig) => {
    setAiInfo(null)
    setAiError(null)
    if (!window.mulby?.ai?.models?.fetch) {
      setAiError('AI 接口未就绪，请重启应用')
      return
    }

    if (!provider) {
      setAiError('请选择有效的 Provider')
      return
    }

    try {
      setIsFetchingModels(true)
      setFetchProviderLabel(getProviderKey(provider))
      const result = await window.mulby.ai.models.fetch({
        providerId: String(provider.id),
        baseURL: provider.baseURL,
        apiKey: provider.apiKey
      })

      if (result.message) {
        setAiInfo(result.message)
      }

      if (!result.models || result.models.length === 0) {
        setAiError('未拉取到模型，请检查 API Key 或地址')
        return
      }

      const normalizedFetchedModels = result.models.map((model) => ({
        ...model,
        providerRef: String(provider.id),
        providerLabel: getProviderKey(provider)
      }))
      const localDefaultModels = getSystemDefaultModels()
        .filter((model) => String(model.providerRef || '') === String(provider.id))
        .map((model) => ({
          ...model,
          providerRef: String(provider.id),
          providerLabel: getProviderKey(provider)
        }))
      const mergedModels: AiModel[] = []
      const seen = new Set<string>()
        ;[...normalizedFetchedModels, ...localDefaultModels].forEach((model) => {
          const key = modelKey(model)
          if (seen.has(key)) return
          seen.add(key)
          mergedModels.push(model)
        })
      const existing = new Set((aiDraft?.models || []).map((model) => modelKey(model)))
      const selectedIds = mergedModels
        .filter((model) => existing.has(modelKey(model)))
        .map((model) => model.id)
      setFetchedModels(mergedModels)
      setSelectedFetchedModelIds(new Set(selectedIds))
      setShowModelModal(true)
    } catch (err) {
      console.error('Failed to fetch models:', err)
      setAiError('拉取模型失败')
    } finally {
      setIsFetchingModels(false)
    }
  }

  const toggleFetchedModel = (id: string) => {
    setSelectedFetchedModelIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const filteredFetchedModels = fetchedModels.filter((model) => {
    if (!fetchSearch.trim()) return true
    const q = fetchSearch.trim().toLowerCase()
    return model.id.toLowerCase().includes(q) || model.label.toLowerCase().includes(q)
  })

  const selectAllFetched = () => {
    setSelectedFetchedModelIds(new Set(filteredFetchedModels.map((model) => model.id)))
  }

  const invertFetchedSelection = () => {
    setSelectedFetchedModelIds((prev) => {
      const next = new Set(prev)
      filteredFetchedModels.forEach((model) => {
        if (next.has(model.id)) {
          next.delete(model.id)
        } else {
          next.add(model.id)
        }
      })
      return next
    })
  }

  const handleAddFetchedModels = () => {
    if (!aiDraft) return

    const fetchedKeySet = new Set(fetchedModels.map((model) => modelKey(model)))
    const selectedFetchedModels = fetchedModels.filter((model) => selectedFetchedModelIds.has(model.id))
    const selectedFetchedKeySet = new Set(selectedFetchedModels.map((model) => modelKey(model)))

    const currentModels = aiDraft.models || []
    const keptModels = currentModels.filter((model) => {
      const key = modelKey(model)
      if (!fetchedKeySet.has(key)) return true
      return selectedFetchedKeySet.has(key)
    })
    const keptKeySet = new Set(keptModels.map((model) => modelKey(model)))
    const toAdd = selectedFetchedModels.filter((model) => !keptKeySet.has(modelKey(model)))
    const nextModels = [...keptModels, ...toAdd]

    const removedCount = currentModels.length - keptModels.length
    const addedCount = toAdd.length
    updateAiDraft({ models: nextModels })
    if (addedCount > 0 || removedCount > 0) {
      setAiInfo(`模型已同步：新增 ${addedCount} 个，移除 ${removedCount} 个`)
    } else {
      setAiInfo('模型无变化')
    }
    setShowModelModal(false)
  }

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
      const providerModel = selectedProvider.defaultModel || aiDraft?.models?.find((item) => modelBelongsToProvider(item, selectedProvider))?.id
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
        if ((result as any).reasoning) {
          setAiReasoning((result as any).reasoning)
        }
      } else {
        setAiError(result.message || '连接失败')
      }
    } finally {
      setIsTestingConnection(false)
    }
  }

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

  const handleFetchModelsForSelectedProvider = () => {
    if (!selectedProvider) return
    handleFetchModels(selectedProvider)
  }

  return (
    <div className="flex h-full flex-col bg-white/50 dark:bg-slate-900/30">
      <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
          title="返回"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">AI Settings</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">AI 配置中心</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`${pillClass} no-drag`}
            onClick={openGlobalDefaultModelModal}
            title="设置未指定模型时使用的全局默认模型"
          >
            默认模型
          </button>
          <button className={`${pillClass} no-drag`} onClick={() => setShowDefaultParamsModal(true)} title="配置全局默认参数">
            默认参数
          </button>
          {onOpenSkillsSettings && (
            <button className={`${pillClass} no-drag`} onClick={onOpenSkillsSettings} title="进入 Skills 创建、安装与预览管理">
              Skills 管理
            </button>
          )}
          {onOpenMcpSettings && (
            <button className={`${pillClass} no-drag`} onClick={onOpenMcpSettings} title="进入 MCP 服务器与工具策略管理">
              MCP 管理
            </button>
          )}
          <button className={`${pillClass} no-drag`} onClick={handleResetAiSettings} title="恢复到上次保存的配置">恢复</button>
          <button
            className={`${primaryPillClass} no-drag disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={handleSaveAiSettings}
            disabled={hasProviderBlockingIssues}
            title={hasProviderBlockingIssues ? '存在 Provider 配置错误，请先修复' : '保存'}
          >
            保存
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 no-drag">
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-6 pb-6 pt-6">
          {(hasProviderBlockingIssues || aiReasoning) && (
            <div className="shrink-0 space-y-4 pb-4">
              {hasProviderBlockingIssues && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
                  检测到 Provider 配置问题（重复实例 ID 或缺少 API Key / Base URL），请先修复后再保存。
                </div>
              )}
              {aiReasoning && (
                <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-xs text-slate-600 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-300">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">思考过程</div>
                  <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{aiReasoning}</div>
                </div>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1">
            <ProviderSettingsSection
              aiDraft={aiDraft}
              sortedProviderEntries={sortedProviderEntries}
              selectedProvider={selectedProvider}
              selectedProviderIndex={selectedProviderIndex}
              selectedProviderValidation={selectedProviderValidation}
              selectedProviderIsSystemDefault={selectedProviderIsSystemDefault}
              selectedProviderType={selectedProviderType}
              selectedProviderSupportsEndpointRouting={selectedProviderSupportsEndpointRouting}
              selectedProviderDefaultBaseURL={selectedProviderDefaultBaseURL}
              selectedProviderDefaultAnthropicBaseURL={selectedProviderDefaultAnthropicBaseURL}
              filteredModels={filteredModels}
              isTestingConnection={isTestingConnection}
              isFetchingModels={isFetchingModels}
              setSelectedProviderIndex={setSelectedProviderIndex}
              onOpenAddProviderModal={() => setShowAddProviderModal(true)}
              onTestConnection={handleTestSelectedProviderConnection}
              onUpdateSelectedProvider={handleUpdateSelectedProvider}
              onRemoveSelectedProvider={handleRemoveSelectedProvider}
              onSelectedProviderTypeChange={handleSelectedProviderTypeChange}
              openApiKeyManager={openApiKeyManager}
              onUpdateSelectedProviderParams={handleUpdateSelectedProviderParams}
              onToggleSelectedProviderParam={handleToggleSelectedProviderParam}
              onToggleSelectedProviderMaxTokens={handleToggleSelectedProviderMaxTokens}
              onFetchModelsForSelectedProvider={handleFetchModelsForSelectedProvider}
              openAddModelModal={openAddModelModal}
              handleRemoveModel={handleRemoveModel}
              handleUpdateModel={handleUpdateModel}
              resolveProviderIdFromModel={resolveProviderIdFromModel}
              getProviderKey={getProviderKey}
              getProviderTypeLabel={getProviderTypeLabel}
              getModelCapabilityState={getModelCapabilityState}
              isCapabilityAuto={isCapabilityAuto}
              updateModelCapabilities={updateModelCapabilities}
              handleUpdateModelParams={handleUpdateModelParams}
              onToggleModelParam={handleToggleModelParam}
              onToggleModelMaxTokens={handleToggleModelMaxTokens}
            />
          </div>
        </div>
      </div>

      <FetchedModelsModal
        show={showModelModal}
        fetchProviderLabel={fetchProviderLabel}
        fetchSearch={fetchSearch}
        filteredFetchedModels={filteredFetchedModels}
        selectedFetchedModelIds={selectedFetchedModelIds}
        onClose={() => setShowModelModal(false)}
        onFetchSearchChange={setFetchSearch}
        onSelectAll={selectAllFetched}
        onInvertSelection={invertFetchedSelection}
        onToggleFetchedModel={toggleFetchedModel}
        onAddSelected={handleAddFetchedModels}
      />

      <ApiKeyManagerModal
        show={showApiKeyManagerModal}
        selectedProvider={selectedProvider}
        selectedProviderApiKeys={selectedProviderApiKeys}
        selectedProviderModelOptions={selectedProviderModelOptions}
        newApiKeyInput={newApiKeyInput}
        apiKeyTestModel={apiKeyTestModel}
        testingApiKeyIndex={testingApiKeyIndex}
        apiKeyTestStatusMap={apiKeyTestStatusMap}
        onClose={() => setShowApiKeyManagerModal(false)}
        onNewApiKeyInputChange={setNewApiKeyInput}
        onApiKeyTestModelChange={setApiKeyTestModel}
        onAddApiKey={handleAddApiKey}
        onTestSingleApiKey={handleTestSingleApiKey}
        onRemoveApiKey={handleRemoveApiKey}
        getProviderKey={getProviderKey}
      />

      <AddProviderModal
        show={showAddProviderModal}
        newProvider={newProvider}
        newProviderDefaultBaseURL={newProviderDefaultBaseURL}
        newProviderDefaultAnthropicBaseURL={newProviderDefaultAnthropicBaseURL}
        onClose={() => setShowAddProviderModal(false)}
        onAddProvider={handleAddProvider}
        onNewProviderTypeChange={handleNewProviderTypeChange}
        setNewProvider={setNewProvider}
      />

      <AddModelModal
        show={showAddModelModal}
        aiDraft={aiDraft}
        newModel={newModel}
        newModelProviderIndex={newModelProviderIndex}
        newModelNeedsEndpointType={newModelNeedsEndpointType}
        inferredCapabilities={inferredCapabilities}
        onClose={() => setShowAddModelModal(false)}
        onAddModel={handleAddModel}
        onNewModelProviderIndexChange={handleNewModelProviderIndexChange}
        setNewModel={setNewModel}
        updateNewModelCapability={updateNewModelCapability}
        getProviderKey={getProviderKey}
      />

      <DefaultParamsModal
        show={showDefaultParamsModal}
        aiDraft={aiDraft}
        onClose={() => setShowDefaultParamsModal(false)}
        onUpdateDefaultParams={handleUpdateDefaultParams}
        onToggleDefaultParam={handleToggleDefaultParam}
        onToggleDefaultMaxTokens={handleToggleDefaultMaxTokens}
      />

      <GlobalDefaultModelModal
        show={showGlobalDefaultModelModal}
        options={globalDefaultModelOptions}
        selectedModelId={globalDefaultModelSelection}
        currentModelId={aiDraft?.defaultModel}
        onClose={() => setShowGlobalDefaultModelModal(false)}
        onSelectedModelIdChange={setGlobalDefaultModelSelection}
        onConfirm={handleConfirmGlobalDefaultModel}
        onClear={handleClearGlobalDefaultModel}
      />
    </div>
  )
}
