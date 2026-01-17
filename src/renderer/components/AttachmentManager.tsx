import { useMemo, useState, useEffect } from 'react'
import type { InputAttachment } from '../../shared/types/plugin'

interface AttachmentManagerProps {
  attachments: UiAttachment[]
  onAttachmentsChange: (attachments: UiAttachment[]) => void
  onClose: () => void
  listMaxHeight: number
}

type UiAttachment = InputAttachment & { previewUrl?: string }

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
          const icon = await window.intools.system.getFileIcon(attachment.path)
          nextIcons[attachment.id] = icon
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
    <div className="attachment-manager no-drag" role="region" aria-label="附件管理">
      <div className="attachment-manager-header">
        <div className="attachment-manager-title">附件管理</div>
        <div className="attachment-manager-meta">
          {attachments.length} 个 · {formatBytes(totalSize)}
        </div>
        <div className="attachment-manager-actions">
          <button
            type="button"
            className="attachment-manager-btn attachment-manager-btn-ghost"
            onClick={handleClearAll}
            disabled={attachments.length === 0}
          >
            清空
          </button>
          <button
            type="button"
            className="attachment-manager-btn attachment-manager-btn-ghost"
            onClick={onClose}
            aria-label="关闭附件管理器"
          >
            关闭
          </button>
        </div>
      </div>
      <div className="attachment-manager-toolbar">
        <label className="attachment-manager-selectall">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={handleSelectAll}
          />
          <span>全选</span>
        </label>
        <button
          type="button"
          className="attachment-manager-btn"
          onClick={handleDeleteSelected}
          disabled={selectedIds.size === 0}
        >
          删除选中
        </button>
        <div className="attachment-manager-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索附件"
            aria-label="搜索附件"
          />
        </div>
      </div>
      <div className="attachment-manager-list" role="list" style={{ maxHeight: listMaxHeight }}>
        {filtered.length === 0 ? (
          <div className="attachment-manager-empty">没有匹配的附件</div>
        ) : (
          filtered.map((attachment) => (
            <div
              key={attachment.id}
              className={`attachment-manager-row ${selectedIds.has(attachment.id) ? 'selected' : ''}`}
              role="listitem"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(attachment.id)}
                onChange={() => handleToggleSelect(attachment.id)}
                aria-label={`选择 ${attachment.name}`}
              />
              {attachment.kind === 'image' && attachment.previewUrl ? (
                <img className="attachment-manager-thumb" src={attachment.previewUrl} alt="" />
              ) : iconMap[attachment.id] ? (
                <img className="attachment-manager-icon-img" src={iconMap[attachment.id]} alt="" />
              ) : (
                <div className="attachment-manager-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </div>
              )}
              <div className="attachment-manager-info">
                <div className="attachment-manager-name" title={attachment.name}>
                  {attachment.name}
                </div>
                <div className="attachment-manager-sub">{formatBytes(attachment.size)}</div>
              </div>
              <button
                type="button"
                className="attachment-manager-btn attachment-manager-btn-ghost"
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
