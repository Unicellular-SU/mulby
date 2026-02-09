import type {
  AiEndpointType,
  AiModel,
  AiModelParameters,
  AiModelType,
  AiProviderConfig,
  AiSettings
} from '../../../shared/types/ai'
import type { ProviderValidationResult } from '../../../shared/ai/providerValidation'
import SliderWithTicks from '../SliderWithTicks'
import UnifiedSelect from '../UnifiedSelect'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  ENDPOINT_TYPE_OPTIONS,
  MODEL_CAPABILITIES,
  PROVIDER_TYPE_LABELS,
  Switch,
  classNames,
  formatEndpointTypes,
  formatNumber,
  formatStopSequences,
  getProviderTypeOptions,
  parseEndpointTypes,
  parseOptionalNumber,
  parseStopSequences,
  type ProviderListEntry
} from './shared'

interface ProviderSettingsSectionProps {
  aiDraft: AiSettings | null
  sortedProviderEntries: ProviderListEntry[]
  selectedProvider: AiProviderConfig | null
  selectedProviderIndex: number
  selectedProviderValidation: ProviderValidationResult
  selectedProviderIsSystemDefault: boolean
  selectedProviderType: string
  selectedProviderSupportsEndpointRouting: boolean
  selectedProviderDefaultBaseURL?: string
  selectedProviderDefaultAnthropicBaseURL?: string
  filteredModels: AiModel[]
  isTestingConnection: boolean
  isFetchingModels: boolean
  setSelectedProviderIndex: (index: number) => void
  onOpenAddProviderModal: () => void
  onTestConnection: () => void
  onUpdateSelectedProvider: (patch: Partial<AiProviderConfig>) => void
  onRemoveSelectedProvider: () => void
  onSelectedProviderTypeChange: (nextType: string) => void
  openApiKeyManager: () => void
  onUpdateSelectedProviderParams: (patch: Partial<AiModelParameters>) => void
  onToggleSelectedProviderParam: (key: 'temperatureEnabled' | 'topPEnabled') => void
  onToggleSelectedProviderMaxTokens: () => void
  onFetchModelsForSelectedProvider: () => void
  openAddModelModal: () => void
  handleRemoveModel: (index: number) => void
  handleUpdateModel: (index: number, patch: Partial<AiModel>) => void
  resolveProviderIdFromModel: (model: AiModel) => string
  getProviderKey: (provider: AiProviderConfig) => string
  getProviderTypeLabel: (provider: AiProviderConfig) => string
  getModelCapabilityState: (model: AiModel, type: AiModelType) => boolean
  isCapabilityAuto: (model: AiModel, type: AiModelType) => boolean
  updateModelCapabilities: (modelId: string, type: AiModelType, enabled: boolean) => void
  handleUpdateModelParams: (modelId: string, patch: Partial<AiModelParameters>) => void
  onToggleModelParam: (modelId: string, key: 'temperatureEnabled' | 'topPEnabled') => void
  onToggleModelMaxTokens: (modelId: string) => void
}

export function ProviderSettingsSection({
  aiDraft,
  sortedProviderEntries,
  selectedProvider,
  selectedProviderIndex,
  selectedProviderValidation,
  selectedProviderIsSystemDefault,
  selectedProviderType,
  selectedProviderSupportsEndpointRouting,
  selectedProviderDefaultBaseURL,
  selectedProviderDefaultAnthropicBaseURL,
  filteredModels,
  isTestingConnection,
  isFetchingModels,
  setSelectedProviderIndex,
  onOpenAddProviderModal,
  onTestConnection,
  onUpdateSelectedProvider,
  onRemoveSelectedProvider,
  onSelectedProviderTypeChange,
  openApiKeyManager,
  onUpdateSelectedProviderParams,
  onToggleSelectedProviderParam,
  onToggleSelectedProviderMaxTokens,
  onFetchModelsForSelectedProvider,
  openAddModelModal,
  handleRemoveModel,
  handleUpdateModel,
  resolveProviderIdFromModel,
  getProviderKey,
  getProviderTypeLabel,
  getModelCapabilityState,
  isCapabilityAuto,
  updateModelCapabilities,
  handleUpdateModelParams,
  onToggleModelParam,
  onToggleModelMaxTokens
}: ProviderSettingsSectionProps) {
  const {
    cardClass,
    cardClassTight,
    pillClass,
    primaryPillClass,
    actionButtonClass,
    inputClass,
    miniInputClass,
    tipWrapClass,
    tipBubbleClass
  } = classNames

  return (
<div className={`${cardClass} space-y-4`}>
  <div className="flex items-center justify-between gap-2">
    <div className="text-sm font-medium text-slate-900 dark:text-white">供应商配置</div>
    <div className="flex items-center gap-2">
      <button className={`${primaryPillClass} no-drag`} onClick={() => onOpenAddProviderModal()}>
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
                onClick={onTestConnection}
                disabled={isTestingConnection || !selectedProviderValidation.canTestConnection}
                title={selectedProviderValidation.testConnectionHint || '测试连接'}
              >
                {isTestingConnection ? '测试中…' : '测试连接'}
              </button>
              <button
                className={selectedProvider.enabled ? primaryPillClass : pillClass}
                onClick={() => onUpdateSelectedProvider({ enabled: !selectedProvider.enabled })}
              >
                {selectedProvider.enabled ? '已启用' : '已停用'}
              </button>
              <button
                className={actionButtonClass}
                onClick={() => onRemoveSelectedProvider()}
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
              onChange={(e) => onSelectedProviderTypeChange(e.target.value)}
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
              onChange={(e) => onUpdateSelectedProvider({ id: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="显示名称（可选）"
              value={selectedProvider.label || ''}
              onChange={(e) => onUpdateSelectedProvider({ label: e.target.value })}
            />
            <div className="flex items-center gap-2">
              <input
                className={`${inputClass} flex-1`}
                placeholder="API Key（支持多个，逗号分隔）"
                value={selectedProvider.apiKey || ''}
                onChange={(e) => onUpdateSelectedProvider({ apiKey: e.target.value })}
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
              onChange={(e) => onUpdateSelectedProvider({ baseURL: e.target.value })}
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
                  onChange={(e) => onUpdateSelectedProvider({ anthropicBaseURL: e.target.value })}
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
                onChange={(e) => onUpdateSelectedProvider({ apiVersion: e.target.value })}
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
                  onChange={(next) => onUpdateSelectedProviderParams({ contextWindow: next })}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">100 表示不限</span>
                  <input
                    className={miniInputClass}
                    type="number"
                    min="0"
                    step="1"
                    value={formatNumber(selectedProvider.defaultParams?.contextWindow)}
                    onChange={(e) => onUpdateSelectedProviderParams({ contextWindow: parseOptionalNumber(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600 dark:text-slate-300">温度</span>
                    <Switch
                      checked={selectedProvider.defaultParams?.temperatureEnabled ?? false}
                      onChange={() => onToggleSelectedProviderParam('temperatureEnabled')}
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
                      onChange={(next) => onUpdateSelectedProviderParams({ temperature: next })}
                    />
                    <input
                      className={miniInputClass}
                      type="number"
                      min="0"
                      max="2"
                      step="0.05"
                      value={formatNumber(selectedProvider.defaultParams?.temperature)}
                      onChange={(e) => onUpdateSelectedProviderParams({ temperature: parseOptionalNumber(e.target.value) })}
                      disabled={!(selectedProvider.defaultParams?.temperatureEnabled ?? false)}
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600 dark:text-slate-300">Top-P</span>
                    <Switch
                      checked={selectedProvider.defaultParams?.topPEnabled ?? false}
                      onChange={() => onToggleSelectedProviderParam('topPEnabled')}
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
                      onChange={(next) => onUpdateSelectedProviderParams({ topP: next })}
                    />
                    <input
                      className={miniInputClass}
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={formatNumber(selectedProvider.defaultParams?.topP)}
                      onChange={(e) => onUpdateSelectedProviderParams({ topP: parseOptionalNumber(e.target.value) })}
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
                    onChange={() => onToggleSelectedProviderMaxTokens()}
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
                    onChange={(e) => onUpdateSelectedProviderParams({ maxOutputTokens: parseOptionalNumber(e.target.value) })}
                    disabled={!(selectedProvider.defaultParams?.maxOutputTokensEnabled ?? false)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  className={inputClass}
                  placeholder="Presence Penalty (-2~2)"
                  value={formatNumber(selectedProvider.defaultParams?.presencePenalty)}
                  onChange={(e) => onUpdateSelectedProviderParams({ presencePenalty: parseOptionalNumber(e.target.value) })}
                />
                <input
                  className={inputClass}
                  placeholder="Frequency Penalty (-2~2)"
                  value={formatNumber(selectedProvider.defaultParams?.frequencyPenalty)}
                  onChange={(e) => onUpdateSelectedProviderParams({ frequencyPenalty: parseOptionalNumber(e.target.value) })}
                />
                <input
                  className={inputClass}
                  placeholder="Seed"
                  value={formatNumber(selectedProvider.defaultParams?.seed)}
                  onChange={(e) => onUpdateSelectedProviderParams({ seed: parseOptionalNumber(e.target.value) })}
                />
                <textarea
                  className={`${inputClass} min-h-[72px] sm:col-span-3`}
                  placeholder="Stop sequences (换行或逗号分隔)"
                  value={formatStopSequences(selectedProvider.defaultParams?.stopSequences)}
                  onChange={(e) => onUpdateSelectedProviderParams({ stopSequences: parseStopSequences(e.target.value) })}
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
                  onClick={() => onFetchModelsForSelectedProvider()}
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
                            onUpdateSelectedProvider({ defaultModel: model.id })
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
                                          onChange={() => onToggleModelParam(model.id, 'temperatureEnabled')}
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
                                          onChange={() => onToggleModelParam(model.id, 'topPEnabled')}
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
                                        onChange={() => onToggleModelMaxTokens(model.id)}
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
  )
}
