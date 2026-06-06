import type { AiModel, AiModelParameters, AiProviderConfig, AiSettings } from '../../../shared/types/ai'
import SliderWithTicks from '../SliderWithTicks'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  Switch,
  formatNumber,
  formatStopSequences,
  parseOptionalNumber,
  parseStopSequences
} from './shared'

interface ModelParamsEditorProps {
  model: AiModel
  selectedProvider: AiProviderConfig
  aiDraft: AiSettings | null
  miniInputClass: string
  inputClass: string
  tipWrapClass: string
  tipBubbleClass: string
  handleUpdateModelParams: (modelId: string, patch: Partial<AiModelParameters>) => void
  handleUpdateModel: (index: number, patch: Partial<AiModel>) => void
  onToggleModelParam: (modelId: string, key: 'temperatureEnabled' | 'topPEnabled') => void
  onToggleModelMaxTokens: (modelId: string) => void
}

export default function ModelParamsEditor({
  model,
  selectedProvider,
  aiDraft,
  miniInputClass,
  inputClass,
  tipWrapClass,
  tipBubbleClass,
  handleUpdateModelParams,
  handleUpdateModel,
  onToggleModelParam,
  onToggleModelMaxTokens
}: ModelParamsEditorProps) {
  return (
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
            value={model.params?.contextWindow ?? selectedProvider.defaultParams?.contextWindow ?? aiDraft?.defaultParams?.contextWindow ?? DEFAULT_CONTEXT_WINDOW}
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_120px] items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-300">上下文窗口(token)</span>
            <span className={tipWrapClass}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8h.01M11 12h1v4h-1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={tipBubbleClass}>模型最大上下文 token（与上面的“消息条数”不同）。留空=自动识别（models.dev），仅识别不准时手动覆盖；用于长对话压缩与防溢出</span>
            </span>
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500">留空自动识别（来自 models.dev），识别不准再覆盖</span>
          <input
            className={miniInputClass}
            type="number"
            min="0"
            step="1000"
            placeholder="自动"
            value={formatNumber(model.contextTokens)}
            onChange={(e) => {
              const actualIndex = (aiDraft?.models || []).findIndex((item) => item.id === model.id)
              if (actualIndex >= 0) handleUpdateModel(actualIndex, { contextTokens: parseOptionalNumber(e.target.value) })
            }}
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
  )
}
