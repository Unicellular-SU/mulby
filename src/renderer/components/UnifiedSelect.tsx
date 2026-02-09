import type { SelectHTMLAttributes } from 'react'

interface UnifiedSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string
}

const baseSelectClass =
  'w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-2 pr-10 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

export default function UnifiedSelect({
  wrapperClassName,
  className,
  children,
  ...props
}: UnifiedSelectProps) {
  return (
    <div className={joinClassNames('relative', wrapperClassName)}>
      <select {...props} className={joinClassNames(baseSelectClass, className)}>
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
