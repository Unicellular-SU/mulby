import type { AiModel, AiProviderConfig } from '../../../shared/types/ai'
import type { ProviderValidationResult } from '../../../shared/ai/providerValidation'

interface ProviderModelsHeaderProps {
  selectedProvider: AiProviderConfig
  filteredModels: AiModel[]
  isFetchingModels: boolean
  selectedProviderValidation: ProviderValidationResult
  pillClass: string
  primaryPillClass: string
  onFetchModelsForSelectedProvider: () => void
  openAddModelModal: () => void
}

export default function ProviderModelsHeader({
  selectedProvider,
  filteredModels,
  isFetchingModels,
  selectedProviderValidation,
  pillClass,
  primaryPillClass,
  onFetchModelsForSelectedProvider,
  openAddModelModal
}: ProviderModelsHeaderProps) {
  return (
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
  )
}
