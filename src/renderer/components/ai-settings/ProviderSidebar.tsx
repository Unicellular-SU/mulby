import type { AiProviderConfig, AiSettings } from '../../../shared/types/ai'
import type { ProviderListEntry } from './shared'

interface ProviderSidebarProps {
  aiDraft: AiSettings | null
  sortedProviderEntries: ProviderListEntry[]
  selectedProviderIndex: number
  primaryPillClass: string
  setSelectedProviderIndex: (index: number) => void
  onToggleProviderEnabled: (index: number) => void
  onOpenAddProviderModal: () => void
  getProviderKey: (provider: AiProviderConfig) => string
}

export default function ProviderSidebar({
  aiDraft,
  sortedProviderEntries,
  selectedProviderIndex,
  primaryPillClass,
  setSelectedProviderIndex,
  onToggleProviderEnabled,
  onOpenAddProviderModal,
  getProviderKey
}: ProviderSidebarProps) {
  return (
    <aside className="flex min-h-0 w-[240px] shrink-0 flex-col border-r border-slate-200/70 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">供应商配置</h3>
        <button type="button" className={`${primaryPillClass} no-drag`} onClick={() => onOpenAddProviderModal()}>
          + 新增供应商
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {(aiDraft?.providers || []).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            暂无 Provider，请先新增
          </div>
        ) : (
          sortedProviderEntries.map(({ provider, index }) => {
            const isSelected = index === selectedProviderIndex
            const isEnabled = provider.enabled !== false

            return (
              <div
                key={`${provider.id}-${index}`}
                className={`flex items-center gap-2 rounded-2xl border p-1.5 transition ${isSelected ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-800/60' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950'}`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-xl px-2 py-1.5 text-left no-drag"
                  onClick={() => setSelectedProviderIndex(index)}
                >
                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {getProviderKey(provider)}
                  </span>
                </button>
                <button
                  type="button"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition no-drag ${isEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-slate-200 bg-slate-100 text-slate-400 hover:border-slate-300 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'}`}
                  onClick={() => onToggleProviderEnabled(index)}
                  title={isEnabled ? 'Enabled' : 'Disabled'}
                  aria-label={isEnabled ? 'Disable provider' : 'Enable provider'}
                >
                  {isEnabled ? (
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 10.5 8.5 14 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 6 14 14M14 6 6 14" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
