import type {
  AiModel,
  AiModelParameters,
  AiModelType,
  AiProviderConfig,
  AiSettings
} from '../../../shared/types/ai'
import type { ProviderValidationResult } from '../../../shared/ai/providerValidation'
import { classNames, type ProviderListEntry } from './shared'
import ProviderSidebar from './ProviderSidebar'
import ProviderConfigPanel from './ProviderConfigPanel'
import ProviderModelsPanel from './ProviderModelsPanel'

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
    <section className="h-full min-h-0 overflow-hidden rounded-[24px] bg-white dark:bg-slate-900">
      <div className="flex h-full min-h-0 min-w-0 flex-row">
        <ProviderSidebar
          aiDraft={aiDraft}
          sortedProviderEntries={sortedProviderEntries}
          selectedProviderIndex={selectedProviderIndex}
          primaryPillClass={primaryPillClass}
          setSelectedProviderIndex={setSelectedProviderIndex}
          onOpenAddProviderModal={onOpenAddProviderModal}
          getProviderKey={getProviderKey}
          getProviderTypeLabel={getProviderTypeLabel}
        />

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className={`${cardClassTight} space-y-3`}>
            <ProviderConfigPanel
              aiDraft={aiDraft}
              selectedProvider={selectedProvider}
              selectedProviderValidation={selectedProviderValidation}
              selectedProviderIsSystemDefault={selectedProviderIsSystemDefault}
              selectedProviderType={selectedProviderType}
              selectedProviderSupportsEndpointRouting={selectedProviderSupportsEndpointRouting}
              selectedProviderDefaultBaseURL={selectedProviderDefaultBaseURL}
              selectedProviderDefaultAnthropicBaseURL={selectedProviderDefaultAnthropicBaseURL}
              isTestingConnection={isTestingConnection}
              pillClass={pillClass}
              primaryPillClass={primaryPillClass}
              actionButtonClass={actionButtonClass}
              inputClass={inputClass}
              miniInputClass={miniInputClass}
              tipWrapClass={tipWrapClass}
              tipBubbleClass={tipBubbleClass}
              onTestConnection={onTestConnection}
              onUpdateSelectedProvider={onUpdateSelectedProvider}
              onRemoveSelectedProvider={onRemoveSelectedProvider}
              onSelectedProviderTypeChange={onSelectedProviderTypeChange}
              openApiKeyManager={openApiKeyManager}
              onUpdateSelectedProviderParams={onUpdateSelectedProviderParams}
              onToggleSelectedProviderParam={onToggleSelectedProviderParam}
              onToggleSelectedProviderMaxTokens={onToggleSelectedProviderMaxTokens}
              getProviderKey={getProviderKey}
              getProviderTypeLabel={getProviderTypeLabel}
            />

            <ProviderModelsPanel
              aiDraft={aiDraft}
              selectedProvider={selectedProvider}
              selectedProviderSupportsEndpointRouting={selectedProviderSupportsEndpointRouting}
              selectedProviderValidation={selectedProviderValidation}
              filteredModels={filteredModels}
              isFetchingModels={isFetchingModels}
              pillClass={pillClass}
              primaryPillClass={primaryPillClass}
              actionButtonClass={actionButtonClass}
              inputClass={inputClass}
              miniInputClass={miniInputClass}
              tipWrapClass={tipWrapClass}
              tipBubbleClass={tipBubbleClass}
              onFetchModelsForSelectedProvider={onFetchModelsForSelectedProvider}
              openAddModelModal={openAddModelModal}
              onUpdateSelectedProvider={onUpdateSelectedProvider}
              handleRemoveModel={handleRemoveModel}
              handleUpdateModel={handleUpdateModel}
              resolveProviderIdFromModel={resolveProviderIdFromModel}
              getProviderKey={getProviderKey}
              getModelCapabilityState={getModelCapabilityState}
              isCapabilityAuto={isCapabilityAuto}
              updateModelCapabilities={updateModelCapabilities}
              handleUpdateModelParams={handleUpdateModelParams}
              onToggleModelParam={onToggleModelParam}
              onToggleModelMaxTokens={onToggleModelMaxTokens}
            />
          </div>
        </main>
      </div>
    </section>
  )
}
