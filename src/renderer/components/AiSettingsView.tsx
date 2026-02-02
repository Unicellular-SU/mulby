import { useEffect, useState } from 'react'
import type { AiModel, AiProviderConfig, AiSettings } from '../../shared/types/ai'

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
  const [fetchProviderId, setFetchProviderId] = useState<string | null>(null)
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
    description: '',
    cost: 1
  })

  const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white p-6 dark:border-slate-800/80 dark:bg-slate-900'
  const cardClassTight = 'rounded-[24px] border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900'
  const pillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white'
  const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const selectClass = 'w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-2 pr-10 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'

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

  const handleAddProvider = () => {
    if (!aiDraft) return
    if (!newProvider.id) {
      setAiError('请填写提供商 ID')
      return
    }
    const providers = [...aiDraft.providers, { ...newProvider }]
    updateAiDraft({ providers })
    setNewProvider({ id: 'openai', label: '', enabled: true, apiKey: '', baseURL: '' })
  }

  const handleRemoveProvider = (index: number) => {
    if (!aiDraft) return
    const providers = aiDraft.providers.filter((_, i) => i !== index)
    updateAiDraft({ providers })
  }

  const handleUpdateProvider = (index: number, patch: Partial<AiProviderConfig>) => {
    if (!aiDraft) return
    const providers = aiDraft.providers.map((provider, i) => (i === index ? { ...provider, ...patch } : provider))
    updateAiDraft({ providers })
  }

  const handleAddModel = () => {
    if (!aiDraft) return
    if (!newModel.id || !newModel.label) {
      setAiError('请填写模型 ID 与名称')
      return
    }
    const models = [...(aiDraft.models || []), { ...newModel }]
    updateAiDraft({ models })
    setNewModel({ id: '', label: '', description: '', cost: 1 })
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

  const handleTestConnection = async () => {
    setAiInfo(null)
    setAiError(null)
    if (!window.intools?.ai?.testConnection) {
      setAiError('AI 接口未就绪，请重启应用')
      return
    }
    try {
      setIsTestingConnection(true)
      const fallbackModel = aiDraft?.defaultModel || aiDraft?.models?.[0]?.id
      const result = await window.intools.ai.testConnection({ model: fallbackModel })
      if (result.success) {
        setAiInfo(`连接成功：${result.message || 'ok'}`)
      } else {
        setAiError(result.message || '连接失败')
      }
    } finally {
      setIsTestingConnection(false)
    }
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
      setFetchProviderId(String(provider.id))
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

      setFetchedModels(result.models)
      setSelectedFetchedModelIds(new Set(result.models.map((model) => model.id)))
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

  const handleAddFetchedModels = () => {
    if (!aiDraft) return
    const existing = new Set((aiDraft.models || []).map((model) => model.id))
    const toAdd = fetchedModels.filter((model) => selectedFetchedModelIds.has(model.id) && !existing.has(model.id))
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
          <button className={`${pillClass} no-drag`} onClick={handleResetAiSettings}>恢复</button>
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

          <div className={`${cardClass} grid grid-cols-1 gap-4 sm:grid-cols-3`}>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">默认模型</div>
              <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{aiDraft?.defaultModel || '未设置'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Providers</div>
              <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{aiDraft?.providers.length ?? 0}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">模型数量</div>
              <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{aiDraft?.models?.length ?? 0}</div>
            </div>
          </div>

          <div className={`${cardClass} space-y-4`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-900 dark:text-white">Provider 配置</div>
              <span className="text-xs text-slate-500 dark:text-slate-400">支持 OpenAI / Anthropic / Google / Custom</span>
            </div>

            <div className="space-y-3">
              {(aiDraft?.providers || []).map((provider, index) => (
                <div key={`${provider.id}-${index}`} className={`${cardClassTight} space-y-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[160px]">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{provider.label || provider.id}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{provider.id}</div>
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
                            const providerPrefix = `${provider.id}:`
                            const providerModel = aiDraft?.models?.find((item) => item.id.startsWith(providerPrefix))?.id
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
                                providerId: String(provider.id),
                                apiKey: provider.apiKey,
                                baseURL: provider.baseURL
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
                                providerId: String(provider.id),
                                apiKey: provider.apiKey,
                                baseURL: provider.baseURL
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
                        className={`${primaryPillClass} no-drag`}
                        onClick={() => handleFetchModels(provider)}
                        disabled={isFetchingModels}
                      >
                        {isFetchingModels ? '拉取中…' : '拉取模型'}
                      </button>
                      <button
                        className={provider.enabled ? primaryPillClass : pillClass}
                        onClick={() => handleUpdateProvider(index, { enabled: !provider.enabled })}
                      >
                        {provider.enabled ? '已启用' : '已停用'}
                      </button>
                      <button className={actionButtonClass} onClick={() => handleRemoveProvider(index)}>删除</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      className={inputClass}
                      placeholder="显示名称（可选）"
                      value={provider.label || ''}
                      onChange={(e) => handleUpdateProvider(index, { label: e.target.value })}
                    />
                    <input
                      className={inputClass}
                      placeholder="Provider ID（如 openai）"
                      value={provider.id}
                      onChange={(e) => handleUpdateProvider(index, { id: e.target.value })}
                    />
                    <input
                      className={inputClass}
                      placeholder="API Key"
                      value={provider.apiKey || ''}
                      onChange={(e) => handleUpdateProvider(index, { apiKey: e.target.value })}
                    />
                    <input
                      className={inputClass}
                      placeholder="Base URL（可选）"
                      value={provider.baseURL || ''}
                      onChange={(e) => handleUpdateProvider(index, { baseURL: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
              <div className="text-sm font-medium text-slate-900 dark:text-white">新增 Provider</div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="mt-3 flex items-center gap-2">
                <button className={primaryPillClass} onClick={handleAddProvider}>添加 Provider</button>
              </div>
            </div>
          </div>

          <div className={`${cardClass} space-y-4`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-900 dark:text-white">模型列表</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">模型 ID 建议使用 provider:model 格式</div>
            </div>

            <div className="space-y-3">
              {(aiDraft?.models || []).map((model, index) => (
                <div key={`${model.id}-${index}`} className={`${cardClassTight} space-y-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[180px]">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{model.label}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{model.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className={aiDraft?.defaultModel === model.id ? primaryPillClass : pillClass}
                        onClick={() => updateAiDraft({ defaultModel: model.id })}
                      >
                        {aiDraft?.defaultModel === model.id ? '默认模型' : '设为默认'}
                      </button>
                      <button className={actionButtonClass} onClick={() => handleRemoveModel(index)}>删除</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      className={inputClass}
                      placeholder="模型 ID"
                      value={model.id}
                      onChange={(e) => handleUpdateModel(index, { id: e.target.value })}
                    />
                    <input
                      className={inputClass}
                      placeholder="模型名称"
                      value={model.label}
                      onChange={(e) => handleUpdateModel(index, { label: e.target.value })}
                    />
                    <input
                      className={inputClass}
                      placeholder="描述"
                      value={model.description}
                      onChange={(e) => handleUpdateModel(index, { description: e.target.value })}
                    />
                    <input
                      className={inputClass}
                      placeholder="成本系数（例如 1）"
                      type="number"
                      min="0"
                      step="0.1"
                      value={model.cost}
                      onChange={(e) => handleUpdateModel(index, { cost: Number(e.target.value) })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
              <div className="text-sm font-medium text-slate-900 dark:text-white">新增模型</div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <input
                  className={inputClass}
                  placeholder="描述"
                  value={newModel.description}
                  onChange={(e) => setNewModel((prev) => ({ ...prev, description: e.target.value }))}
                />
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="成本系数"
                  value={newModel.cost}
                  onChange={(e) => setNewModel((prev) => ({ ...prev, cost: Number(e.target.value) }))}
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button className={primaryPillClass} onClick={handleAddModel}>添加模型</button>
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
                  {fetchProviderId ? `来源：${fetchProviderId}` : '选择后点击添加'}
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

            <div className="space-y-2">
              {fetchedModels.map((model) => (
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
              ))}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button className={pillClass} onClick={() => setShowModelModal(false)}>取消</button>
              <button className={primaryPillClass} onClick={handleAddFetchedModels}>添加所选</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
