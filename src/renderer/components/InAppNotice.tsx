import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type InAppNoticeType = 'message' | 'success' | 'warning' | 'error'

interface InAppNoticeOptions {
  durationMs?: number
  title?: string
}

interface InAppNoticeItem extends InAppNoticeOptions {
  id: string
  message: string
  type: InAppNoticeType
}

interface InAppNoticeApi {
  show: (message: string, type?: InAppNoticeType, options?: InAppNoticeOptions) => string
  success: (message: string, options?: InAppNoticeOptions) => string
  warning: (message: string, options?: InAppNoticeOptions) => string
  error: (message: string, options?: InAppNoticeOptions) => string
  message: (message: string, options?: InAppNoticeOptions) => string
  dismiss: (id: string) => void
  clear: () => void
}

const InAppNoticeContext = createContext<InAppNoticeApi | null>(null)

function getDefaultDuration(type: InAppNoticeType): number {
  if (type === 'error') return 5200
  if (type === 'warning') return 4600
  return 3600
}

export function InAppNoticeProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<InAppNoticeItem[]>([])
  const timersRef = useRef<Map<string, number>>(new Map())

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    clearTimer(id)
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [clearTimer])

  const show = useCallback((message: string, type: InAppNoticeType = 'message', options?: InAppNoticeOptions) => {
    const text = String(message || '').trim()
    if (!text) return ''

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const item: InAppNoticeItem = {
      id,
      message: text,
      type,
      durationMs: options?.durationMs,
      title: options?.title
    }
    setItems((prev) => [item, ...prev].slice(0, 5))

    const delay = item.durationMs ?? getDefaultDuration(type)
    const timer = window.setTimeout(() => {
      dismiss(id)
    }, delay)
    timersRef.current.set(id, timer)
    return id
  }, [dismiss])

  const clear = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current.clear()
    setItems([])
  }, [])

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  const api = useMemo<InAppNoticeApi>(() => ({
    show,
    success: (message, options) => show(message, 'success', options),
    warning: (message, options) => show(message, 'warning', options),
    error: (message, options) => show(message, 'error', options),
    message: (message, options) => show(message, 'message', options),
    dismiss,
    clear
  }), [clear, dismiss, show])

  return (
    <InAppNoticeContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(420px,calc(100vw-1rem))] flex-col gap-2 no-drag">
          {items.map((item) => (
            <NoticeCard key={item.id} item={item} onClose={() => dismiss(item.id)} />
          ))}
        </div>,
        document.body
      )}
    </InAppNoticeContext.Provider>
  )
}

function NoticeCard({ item, onClose }: { item: InAppNoticeItem; onClose: () => void }) {
  const toneClass = item.type === 'success'
    ? 'border-emerald-200/80 bg-emerald-50/95 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/80 dark:text-emerald-200'
    : item.type === 'warning'
      ? 'border-amber-200/80 bg-amber-50/95 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/80 dark:text-amber-200'
      : item.type === 'error'
        ? 'border-rose-200/80 bg-rose-50/95 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/80 dark:text-rose-200'
        : 'border-slate-200/80 bg-white/95 text-slate-700 dark:border-slate-700/70 dark:bg-slate-900/95 dark:text-slate-200'

  const badgeClass = item.type === 'success'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/70 dark:text-emerald-200'
    : item.type === 'warning'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/70 dark:text-amber-200'
      : item.type === 'error'
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/70 dark:text-rose-200'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'

  const label = item.type === 'success' ? '成功' : item.type === 'warning' ? '警告' : item.type === 'error' ? '错误' : '消息'

  return (
    <div className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${toneClass}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}>{label}</span>
        <div className="min-w-0 flex-1">
          {item.title && <div className="text-xs font-semibold">{item.title}</div>}
          <div className="text-xs leading-relaxed whitespace-pre-wrap break-words">{item.message}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭通知"
          className="rounded-full p-1 text-current/60 transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export function useInAppNotice(): InAppNoticeApi {
  const context = useContext(InAppNoticeContext)
  if (!context) {
    throw new Error('useInAppNotice must be used inside InAppNoticeProvider')
  }
  return context
}
