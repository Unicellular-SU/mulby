import type { ReactNode } from 'react'

interface StorePageLayoutProps {
  headerTitle: string
  headerSubtitle?: string
  headerActions?: ReactNode
  onBack?: () => void
  children: ReactNode
}

export function StoreBackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
      aria-label="返回"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export function StoreBackground() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-500/20" />
      <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-400/10" />
      <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
    </div>
  )
}

export default function StorePageLayout({
  headerTitle,
  headerSubtitle = 'Store',
  headerActions,
  onBack,
  children
}: StorePageLayoutProps) {
  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <StoreBackground />
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
          {onBack && <StoreBackButton onClick={onBack} />}
          <div className="flex-1">
            <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">
              {headerSubtitle}
            </div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">
              {headerTitle}
            </div>
          </div>
          {headerActions && (
            <div className="flex items-center gap-2">{headerActions}</div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-auto no-drag">
          {children}
        </div>
      </div>
    </div>
  )
}
