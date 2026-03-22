import { useEffect, useState } from 'react'
import type { ShortcutStatusMap } from '../../../shared/types/settings'
import { normalizeShortcutKey } from './utils'

interface ShortcutInputProps {
  label: string
  description: string
  value: string
  status?: ShortcutStatusMap[keyof ShortcutStatusMap]
  onChange: (next: string) => void
  onRecordStart: () => void
  onRecordEnd: () => void
}

export default function ShortcutInput({
  label,
  description,
  value,
  status,
  onChange,
  onRecordStart,
  onRecordEnd
}: ShortcutInputProps) {
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return

    let finished = false
    void window.mulby.settings.setShortcutRecordingActive(true).catch(() => {
      // Ignore recording activation failures in view layer.
    })

    const finishRecording = () => {
      setRecording(false)
      setError(null)
      setPreview(null)
      onRecordEnd()
    }

    const cancelRecording = () => {
      if (finished) return
      finished = true
      finishRecording()
    }

    const commitAccelerator = (event: KeyboardEvent) => {
      const mainKey = normalizeShortcutKey(event)
      const parts: string[] = []

      if (event.metaKey || event.ctrlKey) {
        parts.push('CommandOrControl')
      }
      if (event.altKey) {
        parts.push('Alt')
      }
      if (event.shiftKey) {
        parts.push('Shift')
      }
      if (mainKey) {
        parts.push(mainKey)
      }

      const accelerator = parts.join('+')
      setPreview(accelerator)

      const hasPrimaryModifier = event.metaKey || event.ctrlKey || event.altKey
      if (!mainKey || !hasPrimaryModifier) {
        setError('至少需要一个修饰键')
        return
      }

      if (finished) return
      finished = true
      finishRecording()
      onChange(accelerator)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        cancelRecording()
        return
      }

      commitAccelerator(event)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') return
      commitAccelerator(event)
    }

    const handleBlur = () => {
      cancelRecording()
    }

    const offShortcutCaptured = window.mulby.settings.onShortcutCaptured((accelerator) => {
      if (finished) return
      finished = true
      finishRecording()
      onChange(accelerator)
    })

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)

    return () => {
      if (!finished) {
        finished = true
        onRecordEnd()
      }

      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      offShortcutCaptured()
      void window.mulby.settings.setShortcutRecordingActive(false).catch(() => {
        // Ignore recording deactivation failures in view layer.
      })
    }
  }, [recording, onChange, onRecordEnd])

  const statusText = status?.ok
    ? (status.via === 'hook' ? '已通过底层监听接管，其他应用可能同时响应' : '')
    : status?.reason === 'duplicate'
      ? '快捷键冲突'
      : status?.reason === 'system-reserved'
        ? '系统保留快捷键'
        : status?.reason === 'in-use'
          ? '被其他应用占用，正在尝试抢回…'
          : status?.reason === 'invalid'
            ? '格式无效'
            : '注册失败'

  const displayValue = recording ? (preview || '按下快捷键') : (value || '未设置')

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900 sm:p-5">
      <div className="space-y-3">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{label}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{description}</div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[200px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            <div className="text-sm font-medium">{displayValue}</div>
            {(error || statusText) && (
              <div className={`text-xs ${status?.ok && status?.via === 'hook' ? 'text-amber-500' : 'text-red-500'}`}>{error || statusText}</div>
            )}
          </div>
          <button
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${recording
              ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
            }`}
            onClick={() => {
              setError(null)
              setRecording(true)
              onRecordStart()
            }}
          >
            {recording ? '按下快捷键' : '录制'}
          </button>
        </div>
      </div>
    </div>
  )
}
