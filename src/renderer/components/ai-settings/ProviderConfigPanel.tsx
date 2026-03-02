import type { AiProviderConfig, AiModelParameters, AiSettings } from '../../../shared/types/ai'
import type { ProviderValidationResult } from '../../../shared/ai/providerValidation'
import SliderWithTicks from '../SliderWithTicks'
import UnifiedSelect from '../UnifiedSelect'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  PROVIDER_TYPE_LABELS,
  Switch,
  formatNumber,
  formatStopSequences,
  getProviderTypeOptions,
  parseOptionalNumber,
  parseStopSequences
} from './shared'

interface ProviderConfigPanelProps {
  aiDraft: AiSettings | null
  selectedProvider: AiProviderConfig | null
  selectedProviderValidation: ProviderValidationResult
  selectedProviderIsSystemDefault: boolean
  selectedProviderType: string
  selectedProviderSupportsEndpointRouting: boolean
  selectedProviderDefaultBaseURL?: string
  selectedProviderDefaultAnthropicBaseURL?: string
  isTestingConnection: boolean
  pillClass: string
  primaryPillClass: string
  actionButtonClass: string
  inputClass: string
  miniInputClass: string
  tipWrapClass: string
  tipBubbleClass: string
  onTestConnection: () => void
  onUpdateSelectedProvider: (patch: Partial<AiProviderConfig>) => void
  onRemoveSelectedProvider: () => void
  onSelectedProviderTypeChange: (nextType: string) => void
  openApiKeyManager: () => void
  onUpdateSelectedProviderParams: (patch: Partial<AiModelParameters>) => void
  onToggleSelectedProviderParam: (key: 'temperatureEnabled' | 'topPEnabled') => void
  onToggleSelectedProviderMaxTokens: () => void
  getProviderKey: (provider: AiProviderConfig) => string
  getProviderTypeLabel: (provider: AiProviderConfig) => string
}

export default function ProviderConfigPanel({
  aiDraft,
  selectedProvider,
  selectedProviderValidation,
  selectedProviderIsSystemDefault,
  selectedProviderType,
  selectedProviderSupportsEndpointRouting,
  selectedProviderDefaultBaseURL,
  selectedProviderDefaultAnthropicBaseURL,
  isTestingConnection,
  pillClass,
  primaryPillClass,
  actionButtonClass,
  inputClass,
  miniInputClass,
  tipWrapClass,
  tipBubbleClass,
  onTestConnection,
  onUpdateSelectedProvider,
  onRemoveSelectedProvider,
  onSelectedProviderTypeChange,
  openApiKeyManager,
  onUpdateSelectedProviderParams,
  onToggleSelectedProviderParam,
  onToggleSelectedProviderMaxTokens,
  getProviderKey,
  getProviderTypeLabel
}: ProviderConfigPanelProps) {
  if (!selectedProvider) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
        请选择一个 Provider 查看详情
      </div>
    )
  }

  return (
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
    </>
  )
}
