import type { AiModel, AiModelType } from '../../../shared/types/ai'
import { MODEL_CAPABILITIES } from './shared'

interface ModelCapabilitiesEditorProps {
  model: AiModel
  pillClass: string
  primaryPillClass: string
  getModelCapabilityState: (model: AiModel, type: AiModelType) => boolean
  isCapabilityAuto: (model: AiModel, type: AiModelType) => boolean
  updateModelCapabilities: (modelId: string, type: AiModelType, enabled: boolean) => void
}

export default function ModelCapabilitiesEditor({
  model,
  pillClass,
  primaryPillClass,
  getModelCapabilityState,
  isCapabilityAuto,
  updateModelCapabilities
}: ModelCapabilitiesEditorProps) {
  return (
    <div className="mt-3">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">模型能力</div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        默认自动推断，建议不要手动修改，配置错误可能导致模型不可用。
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {MODEL_CAPABILITIES.map((cap) => {
          const enabled = getModelCapabilityState(model, cap.type)
          const auto = isCapabilityAuto(model, cap.type)
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
              {auto ? <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-200">自动</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
