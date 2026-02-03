import { useEffect, useState } from 'react'
import type { AiModel, AiModelParameters, AiProviderConfig, AiSettings } from '../../shared/types/ai'
import SliderWithTicks from './SliderWithTicks'

interface AiSettingsViewProps {
  onBack: () => void
}

export default function AiSettingsView({ onBack }: AiSettingsViewProps) {
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [aiDraft, setAiDraft] = useState<AiSettings | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiInfo, setAiInfo] = useState<string | null>(null)
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
  const [newModelProviderIndex, setNewModelProviderIndex] = useState<number>(0)
  const [selectedProviderIndex, setSelectedProviderIndex] = useState<number>(0)
  const [newProvider, setNewProvider] = useState<AiProviderConfig>({
    id: 'openai',
    label: '',
    enabled: true,
    apiKey: '',
    baseURL: ''
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
  const selectClass = 'w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-2 pr-10 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'

  const toggleButtonClass = 'flex h-5 w-9 items-center rounded-full border border-slate-200 bg-white px-0.5 transition dark:border-slate-700 dark:bg-slate-950'
  const toggleButtonOnClass = 'bg-slate-900 border-slate-900 dark:bg-white dark:border-white'
  const toggleDotClass = 'h-4 w-4 rounded-full bg-slate-400 shadow transition'
  const toggleDotOnClass = 'translate-x-4 bg-white'
  const miniInputClass = 'w-24 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const tipWrapClass = 'relative inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 group'
  const tipBubbleClass = 'pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 opacity-0 shadow-lg transition group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
  const DEFAULT_TEMPERATURE = 0.7
  const DEFAULT_TOP_P = 1
  const DEFAULT_CONTEXT_WINDOW = 8

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

  const getProviderKey = (provider: AiProviderConfig) => {
    const label = (provider.label || '').trim()
    return label ? label : String(provider.id)
  }

  const modelBelongsToProvider = (model: AiModel, provider: AiProviderConfig) => {
    const providerKey = getProviderKey(provider)
    if (model.providerLabel) return model.providerLabel === providerKey
    return model.id.startsWith(`${provider.id}:`)
  }

  const selectedProvider = (aiDraft?.providers || [])[selectedProviderIndex] || null
  const filteredModels = (aiDraft?.models || []).filter((model) => {
    if (!selectedProvider) return false
    return modelBelongsToProvider(model, selectedProvider)
  })

  useEffect(() => {
    if (window.intools?.ai?.settings?.get) {
      window.intools.ai.settings.get()
        .then((next) => {
          setAiSettings(next)
          setAiDraft(next)
        })
        .catch((err) => {
          console.error('Failed to load AI settings:', err)
          setAiError('AI 设置加载失败')
        })
    } else {
      setAiError('AI 接口未就绪，请重启应用')
    }
  }, [])

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

  const handleAddProvider = () => {
    if (!aiDraft) return
    if (!newProvider.id) {
      setAiError('请填写提供商 ID')
      return
    }
    const providers = [...aiDraft.providers, { ...newProvider }]
    updateAiDraft({ providers })
    setNewProvider({ id: 'openai', label: '', enabled: true, apiKey: '', baseURL: '' })
    setShowAddProviderModal(false)
  }

  const handleRemoveProvider = (index: number) => {
    if (!aiDraft) return
    const providers = aiDraft.providers.filter((_, i) => i !== index)
    updateAiDraft({ providers })
  }

  const handleUpdateProvider = (index: number, patch: Partial<AiProviderConfig>) => {
    if (!aiDraft) return
    setAiDraft((prev) => {
      if (!prev) return prev
      const currentProvider = prev.providers[index]
      if (!currentProvider) return prev
      const nextProvider = { ...currentProvider, ...patch }
      const providers = prev.providers.map((provider, i) => (i === index ? nextProvider : provider))
      let models = prev.models
      const beforeKey = getProviderKey(currentProvider)
      const afterKey = getProviderKey(nextProvider)
      if (beforeKey !== afterKey && prev.models && prev.models.length > 0) {
        models = prev.models.map((model) => (model.providerLabel === beforeKey ? { ...model, providerLabel: afterKey } : model))
      }
      return {
        ...prev,
        providers,
        models
      }
    })
  }

  const handleAddModel = () => {
    if (!aiDraft) return
    if (!newModel.id || !newModel.label) {
      setAiError('请填写模型 ID 与名称')
      return
    }
    const provider = aiDraft.providers[newModelProviderIndex]
    const providerLabel = provider ? getProviderKey(provider) : undefined
    const models = [...(aiDraft.models || []), { ...newModel, providerLabel }]
    updateAiDraft({ models })
    setNewModel({ id: '', label: '', description: '' })
    setNewModelProviderIndex(0)
    setShowAddModelModal(false)
  }

  const openAddModelModal = () => {
    if (!aiDraft || aiDraft.providers.length === 0) {
      setNewModelProviderIndex(0)
      setShowAddModelModal(true)
      return
    }
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

      setFetchedModels(result.models.map((model) => ({
        ...model,
        providerLabel: getProviderKey(provider)
      })))
      setSelectedFetchedModelIds(new Set())
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
    const modelKey = (model: AiModel) => `${model.id}::${model.providerLabel || ''}`
    const existing = new Set((aiDraft.models || []).map((model) => modelKey(model)))
    const toAdd = fetchedModels.filter((model) => selectedFetchedModelIds.has(model.id) && !existing.has(modelKey(model)))
    if (toAdd.length === 0) {
      setAiInfo('没有可新增的模型')
      setShowModelModal(false)
      return
    }
    updateAiDraft({ models: [...(aiDraft.models || []), ...toAdd] })
    setAiInfo(`已添加 ${toAdd.length} 个模型`)
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
          <button className={`${pillClass} no-drag`} onClick={handleResetAiSettings} title="恢复到上次保存的配置">恢复</button>
          <button className={`${primaryPillClass} no-drag`} onClick={handleSaveAiSettings}>保存</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-drag">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-8 space-y-4">
          {aiError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
              {aiError}
            </div>
          )}
          {aiInfo && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
              {aiInfo}
            </div>
          )}
          {aiReasoning && (
            <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-xs text-slate-600 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-300">
              <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">思考过程</div>
              <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{aiReasoning}</div>
            </div>
          )}

          <details className={`${cardClass} space-y-4`} open={false}>
            <summary className="flex cursor-pointer items-center justify-between text-sm font-medium text-slate-900 dark:text-white">
              <span>默认参数</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">点击展开</span>
            </summary>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">空值表示继承模型或供应商参数</div>
              <span className={tipWrapClass}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={tipBubbleClass}>token 为估算值，仅供参考</span>
              </span>
            </div>

            <div className="mt-3 space-y-4">
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
                    <button
                      type="button"
                      className={`${toggleButtonClass} ${aiDraft?.defaultParams?.temperatureEnabled ? toggleButtonOnClass : ''}`}
                      onClick={() => handleToggleDefaultParam('temperatureEnabled')}
                      aria-pressed={aiDraft?.defaultParams?.temperatureEnabled ?? false}
                    >
                      <span className={`${toggleDotClass} ${aiDraft?.defaultParams?.temperatureEnabled ? toggleDotOnClass : ''}`} />
                    </button>
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
                    <button
                      type="button"
                      className={`${toggleButtonClass} ${aiDraft?.defaultParams?.topPEnabled ? toggleButtonOnClass : ''}`}
                      onClick={() => handleToggleDefaultParam('topPEnabled')}
                      aria-pressed={aiDraft?.defaultParams?.topPEnabled ?? false}
                    >
                      <span className={`${toggleDotClass} ${aiDraft?.defaultParams?.topPEnabled ? toggleDotOnClass : ''}`} />
                    </button>
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
                  <button
                    type="button"
                    className={`${toggleButtonClass} ${aiDraft?.defaultParams?.maxOutputTokensEnabled ? toggleButtonOnClass : ''}`}
                    onClick={handleToggleDefaultMaxTokens}
                    aria-pressed={aiDraft?.defaultParams?.maxOutputTokensEnabled ?? false}
                  >
                    <span className={`${toggleDotClass} ${aiDraft?.defaultParams?.maxOutputTokensEnabled ? toggleDotOnClass : ''}`} />
                  </button>
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

            <details className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800/80 dark:bg-slate-900/50 dark:text-slate-200">
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

          </details>

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
                  (aiDraft?.providers || []).map((provider, index) => (
                    <button
                      key={`${provider.id}-${index}`}
                      className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left text-sm transition ${index === selectedProviderIndex ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'}`}
                      onClick={() => setSelectedProviderIndex(index)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{getProviderKey(provider)}</div>
                        <div className={`truncate text-xs ${index === selectedProviderIndex ? 'text-white/70 dark:text-slate-600' : 'text-slate-400 dark:text-slate-500'}`}>{provider.id}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${provider.enabled ? (index === selectedProviderIndex ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200') : (index === selectedProviderIndex ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300')}`}>
                        {provider.enabled ? '启用' : '停用'}
                      </span>
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
                        <div className="text-xs text-slate-500 dark:text-slate-400">{selectedProvider.id}</div>
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
                              let streamed = ''
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
                                  streamed += chunk.text
                                  setAiInfo(streamed)
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
                          disabled={isTestingConnection}
                        >
                          {isTestingConnection ? '测试中…' : '测试连接'}
                        </button>
                        <button
                          className={selectedProvider.enabled ? primaryPillClass : pillClass}
                          onClick={() => handleUpdateProvider(selectedProviderIndex, { enabled: !selectedProvider.enabled })}
                        >
                          {selectedProvider.enabled ? '已启用' : '已停用'}
                        </button>
                        <button className={actionButtonClass} onClick={() => handleRemoveProvider(selectedProviderIndex)}>删除</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        className={inputClass}
                        placeholder="显示名称（可选）"
                        value={selectedProvider.label || ''}
                        onChange={(e) => handleUpdateProvider(selectedProviderIndex, { label: e.target.value })}
                      />
                      <input
                        className={inputClass}
                        placeholder="Provider ID（如 openai）"
                        value={selectedProvider.id}
                        onChange={(e) => handleUpdateProvider(selectedProviderIndex, { id: e.target.value })}
                      />
                      <input
                        className={inputClass}
                        placeholder="API Key"
                        value={selectedProvider.apiKey || ''}
                        onChange={(e) => handleUpdateProvider(selectedProviderIndex, { apiKey: e.target.value })}
                      />
                      <input
                        className={inputClass}
                        placeholder="Base URL（可选）"
                        value={selectedProvider.baseURL || ''}
                        onChange={(e) => handleUpdateProvider(selectedProviderIndex, { baseURL: e.target.value })}
                      />
                    </div>

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
                              <button
                                type="button"
                                className={`${toggleButtonClass} ${selectedProvider.defaultParams?.temperatureEnabled ? toggleButtonOnClass : ''}`}
                                onClick={() => handleToggleProviderParam(selectedProviderIndex, 'temperatureEnabled')}
                                aria-pressed={selectedProvider.defaultParams?.temperatureEnabled ?? false}
                              >
                                <span className={`${toggleDotClass} ${selectedProvider.defaultParams?.temperatureEnabled ? toggleDotOnClass : ''}`} />
                              </button>
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
                              <button
                                type="button"
                                className={`${toggleButtonClass} ${selectedProvider.defaultParams?.topPEnabled ? toggleButtonOnClass : ''}`}
                                onClick={() => handleToggleProviderParam(selectedProviderIndex, 'topPEnabled')}
                                aria-pressed={selectedProvider.defaultParams?.topPEnabled ?? false}
                              >
                                <span className={`${toggleDotClass} ${selectedProvider.defaultParams?.topPEnabled ? toggleDotOnClass : ''}`} />
                              </button>
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
                            <button
                              type="button"
                              className={`${toggleButtonClass} ${selectedProvider.defaultParams?.maxOutputTokensEnabled ? toggleButtonOnClass : ''}`}
                              onClick={() => handleToggleProviderMaxTokens(selectedProviderIndex)}
                              aria-pressed={selectedProvider.defaultParams?.maxOutputTokensEnabled ?? false}
                            >
                              <span className={`${toggleDotClass} ${selectedProvider.defaultParams?.maxOutputTokensEnabled ? toggleDotOnClass : ''}`} />
                            </button>
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
                            disabled={isFetchingModels}
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
                                <div className="relative">
                                  <select
                                    className={selectClass}
                                    value={model.providerLabel || ''}
                                    onChange={(e) => {
                                      const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                                      handleUpdateModel(actualIndex, { providerLabel: e.target.value || undefined })
                                    }}
                                  >
                                    <option value="">未绑定 Provider</option>
                                    {(aiDraft?.providers || []).map((provider, providerIndex) => (
                                      <option key={`${provider.id}-${providerIndex}`} value={getProviderKey(provider)}>
                                        {getProviderKey(provider)}
                                      </option>
                                    ))}
                                  </select>
                                  <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </div>
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
                                        <button
                                          type="button"
                                          className={`${toggleButtonClass} ${model.params?.temperatureEnabled ? toggleButtonOnClass : ''}`}
                                          onClick={() => handleToggleModelParam(model.id, 'temperatureEnabled')}
                                          aria-pressed={model.params?.temperatureEnabled ?? false}
                                        >
                                          <span className={`${toggleDotClass} ${model.params?.temperatureEnabled ? toggleDotOnClass : ''}`} />
                                        </button>
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
                                        <button
                                          type="button"
                                          className={`${toggleButtonClass} ${model.params?.topPEnabled ? toggleButtonOnClass : ''}`}
                                          onClick={() => handleToggleModelParam(model.id, 'topPEnabled')}
                                          aria-pressed={model.params?.topPEnabled ?? false}
                                        >
                                          <span className={`${toggleDotClass} ${model.params?.topPEnabled ? toggleDotOnClass : ''}`} />
                                        </button>
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
                                      <button
                                        type="button"
                                        className={`${toggleButtonClass} ${model.params?.maxOutputTokensEnabled ? toggleButtonOnClass : ''}`}
                                        onClick={() => handleToggleModelMaxTokens(model.id)}
                                        aria-pressed={model.params?.maxOutputTokensEnabled ?? false}
                                      >
                                        <span className={`${toggleDotClass} ${model.params?.maxOutputTokensEnabled ? toggleDotOnClass : ''}`} />
                                      </button>
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
              <div className="relative">
                <select
                  className={selectClass}
                  value={newProvider.id}
                  onChange={(e) => setNewProvider((prev) => ({ ...prev, id: e.target.value }))}
                >
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                  <option value="google">google</option>
                  <option value="custom">custom</option>
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <input
                className={inputClass}
                placeholder="显示名称（可选）"
                value={newProvider.label || ''}
                onChange={(e) => setNewProvider((prev) => ({ ...prev, label: e.target.value }))}
              />
              <input
                className={inputClass}
                placeholder="API Key"
                value={newProvider.apiKey || ''}
                onChange={(e) => setNewProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
              />
              <input
                className={inputClass}
                placeholder="Base URL（可选）"
                value={newProvider.baseURL || ''}
                onChange={(e) => setNewProvider((prev) => ({ ...prev, baseURL: e.target.value }))}
              />
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
              <div className="relative">
                <select
                  className={selectClass}
                  value={String(newModelProviderIndex)}
                  onChange={(e) => setNewModelProviderIndex(Number(e.target.value))}
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
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <input
                className={inputClass}
                placeholder="描述"
                value={newModel.description}
                onChange={(e) => setNewModel((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button className={pillClass} onClick={() => setShowAddModelModal(false)}>取消</button>
              <button className={primaryPillClass} onClick={handleAddModel}>添加模型</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
