import type { ReactNode } from 'react'

interface SettingsLikePageShellProps {
  children: ReactNode
}

interface SettingsLikePageHeaderProps {
  eyebrow: string
  title: string
  onBack: () => void
  actions?: ReactNode
}

export const settingsLikeHeaderGhostButtonClass = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 text-xs leading-none text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 no-drag'
export const settingsLikeHeaderPrimaryButtonClass = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 text-xs leading-none text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 no-drag'

export function SettingsLikePageShell({ children }: SettingsLikePageShellProps) {
  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-500/20" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-400/10" />
        <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col">
        {children}
      </div>
    </div>
  )
}

export function SettingsLikePageHeader({
  eyebrow,
  title,
  onBack,
  actions
}: SettingsLikePageHeaderProps) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
      <button
        type="button"
        onClick={onBack}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
        title="返回"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">{eyebrow}</div>
        <div className="truncate text-lg font-semibold text-slate-900 dark:text-white">{title}</div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
