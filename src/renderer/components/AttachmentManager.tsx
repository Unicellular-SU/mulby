import { useMemo, useState, useEffect } from 'react'
import type { InputAttachment } from '../../shared/types/plugin'

interface AttachmentManagerProps {
  attachments: UiAttachment[]
  onAttachmentsChange: (attachments: UiAttachment[]) => void
  onClose: () => void
  listMaxHeight: number
}

type UiAttachment = InputAttachment & { previewUrl?: string }

function isValidIconDataUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) && value.length > 64
}

function AttachmentManager({ attachments, onAttachmentsChange, onClose, listMaxHeight }: AttachmentManagerProps) {
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [iconMap, setIconMap] = useState<Record<string, string>>({})

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>()
      attachments.forEach((attachment) => {
        if (prev.has(attachment.id)) next.add(attachment.id)
      })
      return next
    })
  }, [attachments])

  useEffect(() => {
    let active = true
    const loadIcons = async () => {
      const nextIcons: Record<string, string> = {}
      const requests = attachments.map(async (attachment) => {
        if (attachment.kind !== 'file' || !attachment.path) return
        if (iconMap[attachment.id]) return
        try {
          const icon = await window.mulby.system.getFileIcon(attachment.path, {
            size: 96,
            kind: 'file'
          })
          if (icon && isValidIconDataUrl(icon)) {
            nextIcons[attachment.id] = icon
          }
        } catch {
          // Ignore icon failures to avoid blocking list rendering.
        }
      })
      await Promise.all(requests)
      if (!active) return
      setIconMap((prev) => {
        let changed = false
        const merged = { ...prev }
        Object.entries(nextIcons).forEach(([id, icon]) => {
          if (merged[id] !== icon) {
            merged[id] = icon
            changed = true
          }
        })
        const validIds = new Set(attachments.map((attachment) => attachment.id))
        Object.keys(merged).forEach((id) => {
          if (!validIds.has(id)) {
            delete merged[id]
            changed = true
          }
        })
        return changed ? merged : prev
      })
    }
    void loadIcons()
    return () => {
      active = false
    }
  }, [attachments, iconMap])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return attachments
    return attachments.filter((attachment) => attachment.name.toLowerCase().includes(keyword))
  }, [attachments, query])

  const totalSize = useMemo(() => {
    return attachments.reduce((sum, attachment) => sum + attachment.size, 0)
  }, [attachments])

  const allVisibleSelected = filtered.length > 0 && filtered.every((attachment) => selectedIds.has(attachment.id))

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) return new Set()
      const next = new Set(prev)
      filtered.forEach((attachment) => next.add(attachment.id))
      return next
    })
  }

  const removeAttachments = (next: UiAttachment[]) => {
    const removed = attachments.filter((attachment) => !next.some((item) => item.id === attachment.id))
    removed.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
    onAttachmentsChange(next)
  }

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return
    const next = attachments.filter((attachment) => !selectedIds.has(attachment.id))
    removeAttachments(next)
    setSelectedIds(new Set())
  }

  const handleRemoveOne = (id: string) => {
    const next = attachments.filter((attachment) => attachment.id !== id)
    removeAttachments(next)
  }

  const handleClearAll = () => {
    if (attachments.length === 0) return
    removeAttachments([])
    setSelectedIds(new Set())
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden rounded-b-[12px] border-t border-slate-200/70 bg-slate-50/95 p-5 backdrop-blur-md no-drag dark:border-slate-800/80 dark:bg-slate-950/95" role="region" aria-label="附件管理">
      <div className="flex items-center gap-3">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">附件管理</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {attachments.length} 个 · {formatBytes(totalSize)}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
            onClick={handleClearAll}
            disabled={attachments.length === 0}
          >
            清空
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
            onClick={onClose}
            aria-label="关闭附件管理器"
          >
            关闭
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-800"
            checked={allVisibleSelected}
            onChange={handleSelectAll}
          />
          <span className="text-xs text-slate-600 dark:text-slate-400">全选</span>
        </label>
        <button
          type="button"
          className="rounded-full bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          onClick={handleDeleteSelected}
          disabled={selectedIds.size === 0}
        >
          删除选中
        </button>
        <div className="ml-auto flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition focus-within:border-slate-300 focus-within:ring-1 focus-within:ring-slate-200 dark:border-slate-800 dark:bg-slate-950 dark:focus-within:border-slate-700 dark:focus-within:ring-slate-800">
          <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="w-32 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索附件"
            aria-label="搜索附件"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto pr-1" role="list" style={{ maxHeight: listMaxHeight }}>
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">没有匹配的附件</div>
        ) : (
          filtered.map((attachment) => (
            <div
              key={attachment.id}
              className={`group flex items-center gap-3 rounded-[16px] border border-slate-200/80 px-3 py-2 transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-800/80 dark:hover:border-slate-700 ${
                selectedIds.has(attachment.id) ? 'bg-slate-100 dark:bg-slate-800' : 'bg-white dark:bg-slate-900'
              }`}
              role="listitem"
            >
              <input
                type="checkbox"
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                checked={selectedIds.has(attachment.id)}
                onChange={() => handleToggleSelect(attachment.id)}
                aria-label={`选择 ${attachment.name}`}
              />
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                {attachment.kind === 'image' && attachment.previewUrl ? (
                  <img className="h-full w-full object-cover" src={attachment.previewUrl} alt="" />
                ) : iconMap[attachment.id] ? (
                  <img className="h-full w-full object-contain" src={iconMap[attachment.id]} alt="" />
                ) : (
                  <svg className="h-5 w-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={attachment.name}>
                  {attachment.name}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{formatBytes(attachment.size)}</div>
              </div>
              <button
                type="button"
                className="invisible flex items-center justify-center rounded-full px-3 py-1 text-[11px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 group-hover:visible dark:hover:bg-slate-800 dark:hover:text-slate-200"
                onClick={() => handleRemoveOne(attachment.id)}
                aria-label={`移除 ${attachment.name}`}
              >
                删除
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = -1
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`
}

export default AttachmentManager
