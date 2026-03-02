import type { AiProviderConfig, AiSettings } from '../../../shared/types/ai'
import type { ProviderListEntry } from './shared'

interface ProviderSidebarProps {
  aiDraft: AiSettings | null
  sortedProviderEntries: ProviderListEntry[]
  selectedProviderIndex: number
  primaryPillClass: string
  setSelectedProviderIndex: (index: number) => void
  onOpenAddProviderModal: () => void
  getProviderKey: (provider: AiProviderConfig) => string
  getProviderTypeLabel: (provider: AiProviderConfig) => string
}

export default function ProviderSidebar({
  aiDraft,
  sortedProviderEntries,
  selectedProviderIndex,
  primaryPillClass,
  setSelectedProviderIndex,
  onOpenAddProviderModal,
  getProviderKey,
  getProviderTypeLabel
}: ProviderSidebarProps) {
  return (
    <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-r border-slate-200/70 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">供应商配置</h3>
        <button className={`${primaryPillClass} no-drag`} onClick={() => onOpenAddProviderModal()}>
          + 新增供应商
        </button>
      </div>
      <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        共 {(aiDraft?.providers || []).length} 个 Provider
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {(aiDraft?.providers || []).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            暂无 Provider，请先新增
          </div>
        ) : (
          sortedProviderEntries.map(({ provider, index }) => (
            <button
              key={`${provider.id}-${index}`}
              className={`w-full rounded-2xl border px-3 py-2 text-left transition ${index === selectedProviderIndex ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-800/60' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950'}`}
              onClick={() => setSelectedProviderIndex(index)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{getProviderKey(provider)}</div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {getProviderTypeLabel(provider)} · {provider.id}
                  </div>
                </div>
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${provider.enabled ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  title={provider.enabled ? '已启用' : '已停用'}
                  aria-label={provider.enabled ? '已启用' : '已停用'}
                />
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
