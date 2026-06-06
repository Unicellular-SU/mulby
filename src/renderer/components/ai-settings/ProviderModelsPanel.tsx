import type {
  AiEndpointType,
  AiModel,
  AiModelParameters,
  AiModelType,
  AiProviderConfig,
  AiSettings
} from '../../../shared/types/ai'
import type { ProviderValidationResult } from '../../../shared/ai/providerValidation'
import UnifiedSelect from '../UnifiedSelect'
import {
  ENDPOINT_TYPE_OPTIONS,
  formatEndpointTypes,
  parseEndpointTypes
} from './shared'
import ProviderModelsHeader from './ProviderModelsHeader'
import ModelCapabilitiesEditor from './ModelCapabilitiesEditor'
import ModelParamsEditor from './ModelParamsEditor'

interface ProviderModelsPanelProps {
  aiDraft: AiSettings | null
  selectedProvider: AiProviderConfig | null
  selectedProviderSupportsEndpointRouting: boolean
  selectedProviderValidation: ProviderValidationResult
  filteredModels: AiModel[]
  isFetchingModels: boolean
  pillClass: string
  primaryPillClass: string
  actionButtonClass: string
  inputClass: string
  miniInputClass: string
  tipWrapClass: string
  tipBubbleClass: string
  onFetchModelsForSelectedProvider: () => void
  openAddModelModal: () => void
  onUpdateSelectedProvider: (patch: Partial<AiProviderConfig>) => void
  handleRemoveModel: (index: number) => void
  handleUpdateModel: (index: number, patch: Partial<AiModel>) => void
  resolveProviderIdFromModel: (model: AiModel) => string
  getProviderKey: (provider: AiProviderConfig) => string
  getModelCapabilityState: (model: AiModel, type: AiModelType) => boolean
  isCapabilityAuto: (model: AiModel, type: AiModelType) => boolean
  updateModelCapabilities: (modelId: string, type: AiModelType, enabled: boolean) => void
  handleUpdateModelParams: (modelId: string, patch: Partial<AiModelParameters>) => void
  onToggleModelParam: (modelId: string, key: 'temperatureEnabled' | 'topPEnabled') => void
  onToggleModelMaxTokens: (modelId: string) => void
}

export default function ProviderModelsPanel({
  aiDraft,
  selectedProvider,
  selectedProviderSupportsEndpointRouting,
  selectedProviderValidation,
  filteredModels,
  isFetchingModels,
  pillClass,
  primaryPillClass,
  actionButtonClass,
  inputClass,
  miniInputClass,
  tipWrapClass,
  tipBubbleClass,
  onFetchModelsForSelectedProvider,
  openAddModelModal,
  onUpdateSelectedProvider,
  handleRemoveModel,
  handleUpdateModel,
  resolveProviderIdFromModel,
  getProviderKey,
  getModelCapabilityState,
  isCapabilityAuto,
  updateModelCapabilities,
  handleUpdateModelParams,
  onToggleModelParam,
  onToggleModelMaxTokens
}: ProviderModelsPanelProps) {
  if (!selectedProvider) return null

  return (
    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/50">
      <ProviderModelsHeader
        selectedProvider={selectedProvider}
        filteredModels={filteredModels}
        isFetchingModels={isFetchingModels}
        selectedProviderValidation={selectedProviderValidation}
        pillClass={pillClass}
        primaryPillClass={primaryPillClass}
        onFetchModelsForSelectedProvider={onFetchModelsForSelectedProvider}
        openAddModelModal={openAddModelModal}
      />

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
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-500 dark:text-slate-400">端点类型</label>
                  <UnifiedSelect
                    value={model.endpointType || ''}
                    onChange={(e) => {
                      const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                      handleUpdateModel(actualIndex, {
                        endpointType: (e.target.value || undefined) as AiEndpointType | undefined
                      })
                    }}
                  >
                    <option value="">默认 (openai)</option>
                    {ENDPOINT_TYPE_OPTIONS.map((endpointType) => (
                      <option key={endpointType} value={endpointType}>
                        {endpointType}
                      </option>
                    ))}
                  </UnifiedSelect>
                </div>
                {selectedProviderSupportsEndpointRouting && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400">支持的端点类型（逗号分隔，可选）</label>
                    <input
                      className={inputClass}
                      placeholder="openai, anthropic, gemini ..."
                      value={formatEndpointTypes(model.supportedEndpointTypes)}
                      onChange={(e) => {
                        const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
                        handleUpdateModel(actualIndex, { supportedEndpointTypes: parseEndpointTypes(e.target.value) })
                      }}
                    />
                  </div>
                )}
              </div>

              <ModelCapabilitiesEditor
                model={model}
                pillClass={pillClass}
                primaryPillClass={primaryPillClass}
                getModelCapabilityState={getModelCapabilityState}
                isCapabilityAuto={isCapabilityAuto}
                updateModelCapabilities={updateModelCapabilities}
              />

              <ModelParamsEditor
                model={model}
                selectedProvider={selectedProvider}
                aiDraft={aiDraft}
                miniInputClass={miniInputClass}
                inputClass={inputClass}
                tipWrapClass={tipWrapClass}
                tipBubbleClass={tipBubbleClass}
                handleUpdateModelParams={handleUpdateModelParams}
                handleUpdateModel={handleUpdateModel}
                onToggleModelParam={onToggleModelParam}
                onToggleModelMaxTokens={onToggleModelMaxTokens}
              />
            </details>
          ))
        )}
      </div>
    </div>
  )
}
