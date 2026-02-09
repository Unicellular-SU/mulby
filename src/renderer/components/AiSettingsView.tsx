import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiEndpointType, AiModel, AiModelCapability, AiModelParameters, AiModelType, AiProviderConfig, AiSettings } from '../../shared/types/ai'
import { BUILTIN_PROVIDER_TYPES, inferProviderType } from '../../shared/ai/providerType'
import { isEndpointRoutedProviderType, supportsProviderEndpointRouting } from '../../shared/ai/providerEndpointRouting'
import { buildProviderIdCounts, validateProviderConfig } from '../../shared/ai/providerValidation'
import { getProviderDefaultBaseURL } from '../../shared/ai/providerDefaults'
import { getProviderPreset } from '../../shared/ai/providerPresets'
import { getSystemDefaultProviderById, isSystemDefaultProviderId } from '../../shared/ai/systemProviders'
import { getSystemDefaultModels } from '../../shared/ai/systemModels'
import { splitApiKeyString } from '../../shared/ai/apiKeyPool'
import { useInAppNotice } from './InAppNotice'
import SliderWithTicks from './SliderWithTicks'
import UnifiedSelect from './UnifiedSelect'

const PROVIDER_TYPE_OPTIONS = [...BUILTIN_PROVIDER_TYPES] as string[]
const PROVIDER_TYPE_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  'openai-response': 'OpenAI-Response',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  'azure-openai': 'Azure OpenAI',
  'new-api': 'New API',
  cherryin: 'CherryIN',
  ollama: 'Ollama',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  'openai-compatible': 'OpenAI Compatible'
}
const ENDPOINT_TYPE_OPTIONS: AiEndpointType[] = ['openai', 'openai-response', 'anthropic', 'gemini', 'image-generation', 'jina-rerank']

function getProviderTypeOptions(currentType?: string): string[] {
  const normalized = String(currentType || '').trim().toLowerCase()
  const base = [...PROVIDER_TYPE_OPTIONS]
  if (!normalized || base.includes(normalized)) return base
  return [normalized, ...base]
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      onClick={onChange}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}


interface AiSettingsViewProps {
  onBack: () => void
  onOpenMcpSettings?: () => void
  onOpenSkillsSettings?: () => void
}

interface ProviderListEntry {
  provider: AiProviderConfig
  index: number
}

interface ProviderModelOption {
  id: string
  label: string
}

interface ApiKeyTestStatus {
  state: 'success' | 'error' | 'testing'
  message: string
}

function serializeApiKeys(keys: string[]): string {
  return keys
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => key.replace(/,/g, '\\,'))
    .join(',')
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

  const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white p-6 dark:border-slate-800/80 dark:bg-slate-900'
  const cardClassTight = 'rounded-[24px] border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900'
  const pillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white'
  const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'

  const miniInputClass = 'w-24 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const tipWrapClass = 'relative inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 group'
  const tipBubbleClass = 'pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 opacity-0 shadow-lg transition group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
  const DEFAULT_TEMPERATURE = 0.7
  const DEFAULT_TOP_P = 1
  const DEFAULT_CONTEXT_WINDOW = 8
  const MODEL_CAPABILITIES: Array<{ type: AiModelType; label: string }> = [
    { type: 'vision', label: '视觉' },
    { type: 'reasoning', label: '推理' },
    { type: 'function_calling', label: '工具' },
    { type: 'web_search', label: '联网' },
    { type: 'embedding', label: '嵌入' },
    { type: 'rerank', label: '重排' }
  ]
  const formatNumber = (value?: number) => (value === undefined || Number.isNaN(value) ? '' : String(value))
  const parseOptionalNumber = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : undefined
  }
  const formatStopSequences = (value?: string[]) => (value && value.length > 0 ? value.join('\n') : '')
  const parseStopSequences = (value: string) => {
    const items = value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    return items.length > 0 ? items : undefined
  }
  const formatEndpointTypes = (value?: AiEndpointType[]) => (value && value.length > 0 ? value.join(', ') : '')
  const parseEndpointTypes = (value: string): AiEndpointType[] | undefined => {
    const allowed = new Set<AiEndpointType>(ENDPOINT_TYPE_OPTIONS)
    const items = value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter((item): item is AiEndpointType => allowed.has(item as AiEndpointType))
    return items.length > 0 ? Array.from(new Set(items)) : undefined
  }

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
  const newModelProvider = aiDraft?.providers?.[newModelProviderIndex]
  const newModelNeedsEndpointType = newModelProvider ? supportsProviderEndpointRouting(newModelProvider) : false

  useEffect(() => {
    if (window.intools?.ai?.settings?.get) {
      window.intools.ai.settings.get()
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
    if (!window.intools?.ai?.allModels) return
    try {
      const list = await window.intools.ai.allModels()
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
    const caps = model.capabilities || []
    const item = caps.find((cap) => cap.type === type)
    if (item) {
      return item.isUserSelected !== false
    }
    const inferred = inferredCapabilities[model.id]
    if (inferred) {
      return inferred.has(type)
    }
    return false
  }

  const isCapabilityAuto = (model: AiModel, type: AiModelType) => {
    const caps = model.capabilities || []
    const item = caps.find((cap) => cap.type === type)
    return !item
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
    if (!window.intools?.ai?.settings?.update) {
      setAiError('AI 接口未就绪，请重启应用')
      return
    }
    try {
      const next = await window.intools.ai.settings.update(aiDraft)
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
    setAiError(null)
    setAiInfo(null)
    setAiReasoning(null)
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
    if (!window.intools?.ai?.testConnection) {
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
      const result = await window.intools.ai.testConnection({
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
    if (!window.intools?.ai?.models?.fetch) {
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
      const result = await window.intools.ai.models.fetch({
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

      <div className="flex-1 overflow-y-auto no-drag">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-8 space-y-4">
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

          <div className={`${cardClass} space-y-4`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-900 dark:text-white">供应商配置</div>
              <div className="flex items-center gap-2">
                <button className={`${primaryPillClass} no-drag`} onClick={() => setShowAddProviderModal(true)}>
                  + 新增供应商
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr]">
              <div className="space-y-2">
                {(aiDraft?.providers || []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
                    暂无 Provider，请先新增
                  </div>
                ) : (
                  sortedProviderEntries.map(({ provider, index }) => (
                    <button
                      key={`${provider.id}-${index}`}
                      className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left text-sm transition ${index === selectedProviderIndex ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'}`}
                      onClick={() => setSelectedProviderIndex(index)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{getProviderKey(provider)}</div>
                        <div className={`truncate text-xs ${index === selectedProviderIndex ? 'text-white/70 dark:text-slate-600' : 'text-slate-400 dark:text-slate-500'}`}>
                          {getProviderTypeLabel(provider)} · {provider.id}
                        </div>
                      </div>
                      <span
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${provider.enabled ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        title={provider.enabled ? '已启用' : '已停用'}
                        aria-label={provider.enabled ? '已启用' : '已停用'}
                      />
                    </button>
                  ))
                )}
              </div>

              <div className={`${cardClassTight} space-y-3`}>
                {!selectedProvider ? (
                  <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
                    请选择一个 Provider 查看详情
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-[160px]">
                        <div className="text-sm font-medium text-slate-900 dark:text-white">{getProviderKey(selectedProvider)}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {getProviderTypeLabel(selectedProvider)} · {selectedProvider.id}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className={`${pillClass} no-drag`}
                          onClick={async () => {
                            setAiInfo(null)
                            setAiError(null)
                            if (!window.intools?.ai?.testConnection) {
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
                              const result = await (window.intools.ai.testConnectionStream
                                ? window.intools.ai.testConnectionStream({
                                  model: fallbackModel,
                                  providerId: String(selectedProvider.id),
                                  apiKey: selectedProvider.apiKey,
                                  baseURL: selectedProvider.baseURL
                                }, (chunk) => {
                                  if (chunk.type === 'reasoning') {
                                    reasoningStreamed += chunk.text
                                    setAiReasoning(reasoningStreamed)
                                    return
                                  }
                                })
                                : window.intools.ai.testConnection({
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
                          }}
                          disabled={isTestingConnection || !selectedProviderValidation.canTestConnection}
                          title={selectedProviderValidation.testConnectionHint || '测试连接'}
                        >
                          {isTestingConnection ? '测试中…' : '测试连接'}
                        </button>
                        <button
                          className={selectedProvider.enabled ? primaryPillClass : pillClass}
                          onClick={() => handleUpdateProvider(selectedProviderIndex, { enabled: !selectedProvider.enabled })}
                        >
                          {selectedProvider.enabled ? '已启用' : '已停用'}
                        </button>
                        <button
                          className={actionButtonClass}
                          onClick={() => handleRemoveProvider(selectedProviderIndex)}
                          disabled={selectedProviderIsSystemDefault}
                          title={selectedProviderIsSystemDefault ? '系统默认供应商不可删除，可改为停用' : '删除'}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <UnifiedSelect
                        value={getProviderTypeLabel(selectedProvider)}
                        onChange={(e) => {
                          const nextProvider = applyProviderTypePreset(selectedProvider, e.target.value)
                          handleUpdateProvider(selectedProviderIndex, nextProvider)
                        }}
                      >
                        {getProviderTypeOptions(getProviderTypeLabel(selectedProvider)).map((type) => (
                          <option key={type} value={type}>
                            {PROVIDER_TYPE_LABELS[type] || type}
                          </option>
                        ))}
                      </UnifiedSelect>
                      <input
                        className={inputClass}
                        placeholder="Provider 实例 ID（如 v3-openai）"
                        value={selectedProvider.id}
                        onChange={(e) => handleUpdateProvider(selectedProviderIndex, { id: e.target.value })}
                      />
                      <input
                        className={inputClass}
                        placeholder="显示名称（可选）"
                        value={selectedProvider.label || ''}
                        onChange={(e) => handleUpdateProvider(selectedProviderIndex, { label: e.target.value })}
                      />
                      <div className="flex items-center gap-2">
                        <input
                          className={`${inputClass} flex-1`}
                          placeholder="API Key（支持多个，逗号分隔）"
                          value={selectedProvider.apiKey || ''}
                          onChange={(e) => handleUpdateProvider(selectedProviderIndex, { apiKey: e.target.value })}
                        />
                        <button
                          className={`${pillClass} shrink-0 no-drag`}
                          onClick={openApiKeyManager}
                          title="管理 API Key"
                          aria-label="管理 API Key"
                        >
                          管理
                        </button>
                      </div>
                      <input
                        className={inputClass}
                        placeholder="Base URL（可选）"
                        value={selectedProvider.baseURL || ''}
                        onChange={(e) => handleUpdateProvider(selectedProviderIndex, { baseURL: e.target.value })}
                      />
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        默认 Base URL：{selectedProviderDefaultBaseURL || '无（需手动填写）'}
                      </div>
                      {selectedProviderSupportsEndpointRouting && (
                        <>
                          <input
                            className={inputClass}
                            placeholder="Anthropic Base URL（可选）"
                            value={selectedProvider.anthropicBaseURL || selectedProviderDefaultAnthropicBaseURL || ''}
                            onChange={(e) => handleUpdateProvider(selectedProviderIndex, { anthropicBaseURL: e.target.value })}
                          />
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            默认 Anthropic Base URL：{selectedProviderDefaultAnthropicBaseURL || '无（将使用 Base URL）'}
                          </div>
                        </>
                      )}
                      {(selectedProviderType === 'azure-openai' || selectedProviderType === 'azure') && (
                        <input
                          className={inputClass}
                          placeholder="API Version（Azure OpenAI）"
                          value={selectedProvider.apiVersion || ''}
                          onChange={(e) => handleUpdateProvider(selectedProviderIndex, { apiVersion: e.target.value })}
                        />
                      )}
                    </div>
                    {selectedProviderValidation.issues.length > 0 && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
                        {selectedProviderValidation.issues.join('；')}
                      </div>
                    )}
                    <details className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800/80 dark:bg-slate-900/50 dark:text-slate-200">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">供应商默认参数</summary>
                      <div className="mt-3 space-y-4">
                        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-950">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">上下文条数</div>
                          <SliderWithTicks
                            value={selectedProvider.defaultParams?.contextWindow ?? aiDraft?.defaultParams?.contextWindow ?? DEFAULT_CONTEXT_WINDOW}
                            min={0}
                            max={100}
                            step={1}
                            ticks={[
                              { value: 0 },
                              { value: 5 },
                              { value: 10 },
                              { value: 20 },
                              { value: 50 },
                              { value: 100, label: '∞' }
                            ]}
                            snapToTicks
                            onChange={(next) => handleUpdateProviderParams(selectedProviderIndex, { contextWindow: next })}
                          />
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-slate-500 dark:text-slate-400">100 表示不限</span>
                            <input
                              className={miniInputClass}
                              type="number"
                              min="0"
                              step="1"
                              value={formatNumber(selectedProvider.defaultParams?.contextWindow)}
                              onChange={(e) => handleUpdateProviderParams(selectedProviderIndex, { contextWindow: parseOptionalNumber(e.target.value) })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-600 dark:text-slate-300">温度</span>
                              <Switch
                                checked={selectedProvider.defaultParams?.temperatureEnabled ?? false}
                                onChange={() => handleToggleProviderParam(selectedProviderIndex, 'temperatureEnabled')}
                              />
                            </div>
                            <div className="mt-2 flex flex-col gap-2">
                              <SliderWithTicks
                                value={selectedProvider.defaultParams?.temperature ?? DEFAULT_TEMPERATURE}
                                min={0}
                                max={2}
                                step={0.05}
                                ticks={[
                                  { value: 0 },
                                  { value: 0.5 },
                                  { value: 1 },
                                  { value: 1.5 },
                                  { value: 2 }
                                ]}
                                snapToTicks
                                disabled={!(selectedProvider.defaultParams?.temperatureEnabled ?? false)}
                                onChange={(next) => handleUpdateProviderParams(selectedProviderIndex, { temperature: next })}
                              />
                              <input
                                className={miniInputClass}
                                type="number"
                                min="0"
                                max="2"
                                step="0.05"
                                value={formatNumber(selectedProvider.defaultParams?.temperature)}
                                onChange={(e) => handleUpdateProviderParams(selectedProviderIndex, { temperature: parseOptionalNumber(e.target.value) })}
                                disabled={!(selectedProvider.defaultParams?.temperatureEnabled ?? false)}
                              />
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-600 dark:text-slate-300">Top-P</span>
                              <Switch
                                checked={selectedProvider.defaultParams?.topPEnabled ?? false}
                                onChange={() => handleToggleProviderParam(selectedProviderIndex, 'topPEnabled')}
                              />
                            </div>
                            <div className="mt-2 flex flex-col gap-2">
                              <SliderWithTicks
                                value={selectedProvider.defaultParams?.topP ?? DEFAULT_TOP_P}
                                min={0}
                                max={1}
                                step={0.05}
                                ticks={[
                                  { value: 0 },
                                  { value: 0.25 },
                                  { value: 0.5 },
                                  { value: 0.75 },
                                  { value: 1 }
                                ]}
                                snapToTicks
                                disabled={!(selectedProvider.defaultParams?.topPEnabled ?? false)}
                                onChange={(next) => handleUpdateProviderParams(selectedProviderIndex, { topP: next })}
                              />
                              <input
                                className={miniInputClass}
                                type="number"
                                min="0"
                                max="1"
                                step="0.05"
                                value={formatNumber(selectedProvider.defaultParams?.topP)}
                                onChange={(e) => handleUpdateProviderParams(selectedProviderIndex, { topP: parseOptionalNumber(e.target.value) })}
                                disabled={!(selectedProvider.defaultParams?.topPEnabled ?? false)}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-950">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-600 dark:text-slate-300">最大输出 tokens</span>
                              <span className={tipWrapClass}>
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="12" r="9" />
                                  <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span className={tipBubbleClass}>单次最大输出 token，过大可能报错。关闭表示不限制。</span>
                              </span>
                            </div>
                            <Switch
                              checked={selectedProvider.defaultParams?.maxOutputTokensEnabled ?? false}
                              onChange={() => handleToggleProviderMaxTokens(selectedProviderIndex)}
                            />
                          </div>
                          <div className="mt-3 flex items-center justify-between">
                            <span className="text-xs text-slate-500 dark:text-slate-400">关闭表示不限制</span>
                            <input
                              className={miniInputClass}
                              type="number"
                              min="1"
                              step="1"
                              value={formatNumber(selectedProvider.defaultParams?.maxOutputTokens)}
                              onChange={(e) => handleUpdateProviderParams(selectedProviderIndex, { maxOutputTokens: parseOptionalNumber(e.target.value) })}
                              disabled={!(selectedProvider.defaultParams?.maxOutputTokensEnabled ?? false)}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <input
                            className={inputClass}
                            placeholder="Presence Penalty (-2~2)"
                            value={formatNumber(selectedProvider.defaultParams?.presencePenalty)}
                            onChange={(e) => handleUpdateProviderParams(selectedProviderIndex, { presencePenalty: parseOptionalNumber(e.target.value) })}
                          />
                          <input
                            className={inputClass}
                            placeholder="Frequency Penalty (-2~2)"
                            value={formatNumber(selectedProvider.defaultParams?.frequencyPenalty)}
                            onChange={(e) => handleUpdateProviderParams(selectedProviderIndex, { frequencyPenalty: parseOptionalNumber(e.target.value) })}
                          />
                          <input
                            className={inputClass}
                            placeholder="Seed"
                            value={formatNumber(selectedProvider.defaultParams?.seed)}
                            onChange={(e) => handleUpdateProviderParams(selectedProviderIndex, { seed: parseOptionalNumber(e.target.value) })}
                          />
                          <textarea
                            className={`${inputClass} min-h-[72px] sm:col-span-3`}
                            placeholder="Stop sequences (换行或逗号分隔)"
                            value={formatStopSequences(selectedProvider.defaultParams?.stopSequences)}
                            onChange={(e) => handleUpdateProviderParams(selectedProviderIndex, { stopSequences: parseStopSequences(e.target.value) })}
                          />
                        </div>
                      </div>
                    </details>

                    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-slate-900 dark:text-white">模型管理</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            默认模型：{selectedProvider.defaultModel || '未设置'} · 已关联 {filteredModels.length} 个模型
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className={`${primaryPillClass} no-drag`}
                            onClick={() => handleFetchModels(selectedProvider)}
                            disabled={isFetchingModels || !selectedProviderValidation.canFetchModels}
                            title={selectedProviderValidation.fetchModelsHint || '拉取模型'}
                          >
                            {isFetchingModels ? '拉取中…' : '拉取模型'}
                          </button>
                          <button className={`${pillClass} no-drag`} onClick={openAddModelModal}>
                            + 新增模型
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {filteredModels.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/70 px-4 py-5 text-center text-sm text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
                            当前 Provider 暂无模型
                          </div>
                        ) : (
                          filteredModels.map((model, index) => (
                            <details key={`${model.id}-${index}`} className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/70">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-slate-900 dark:text-white">{model.label}</div>
                                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">{model.id}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    className={selectedProvider.defaultModel === model.id ? primaryPillClass : pillClass}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      handleUpdateProvider(selectedProviderIndex, { defaultModel: model.id })
                                    }}
                                  >
                                    {selectedProvider.defaultModel === model.id ? '默认模型' : '设为默认'}
                                  </button>
                                  <button className={actionButtonClass} onClick={(e) => {
                                    e.preventDefault()
                                    const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                                    handleRemoveModel(actualIndex)
                                  }}>删除</button>
                                </div>
                              </summary>
                              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <input
                                  className={inputClass}
                                  placeholder="模型 ID"
                                  value={model.id}
                                  onChange={(e) => {
                                    const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                                    handleUpdateModel(actualIndex, { id: e.target.value })
                                  }}
                                />
                                <input
                                  className={inputClass}
                                  placeholder="模型名称"
                                  value={model.label}
                                  onChange={(e) => {
                                    const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                                    handleUpdateModel(actualIndex, { label: e.target.value })
                                  }}
                                />
                                <UnifiedSelect
                                  value={resolveProviderIdFromModel(model)}
                                  onChange={(e) => {
                                    const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                                    const providerRef = e.target.value || undefined
                                    const provider = (aiDraft?.providers || []).find((item) => String(item.id) === providerRef)
                                    handleUpdateModel(actualIndex, {
                                      providerRef,
                                      providerLabel: provider ? getProviderKey(provider) : undefined
                                    })
                                  }}
                                >
                                  <option value="">未绑定 Provider</option>
                                  {(aiDraft?.providers || []).map((provider, providerIndex) => (
                                    <option key={`${provider.id}-${providerIndex}`} value={String(provider.id)}>
                                      {getProviderKey(provider)}
                                    </option>
                                  ))}
                                </UnifiedSelect>
                              </div>
                              <div className="mt-3">
                                <input
                                  className={inputClass}
                                  placeholder="描述"
                                  value={model.description}
                                  onChange={(e) => {
                                    const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                                    handleUpdateModel(actualIndex, { description: e.target.value })
                                  }}
                                />
                              </div>
                              {selectedProviderSupportsEndpointRouting && (
                                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <UnifiedSelect
                                    value={model.endpointType || 'openai'}
                                    onChange={(e) => {
                                      const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                                      handleUpdateModel(actualIndex, { endpointType: e.target.value as AiEndpointType })
                                    }}
                                  >
                                    {ENDPOINT_TYPE_OPTIONS.map((endpointType) => (
                                      <option key={endpointType} value={endpointType}>
                                        {endpointType}
                                      </option>
                                    ))}
                                  </UnifiedSelect>
                                  <input
                                    className={inputClass}
                                    placeholder="supported endpoint types（逗号分隔，可选）"
                                    value={formatEndpointTypes(model.supportedEndpointTypes)}
                                    onChange={(e) => {
                                      const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                                      handleUpdateModel(actualIndex, { supportedEndpointTypes: parseEndpointTypes(e.target.value) })
                                    }}
                                  />
                                </div>
                              )}

                              <div className="mt-3">
                                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">模型能力</div>
                                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                  默认自动推断，建议不要手动修改，配置错误可能导致模型不可用。
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {MODEL_CAPABILITIES.map((cap) => {
                                    const enabled = getModelCapabilityState(model, cap.type)
                                    const isAuto = isCapabilityAuto(model, cap.type)
                                    return (
                                      <button
                                        key={`${model.id}-${cap.type}`}
                                        className={enabled ? primaryPillClass : pillClass}
                                        onClick={(e) => {
                                          e.preventDefault()
                                          updateModelCapabilities(model.id, cap.type, !enabled)
                                        }}
                                      >
                                        <span>{cap.label}</span>
                                        {isAuto ? <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-200">自动</span> : null}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>

                              <div className="mt-3">
                                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">参数覆盖</div>
                                <div className="mt-2 space-y-4">
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_120px] items-center">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-slate-600 dark:text-slate-300">上下文条数</span>
                                      <span className={tipWrapClass}>
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <circle cx="12" cy="12" r="9" />
                                          <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        <span className={tipBubbleClass}>100 表示不限，普通聊天建议 5–10</span>
                                      </span>
                                    </div>
                                    <SliderWithTicks
                                      value={model.params?.contextWindow ?? selectedProvider?.defaultParams?.contextWindow ?? aiDraft?.defaultParams?.contextWindow ?? DEFAULT_CONTEXT_WINDOW}
                                      min={0}
                                      max={100}
                                      step={1}
                                      ticks={[
                                        { value: 0 },
                                        { value: 5 },
                                        { value: 10 },
                                        { value: 20 },
                                        { value: 50 },
                                        { value: 100, label: '∞' }
                                      ]}
                                      snapToTicks
                                      onChange={(next) => handleUpdateModelParams(model.id, { contextWindow: next })}
                                    />
                                    <input
                                      className={miniInputClass}
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={formatNumber(model.params?.contextWindow)}
                                      onChange={(e) => handleUpdateModelParams(model.id, { contextWindow: parseOptionalNumber(e.target.value) })}
                                    />
                                  </div>

                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-600 dark:text-slate-300">温度</span>
                                        <Switch
                                          checked={model.params?.temperatureEnabled ?? false}
                                          onChange={() => handleToggleModelParam(model.id, 'temperatureEnabled')}
                                        />
                                      </div>
                                      <div className="mt-2 flex flex-col gap-2">
                                        <SliderWithTicks
                                          value={model.params?.temperature ?? DEFAULT_TEMPERATURE}
                                          min={0}
                                          max={2}
                                          step={0.05}
                                          ticks={[
                                            { value: 0 },
                                            { value: 0.5 },
                                            { value: 1 },
                                            { value: 1.5 },
                                            { value: 2 }
                                          ]}
                                          snapToTicks
                                          disabled={!(model.params?.temperatureEnabled ?? false)}
                                          onChange={(next) => handleUpdateModelParams(model.id, { temperature: next })}
                                        />
                                        <input
                                          className={miniInputClass}
                                          type="number"
                                          min="0"
                                          max="2"
                                          step="0.05"
                                          value={formatNumber(model.params?.temperature)}
                                          onChange={(e) => handleUpdateModelParams(model.id, { temperature: parseOptionalNumber(e.target.value) })}
                                          disabled={!(model.params?.temperatureEnabled ?? false)}
                                        />
                                      </div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-600 dark:text-slate-300">Top-P</span>
                                        <Switch
                                          checked={model.params?.topPEnabled ?? false}
                                          onChange={() => handleToggleModelParam(model.id, 'topPEnabled')}
                                        />
                                      </div>
                                      <div className="mt-2 flex flex-col gap-2">
                                        <SliderWithTicks
                                          value={model.params?.topP ?? DEFAULT_TOP_P}
                                          min={0}
                                          max={1}
                                          step={0.05}
                                          ticks={[
                                            { value: 0 },
                                            { value: 0.25 },
                                            { value: 0.5 },
                                            { value: 0.75 },
                                            { value: 1 }
                                          ]}
                                          snapToTicks
                                          disabled={!(model.params?.topPEnabled ?? false)}
                                          onChange={(next) => handleUpdateModelParams(model.id, { topP: next })}
                                        />
                                        <input
                                          className={miniInputClass}
                                          type="number"
                                          min="0"
                                          max="1"
                                          step="0.05"
                                          value={formatNumber(model.params?.topP)}
                                          onChange={(e) => handleUpdateModelParams(model.id, { topP: parseOptionalNumber(e.target.value) })}
                                          disabled={!(model.params?.topPEnabled ?? false)}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_120px] items-center">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-slate-600 dark:text-slate-300">最大输出 tokens</span>
                                      <span className={tipWrapClass}>
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <circle cx="12" cy="12" r="9" />
                                          <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        <span className={tipBubbleClass}>单次最大输出 token，过大可能报错。关闭表示不限制。</span>
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <Switch
                                        checked={model.params?.maxOutputTokensEnabled ?? false}
                                        onChange={() => handleToggleModelMaxTokens(model.id)}
                                      />
                                      <input
                                        className={miniInputClass}
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={formatNumber(model.params?.maxOutputTokens)}
                                        onChange={(e) => handleUpdateModelParams(model.id, { maxOutputTokens: parseOptionalNumber(e.target.value) })}
                                        disabled={!(model.params?.maxOutputTokensEnabled ?? false)}
                                      />
                                    </div>
                                    <div />
                                  </div>
                                </div>
                                <details className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800/80 dark:bg-slate-900/50 dark:text-slate-200">
                                  <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">高级参数</summary>
                                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <input
                                      className={inputClass}
                                      placeholder="Top-K"
                                      value={formatNumber(model.params?.topK)}
                                      onChange={(e) => handleUpdateModelParams(model.id, { topK: parseOptionalNumber(e.target.value) })}
                                    />
                                    <input
                                      className={inputClass}
                                      placeholder="Presence Penalty (-2~2)"
                                      value={formatNumber(model.params?.presencePenalty)}
                                      onChange={(e) => handleUpdateModelParams(model.id, { presencePenalty: parseOptionalNumber(e.target.value) })}
                                    />
                                    <input
                                      className={inputClass}
                                      placeholder="Frequency Penalty (-2~2)"
                                      value={formatNumber(model.params?.frequencyPenalty)}
                                      onChange={(e) => handleUpdateModelParams(model.id, { frequencyPenalty: parseOptionalNumber(e.target.value) })}
                                    />
                                    <input
                                      className={inputClass}
                                      placeholder="Seed"
                                      value={formatNumber(model.params?.seed)}
                                      onChange={(e) => handleUpdateModelParams(model.id, { seed: parseOptionalNumber(e.target.value) })}
                                    />
                                    <textarea
                                      className={`${inputClass} min-h-[72px] sm:col-span-3`}
                                      placeholder="Stop sequences (换行或逗号分隔)"
                                      value={formatStopSequences(model.params?.stopSequences)}
                                      onChange={(e) => handleUpdateModelParams(model.id, { stopSequences: parseStopSequences(e.target.value) })}
                                    />
                                  </div>
                                </details>
                              </div>
                            </details>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showModelModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowModelModal(false)}
        >
          <div
            className="mx-4 w-full max-w-3xl max-h-[80vh] overflow-auto rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">可添加的模型</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {fetchProviderLabel ? `来源：${fetchProviderLabel}` : '选择后点击添加'}
                </div>
              </div>
              <button
                onClick={() => setShowModelModal(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 min-w-[240px]">
                <input
                  className={inputClass}
                  placeholder="搜索模型 ID / 名称"
                  value={fetchSearch}
                  onChange={(e) => setFetchSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <button className={pillClass} onClick={selectAllFetched}>全选</button>
                <button className={pillClass} onClick={invertFetchedSelection}>反全选</button>
              </div>
            </div>

            <div className="space-y-2">
              {filteredFetchedModels.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
                  未找到匹配模型
                </div>
              ) : (
                filteredFetchedModels.map((model) => (
                  <label key={model.id} className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800/80 dark:bg-slate-800/40 dark:text-slate-200">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{model.label}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{model.id}</div>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-slate-900 dark:accent-white"
                      checked={selectedFetchedModelIds.has(model.id)}
                      onChange={() => toggleFetchedModel(model.id)}
                    />
                  </label>
                ))
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button className={pillClass} onClick={() => setShowModelModal(false)}>取消</button>
              <button className={primaryPillClass} onClick={handleAddFetchedModels}>添加所选</button>
            </div>
          </div>
        </div>
      )}

      {showApiKeyManagerModal && selectedProvider && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowApiKeyManagerModal(false)}
        >
          <div
            className="mx-4 w-full max-w-3xl max-h-[80vh] overflow-auto rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">API 密钥管理</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Provider：{getProviderKey(selectedProvider)} · 已配置 {selectedProviderApiKeys.length} 个密钥
                </div>
              </div>
              <button
                onClick={() => setShowApiKeyManagerModal(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr_auto]">
              <UnifiedSelect
                value={apiKeyTestModel}
                onChange={(e) => setApiKeyTestModel(e.target.value)}
                disabled={selectedProviderModelOptions.length === 0}
              >
                {selectedProviderModelOptions.length === 0 ? (
                  <option value="">无可用模型</option>
                ) : (
                  selectedProviderModelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))
                )}
              </UnifiedSelect>
              <input
                className={inputClass}
                placeholder="新增 API Key（支持批量粘贴，逗号或换行分隔）"
                value={newApiKeyInput}
                onChange={(e) => setNewApiKeyInput(e.target.value)}
              />
              <button className={primaryPillClass} onClick={handleAddApiKey}>添加密钥</button>
            </div>
            {selectedProviderModelOptions.length === 0 && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
                当前 Provider 尚未配置模型，无法测试密钥。请先在模型管理中拉取或添加模型。
              </div>
            )}

            <div className="mt-4 space-y-2">
              {selectedProviderApiKeys.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
                  尚未添加 API 密钥
                </div>
              ) : (
                selectedProviderApiKeys.map((key, index) => {
                  const statusKey = `${index}:${key}`
                  const status = apiKeyTestStatusMap[statusKey]
                  const statusClass =
                    status?.state === 'success'
                      ? 'text-emerald-600 dark:text-emerald-300'
                      : status?.state === 'error'
                        ? 'text-rose-600 dark:text-rose-300'
                        : 'text-slate-500 dark:text-slate-400'
                  return (
                    <div
                      key={statusKey}
                      className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-900/50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{key}</div>
                          {status ? (
                            <div className={`mt-1 text-xs ${statusClass}`}>{status.message}</div>
                          ) : (
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">未测试</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className={pillClass}
                            onClick={() => handleTestSingleApiKey(key, index)}
                            disabled={testingApiKeyIndex !== null || selectedProviderModelOptions.length === 0 || !apiKeyTestModel}
                            title={selectedProviderModelOptions.length === 0 ? '请先添加模型' : '测试该密钥可用性'}
                          >
                            {testingApiKeyIndex === index ? '测试中…' : '测试'}
                          </button>
                          <button
                            className={actionButtonClass}
                            onClick={() => handleRemoveApiKey(index)}
                            disabled={testingApiKeyIndex !== null}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {showAddProviderModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowAddProviderModal(false)}
        >
          <div
            className="mx-4 w-full max-w-xl rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">新增 Provider</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">填写 Provider 基本信息</div>
              </div>
              <button
                onClick={() => setShowAddProviderModal(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UnifiedSelect
                value={inferProviderType(newProvider)}
                onChange={(e) => handleNewProviderTypeChange(e.target.value)}
              >
                {PROVIDER_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {PROVIDER_TYPE_LABELS[type] || type}
                  </option>
                ))}
              </UnifiedSelect>
              <input
                className={inputClass}
                placeholder="Provider 实例 ID（可选，留空自动生成）"
                value={newProvider.id || ''}
                onChange={(e) => setNewProvider((prev) => ({ ...prev, id: e.target.value }))}
              />
              <input
                className={inputClass}
                placeholder="显示名称（可选）"
                value={newProvider.label || ''}
                onChange={(e) => setNewProvider((prev) => ({ ...prev, label: e.target.value }))}
              />
              <input
                className={inputClass}
                placeholder="API Key（支持多个，逗号分隔）"
                value={newProvider.apiKey || ''}
                onChange={(e) => setNewProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
              />
              <input
                className={inputClass}
                placeholder="Base URL（可选）"
                value={newProvider.baseURL || ''}
                onChange={(e) => setNewProvider((prev) => ({ ...prev, baseURL: e.target.value }))}
              />
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                默认 Base URL：{newProviderDefaultBaseURL || '无（需手动填写）'}
              </div>
              {supportsProviderEndpointRouting(newProvider) && (
                <>
                  <input
                    className={inputClass}
                    placeholder="Anthropic Base URL（可选）"
                    value={newProvider.anthropicBaseURL || newProviderDefaultAnthropicBaseURL || ''}
                    onChange={(e) => setNewProvider((prev) => ({ ...prev, anthropicBaseURL: e.target.value }))}
                  />
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    默认 Anthropic Base URL：{newProviderDefaultAnthropicBaseURL || '无（将使用 Base URL）'}
                  </div>
                </>
              )}
              {(inferProviderType(newProvider) === 'azure-openai' || inferProviderType(newProvider) === 'azure') && (
                <input
                  className={inputClass}
                  placeholder="API Version（Azure OpenAI）"
                  value={newProvider.apiVersion || ''}
                  onChange={(e) => setNewProvider((prev) => ({ ...prev, apiVersion: e.target.value }))}
                />
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button className={pillClass} onClick={() => setShowAddProviderModal(false)}>取消</button>
              <button className={primaryPillClass} onClick={handleAddProvider}>添加 Provider</button>
            </div>
          </div>
        </div>
      )}

      {showAddModelModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowAddModelModal(false)}
        >
          <div
            className="mx-4 w-full max-w-xl rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">新增模型</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">手动录入模型信息</div>
              </div>
              <button
                onClick={() => setShowAddModelModal(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                className={inputClass}
                placeholder="模型 ID"
                value={newModel.id}
                onChange={(e) => setNewModel((prev) => ({ ...prev, id: e.target.value }))}
              />
              <input
                className={inputClass}
                placeholder="模型名称"
                value={newModel.label}
                onChange={(e) => setNewModel((prev) => ({ ...prev, label: e.target.value }))}
              />
              <UnifiedSelect
                value={String(newModelProviderIndex)}
                onChange={(e) => {
                  const nextIndex = Number(e.target.value)
                  setNewModelProviderIndex(nextIndex)
                  const nextProvider = (aiDraft?.providers || [])[nextIndex]
                  const nextProviderSupportsEndpointRouting = nextProvider ? supportsProviderEndpointRouting(nextProvider) : false
                  setNewModel((prev) => ({
                    ...prev,
                    endpointType: nextProviderSupportsEndpointRouting ? (prev.endpointType || 'openai') : undefined,
                    supportedEndpointTypes: nextProviderSupportsEndpointRouting ? prev.supportedEndpointTypes : undefined
                  }))
                }}
                disabled={!aiDraft || aiDraft.providers.length === 0}
              >
                {(aiDraft?.providers || []).length === 0 ? (
                  <option value="0">暂无 Provider</option>
                ) : (
                  (aiDraft?.providers || []).map((provider, index) => (
                    <option key={`${provider.id}-${index}`} value={String(index)}>
                      {getProviderKey(provider)}
                    </option>
                  ))
                )}
              </UnifiedSelect>
              <input
                className={inputClass}
                placeholder="描述"
                value={newModel.description}
                onChange={(e) => setNewModel((prev) => ({ ...prev, description: e.target.value }))}
              />
              {newModelNeedsEndpointType && (
                <>
                  <UnifiedSelect
                    value={newModel.endpointType || 'openai'}
                    onChange={(e) => setNewModel((prev) => ({ ...prev, endpointType: e.target.value as AiEndpointType }))}
                  >
                    {ENDPOINT_TYPE_OPTIONS.map((endpointType) => (
                      <option key={endpointType} value={endpointType}>
                        {endpointType}
                      </option>
                    ))}
                  </UnifiedSelect>
                  <input
                    className={inputClass}
                    placeholder="supported endpoint types（逗号分隔，可选）"
                    value={formatEndpointTypes(newModel.supportedEndpointTypes)}
                    onChange={(e) => setNewModel((prev) => ({ ...prev, supportedEndpointTypes: parseEndpointTypes(e.target.value) }))}
                  />
                </>
              )}
            </div>

            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">模型能力</div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                默认自动推断，建议不要手动修改，配置错误可能导致模型不可用。
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {MODEL_CAPABILITIES.map((cap) => {
                  const enabled = getModelCapabilityState(newModel, cap.type)
                  const isAuto = isCapabilityAuto(newModel, cap.type)
                  return (
                    <button
                      key={`new-${cap.type}`}
                      className={enabled ? primaryPillClass : pillClass}
                      onClick={() => updateNewModelCapability(cap.type, !enabled)}
                    >
                      <span>{cap.label}</span>
                      {isAuto ? <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-200">自动</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button className={pillClass} onClick={() => setShowAddModelModal(false)}>取消</button>
              <button className={primaryPillClass} onClick={handleAddModel}>添加模型</button>
            </div>
          </div>
        </div>
      )}

      {showDefaultParamsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowDefaultParamsModal(false)}
        >
          <div
            className="mx-4 w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">默认参数</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">配置全局默认的 AI 模型参数</div>
              </div>
              <button
                onClick={() => setShowDefaultParamsModal(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">空值表示继承模型或供应商参数</div>
              <span className={tipWrapClass}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={tipBubbleClass}>token 为估算值，仅供参考</span>
              </span>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_120px] items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 dark:text-slate-300">上下文条数</span>
                  <span className={tipWrapClass}>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className={tipBubbleClass}>保留最近的消息条数，100 表示不限，普通聊天建议 5–10</span>
                  </span>
                </div>
                <SliderWithTicks
                  value={aiDraft?.defaultParams?.contextWindow ?? DEFAULT_CONTEXT_WINDOW}
                  min={0}
                  max={100}
                  step={1}
                  ticks={[
                    { value: 0 },
                    { value: 5 },
                    { value: 10 },
                    { value: 20 },
                    { value: 50 },
                    { value: 100, label: '∞' }
                  ]}
                  snapToTicks
                  onChange={(next) => handleUpdateDefaultParams({ contextWindow: next })}
                />
                <input
                  className={miniInputClass}
                  type="number"
                  min="0"
                  step="1"
                  value={formatNumber(aiDraft?.defaultParams?.contextWindow)}
                  onChange={(e) => handleUpdateDefaultParams({ contextWindow: parseOptionalNumber(e.target.value) })}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600 dark:text-slate-300">温度</span>
                    <Switch
                      checked={aiDraft?.defaultParams?.temperatureEnabled ?? false}
                      onChange={() => handleToggleDefaultParam('temperatureEnabled')}
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    <SliderWithTicks
                      value={aiDraft?.defaultParams?.temperature ?? DEFAULT_TEMPERATURE}
                      min={0}
                      max={2}
                      step={0.05}
                      ticks={[
                        { value: 0 },
                        { value: 0.5 },
                        { value: 1 },
                        { value: 1.5 },
                        { value: 2 }
                      ]}
                      snapToTicks
                      disabled={!(aiDraft?.defaultParams?.temperatureEnabled ?? false)}
                      onChange={(next) => handleUpdateDefaultParams({ temperature: next })}
                    />
                    <input
                      className={miniInputClass}
                      type="number"
                      min="0"
                      max="2"
                      step="0.05"
                      value={formatNumber(aiDraft?.defaultParams?.temperature)}
                      onChange={(e) => handleUpdateDefaultParams({ temperature: parseOptionalNumber(e.target.value) })}
                      disabled={!(aiDraft?.defaultParams?.temperatureEnabled ?? false)}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600 dark:text-slate-300">Top-P</span>
                    <Switch
                      checked={aiDraft?.defaultParams?.topPEnabled ?? false}
                      onChange={() => handleToggleDefaultParam('topPEnabled')}
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    <SliderWithTicks
                      value={aiDraft?.defaultParams?.topP ?? DEFAULT_TOP_P}
                      min={0}
                      max={1}
                      step={0.05}
                      ticks={[
                        { value: 0 },
                        { value: 0.25 },
                        { value: 0.5 },
                        { value: 0.75 },
                        { value: 1 }
                      ]}
                      snapToTicks
                      disabled={!(aiDraft?.defaultParams?.topPEnabled ?? false)}
                      onChange={(next) => handleUpdateDefaultParams({ topP: next })}
                    />
                    <input
                      className={miniInputClass}
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={formatNumber(aiDraft?.defaultParams?.topP)}
                      onChange={(e) => handleUpdateDefaultParams({ topP: parseOptionalNumber(e.target.value) })}
                      disabled={!(aiDraft?.defaultParams?.topPEnabled ?? false)}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_120px] items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 dark:text-slate-300">最大输出 tokens</span>
                  <span className={tipWrapClass}>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className={tipBubbleClass}>单次最大输出 token，过大可能报错。关闭表示不限制。</span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={aiDraft?.defaultParams?.maxOutputTokensEnabled ?? false}
                    onChange={handleToggleDefaultMaxTokens}
                  />
                  <input
                    className={miniInputClass}
                    type="number"
                    min="1"
                    step="1"
                    value={formatNumber(aiDraft?.defaultParams?.maxOutputTokens)}
                    onChange={(e) => handleUpdateDefaultParams({ maxOutputTokens: parseOptionalNumber(e.target.value) })}
                    disabled={!(aiDraft?.defaultParams?.maxOutputTokensEnabled ?? false)}
                  />
                </div>
                <div />
              </div>
            </div>

            <details className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800/80 dark:bg-slate-900/50 dark:text-slate-200">
              <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">高级参数</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  className={inputClass}
                  placeholder="Top-K"
                  value={formatNumber(aiDraft?.defaultParams?.topK)}
                  onChange={(e) => handleUpdateDefaultParams({ topK: parseOptionalNumber(e.target.value) })}
                />
                <input
                  className={inputClass}
                  placeholder="Presence Penalty (-2~2)"
                  value={formatNumber(aiDraft?.defaultParams?.presencePenalty)}
                  onChange={(e) => handleUpdateDefaultParams({ presencePenalty: parseOptionalNumber(e.target.value) })}
                />
                <input
                  className={inputClass}
                  placeholder="Frequency Penalty (-2~2)"
                  value={formatNumber(aiDraft?.defaultParams?.frequencyPenalty)}
                  onChange={(e) => handleUpdateDefaultParams({ frequencyPenalty: parseOptionalNumber(e.target.value) })}
                />
                <input
                  className={inputClass}
                  placeholder="Seed"
                  value={formatNumber(aiDraft?.defaultParams?.seed)}
                  onChange={(e) => handleUpdateDefaultParams({ seed: parseOptionalNumber(e.target.value) })}
                />
                <textarea
                  className={`${inputClass} min-h-[84px] sm:col-span-2`}
                  placeholder="Stop sequences (换行或逗号分隔)"
                  value={formatStopSequences(aiDraft?.defaultParams?.stopSequences)}
                  onChange={(e) => handleUpdateDefaultParams({ stopSequences: parseStopSequences(e.target.value) })}
                />
              </div>
            </details>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button className={pillClass} onClick={() => setShowDefaultParamsModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
