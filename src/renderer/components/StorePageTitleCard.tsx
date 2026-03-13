import type { ReactNode } from 'react'

interface StorePageTitleCardProps {
  sectionLabel: string
  title: string
  description: string
  aside?: ReactNode
}

export default function StorePageTitleCard({
  sectionLabel,
  title,
  description,
  aside
}: StorePageTitleCardProps) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900">
      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
        {sectionLabel}
      </div>
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {description}
          </p>
        </div>
        {aside ? (
          <div className="w-full md:ml-auto md:w-auto md:min-w-[320px]">
            {aside}
          </div>
        ) : null}
      </div>
    </div>
  )
}
