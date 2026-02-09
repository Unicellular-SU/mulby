import type { Dispatch, SetStateAction } from 'react'
import type {
  AiEndpointType,
  AiModel,
  AiModelType,
  AiModelParameters,
  AiProviderConfig,
  AiSettings
} from '../../../shared/types/ai'
import { inferProviderType } from '../../../shared/ai/providerType'
import { supportsProviderEndpointRouting } from '../../../shared/ai/providerEndpointRouting'
import SliderWithTicks from '../SliderWithTicks'
import UnifiedSelect from '../UnifiedSelect'
import {
  classNames,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  ENDPOINT_TYPE_OPTIONS,
  MODEL_CAPABILITIES,
  PROVIDER_TYPE_LABELS,
  PROVIDER_TYPE_OPTIONS,
  Switch,
  formatEndpointTypes,
  formatNumber,
  formatStopSequences,
  getModelCapabilityState,
  parseEndpointTypes,
  parseOptionalNumber,
  parseStopSequences,
  isCapabilityAuto,
  type ApiKeyTestStatus,
  type ProviderModelOption
} from './shared'

interface FetchedModelsModalProps {
  show: boolean
  fetchProviderLabel: string | null
  fetchSearch: string
  filteredFetchedModels: AiModel[]
  selectedFetchedModelIds: Set<string>
  onClose: () => void
  onFetchSearchChange: (value: string) => void
  onSelectAll: () => void
  onInvertSelection: () => void
  onToggleFetchedModel: (id: string) => void
  onAddSelected: () => void
}

export function FetchedModelsModal({
  show,
  fetchProviderLabel,
  fetchSearch,
  filteredFetchedModels,
  selectedFetchedModelIds,
  onClose,
  onFetchSearchChange,
  onSelectAll,
  onInvertSelection,
  onToggleFetchedModel,
  onAddSelected
}: FetchedModelsModalProps) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 max-h-[80vh] w-full max-w-3xl overflow-auto rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
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
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-[240px] flex-1">
            <input
              className={classNames.inputClass}
              placeholder="搜索模型 ID / 名称"
              value={fetchSearch}
              onChange={(e) => onFetchSearchChange(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <button className={classNames.pillClass} onClick={onSelectAll}>全选</button>
            <button className={classNames.pillClass} onClick={onInvertSelection}>反全选</button>
          </div>
        </div>

        <div className="space-y-2">
          {filteredFetchedModels.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
              未找到匹配模型
            </div>
          ) : (
            filteredFetchedModels.map((model) => (
              <label
                key={model.id}
                className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800/80 dark:bg-slate-800/40 dark:text-slate-200"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">{model.label}</div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">{model.id}</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-slate-900 dark:accent-white"
                  checked={selectedFetchedModelIds.has(model.id)}
                  onChange={() => onToggleFetchedModel(model.id)}
                />
              </label>
            ))
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button className={classNames.pillClass} onClick={onClose}>取消</button>
          <button className={classNames.primaryPillClass} onClick={onAddSelected}>添加所选</button>
        </div>
      </div>
    </div>
  )
}

interface ApiKeyManagerModalProps {
  show: boolean
  selectedProvider: AiProviderConfig | null
  selectedProviderApiKeys: string[]
  selectedProviderModelOptions: ProviderModelOption[]
  newApiKeyInput: string
  apiKeyTestModel: string
  testingApiKeyIndex: number | null
  apiKeyTestStatusMap: Record<string, ApiKeyTestStatus>
  onClose: () => void
  onNewApiKeyInputChange: (value: string) => void
  onApiKeyTestModelChange: (value: string) => void
  onAddApiKey: () => void
  onTestSingleApiKey: (key: string, index: number) => void
  onRemoveApiKey: (index: number) => void
  getProviderKey: (provider: AiProviderConfig) => string
}

export function ApiKeyManagerModal({
  show,
  selectedProvider,
  selectedProviderApiKeys,
  selectedProviderModelOptions,
  newApiKeyInput,
  apiKeyTestModel,
  testingApiKeyIndex,
  apiKeyTestStatusMap,
  onClose,
  onNewApiKeyInputChange,
  onApiKeyTestModelChange,
  onAddApiKey,
  onTestSingleApiKey,
  onRemoveApiKey,
  getProviderKey
}: ApiKeyManagerModalProps) {
  if (!show || !selectedProvider) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 max-h-[80vh] w-full max-w-3xl overflow-auto rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
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
            onClick={onClose}
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
            onChange={(e) => onApiKeyTestModelChange(e.target.value)}
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
            className={classNames.inputClass}
            placeholder="新增 API Key（支持批量粘贴，逗号或换行分隔）"
            value={newApiKeyInput}
            onChange={(e) => onNewApiKeyInputChange(e.target.value)}
          />
          <button className={classNames.primaryPillClass} onClick={onAddApiKey}>添加密钥</button>
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
                        className={classNames.pillClass}
                        onClick={() => onTestSingleApiKey(key, index)}
                        disabled={testingApiKeyIndex !== null || selectedProviderModelOptions.length === 0 || !apiKeyTestModel}
                        title={selectedProviderModelOptions.length === 0 ? '请先添加模型' : '测试该密钥可用性'}
                      >
                        {testingApiKeyIndex === index ? '测试中…' : '测试'}
                      </button>
                      <button
                        className={classNames.actionButtonClass}
                        onClick={() => onRemoveApiKey(index)}
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
  )
}

interface AddProviderModalProps {
  show: boolean
  newProvider: AiProviderConfig
  newProviderDefaultBaseURL?: string
  newProviderDefaultAnthropicBaseURL?: string
  onClose: () => void
  onAddProvider: () => void
  onNewProviderTypeChange: (nextType: string) => void
  setNewProvider: Dispatch<SetStateAction<AiProviderConfig>>
}

export function AddProviderModal({
  show,
  newProvider,
  newProviderDefaultBaseURL,
  newProviderDefaultAnthropicBaseURL,
  onClose,
  onAddProvider,
  onNewProviderTypeChange,
  setNewProvider
}: AddProviderModalProps) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
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
            onClick={onClose}
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
            onChange={(e) => onNewProviderTypeChange(e.target.value)}
          >
            {PROVIDER_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {PROVIDER_TYPE_LABELS[type] || type}
              </option>
            ))}
          </UnifiedSelect>
          <input
            className={classNames.inputClass}
            placeholder="Provider 实例 ID（可选，留空自动生成）"
            value={newProvider.id || ''}
            onChange={(e) => setNewProvider((prev) => ({ ...prev, id: e.target.value }))}
          />
          <input
            className={classNames.inputClass}
            placeholder="显示名称（可选）"
            value={newProvider.label || ''}
            onChange={(e) => setNewProvider((prev) => ({ ...prev, label: e.target.value }))}
          />
          <input
            className={classNames.inputClass}
            placeholder="API Key（支持多个，逗号分隔）"
            value={newProvider.apiKey || ''}
            onChange={(e) => setNewProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
          />
          <input
            className={classNames.inputClass}
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
                className={classNames.inputClass}
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
              className={classNames.inputClass}
              placeholder="API Version（Azure OpenAI）"
              value={newProvider.apiVersion || ''}
              onChange={(e) => setNewProvider((prev) => ({ ...prev, apiVersion: e.target.value }))}
            />
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button className={classNames.pillClass} onClick={onClose}>取消</button>
          <button className={classNames.primaryPillClass} onClick={onAddProvider}>添加 Provider</button>
        </div>
      </div>
    </div>
  )
}

interface AddModelModalProps {
  show: boolean
  aiDraft: AiSettings | null
  newModel: AiModel
  newModelProviderIndex: number
  newModelNeedsEndpointType: boolean
  inferredCapabilities: Record<string, Set<AiModelType>>
  onClose: () => void
  onAddModel: () => void
  onNewModelProviderIndexChange: (index: number) => void
  setNewModel: Dispatch<SetStateAction<AiModel>>
  updateNewModelCapability: (type: AiModelType, enabled: boolean) => void
  getProviderKey: (provider: AiProviderConfig) => string
}

export function AddModelModal({
  show,
  aiDraft,
  newModel,
  newModelProviderIndex,
  newModelNeedsEndpointType,
  inferredCapabilities,
  onClose,
  onAddModel,
  onNewModelProviderIndexChange,
  setNewModel,
  updateNewModelCapability,
  getProviderKey
}: AddModelModalProps) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
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
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            className={classNames.inputClass}
            placeholder="模型 ID"
            value={newModel.id}
            onChange={(e) => setNewModel((prev) => ({ ...prev, id: e.target.value }))}
          />
          <input
            className={classNames.inputClass}
            placeholder="模型名称"
            value={newModel.label}
            onChange={(e) => setNewModel((prev) => ({ ...prev, label: e.target.value }))}
          />
          <UnifiedSelect
            value={String(newModelProviderIndex)}
            onChange={(e) => onNewModelProviderIndexChange(Number(e.target.value))}
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
            className={classNames.inputClass}
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
                className={classNames.inputClass}
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
              const enabled = getModelCapabilityState(newModel, cap.type, inferredCapabilities)
              const auto = isCapabilityAuto(newModel, cap.type)
              return (
                <button
                  key={`new-${cap.type}`}
                  className={enabled ? classNames.primaryPillClass : classNames.pillClass}
                  onClick={() => updateNewModelCapability(cap.type, !enabled)}
                >
                  <span>{cap.label}</span>
                  {auto ? (
                    <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-200">自动</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button className={classNames.pillClass} onClick={onClose}>取消</button>
          <button className={classNames.primaryPillClass} onClick={onAddModel}>添加模型</button>
        </div>
      </div>
    </div>
  )
}

interface DefaultParamsModalProps {
  show: boolean
  aiDraft: AiSettings | null
  onClose: () => void
  onUpdateDefaultParams: (patch: Partial<AiModelParameters>) => void
  onToggleDefaultParam: (key: 'temperatureEnabled' | 'topPEnabled') => void
  onToggleDefaultMaxTokens: () => void
}

export function DefaultParamsModal({
  show,
  aiDraft,
  onClose,
  onUpdateDefaultParams,
  onToggleDefaultParam,
  onToggleDefaultMaxTokens
}: DefaultParamsModalProps) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">默认参数</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">配置全局默认的 AI 模型参数</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">空值表示继承模型或供应商参数</div>
          <span className={classNames.tipWrapClass}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className={classNames.tipBubbleClass}>token 为估算值，仅供参考</span>
          </span>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[180px_1fr_120px]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-300">上下文条数</span>
              <span className={classNames.tipWrapClass}>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={classNames.tipBubbleClass}>保留最近的消息条数，100 表示不限，普通聊天建议 5–10</span>
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
              onChange={(next) => onUpdateDefaultParams({ contextWindow: next })}
            />
            <input
              className={classNames.miniInputClass}
              type="number"
              min="0"
              step="1"
              value={formatNumber(aiDraft?.defaultParams?.contextWindow)}
              onChange={(e) => onUpdateDefaultParams({ contextWindow: parseOptionalNumber(e.target.value) })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600 dark:text-slate-300">温度</span>
                <Switch
                  checked={aiDraft?.defaultParams?.temperatureEnabled ?? false}
                  onChange={() => onToggleDefaultParam('temperatureEnabled')}
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
                  onChange={(next) => onUpdateDefaultParams({ temperature: next })}
                />
                <input
                  className={classNames.miniInputClass}
                  type="number"
                  min="0"
                  max="2"
                  step="0.05"
                  value={formatNumber(aiDraft?.defaultParams?.temperature)}
                  onChange={(e) => onUpdateDefaultParams({ temperature: parseOptionalNumber(e.target.value) })}
                  disabled={!(aiDraft?.defaultParams?.temperatureEnabled ?? false)}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600 dark:text-slate-300">Top-P</span>
                <Switch
                  checked={aiDraft?.defaultParams?.topPEnabled ?? false}
                  onChange={() => onToggleDefaultParam('topPEnabled')}
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
                  onChange={(next) => onUpdateDefaultParams({ topP: next })}
                />
                <input
                  className={classNames.miniInputClass}
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={formatNumber(aiDraft?.defaultParams?.topP)}
                  onChange={(e) => onUpdateDefaultParams({ topP: parseOptionalNumber(e.target.value) })}
                  disabled={!(aiDraft?.defaultParams?.topPEnabled ?? false)}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[180px_1fr_120px]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-300">最大输出 tokens</span>
              <span className={classNames.tipWrapClass}>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={classNames.tipBubbleClass}>单次最大输出 token，过大可能报错。关闭表示不限制。</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={aiDraft?.defaultParams?.maxOutputTokensEnabled ?? false}
                onChange={onToggleDefaultMaxTokens}
              />
              <input
                className={classNames.miniInputClass}
                type="number"
                min="1"
                step="1"
                value={formatNumber(aiDraft?.defaultParams?.maxOutputTokens)}
                onChange={(e) => onUpdateDefaultParams({ maxOutputTokens: parseOptionalNumber(e.target.value) })}
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
              className={classNames.inputClass}
              placeholder="Top-K"
              value={formatNumber(aiDraft?.defaultParams?.topK)}
              onChange={(e) => onUpdateDefaultParams({ topK: parseOptionalNumber(e.target.value) })}
            />
            <input
              className={classNames.inputClass}
              placeholder="Presence Penalty (-2~2)"
              value={formatNumber(aiDraft?.defaultParams?.presencePenalty)}
              onChange={(e) => onUpdateDefaultParams({ presencePenalty: parseOptionalNumber(e.target.value) })}
            />
            <input
              className={classNames.inputClass}
              placeholder="Frequency Penalty (-2~2)"
              value={formatNumber(aiDraft?.defaultParams?.frequencyPenalty)}
              onChange={(e) => onUpdateDefaultParams({ frequencyPenalty: parseOptionalNumber(e.target.value) })}
            />
            <input
              className={classNames.inputClass}
              placeholder="Seed"
              value={formatNumber(aiDraft?.defaultParams?.seed)}
              onChange={(e) => onUpdateDefaultParams({ seed: parseOptionalNumber(e.target.value) })}
            />
            <textarea
              className={`${classNames.inputClass} min-h-[84px] sm:col-span-2`}
              placeholder="Stop sequences (换行或逗号分隔)"
              value={formatStopSequences(aiDraft?.defaultParams?.stopSequences)}
              onChange={(e) => onUpdateDefaultParams({ stopSequences: parseStopSequences(e.target.value) })}
            />
          </div>
        </details>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button className={classNames.pillClass} onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
