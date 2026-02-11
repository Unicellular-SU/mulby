import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import type { InputAttachment } from '../../shared/types/plugin'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  attachments: UiAttachment[]
  onAttachmentsChange: (attachments: UiAttachment[]) => void
  attachmentsManagerOpen: boolean
  onAttachmentsManagerOpen: () => void
  onAttachmentsManagerClose: () => void
}

// 暴露给父组件的方法
export interface SearchInputRef {
  focus: () => void
  blur: () => void
  select: () => void
}

// mulbyMain 类型声明
declare global {
  interface Window {
    mulbyMain?: {
      subInput: {
        onEnabled: (callback: (data: { placeholder: string; isFocus: boolean }) => void) => () => void
        onDisabled: (callback: () => void) => () => void
        onSetValue: (callback: (text: string) => void) => () => void
        onFocus: (callback: () => void) => () => void
        onBlur: (callback: () => void) => () => void
        onSelect: (callback: () => void) => () => void
        sendChange: (text: string) => void
      }
      clipboard: {
        onAutoPaste: (callback: () => void) => () => void
      }
    }
  }
}

interface SubInputState {
  enabled: boolean
  placeholder: string
}

interface UiAttachment extends InputAttachment {
  previewUrl?: string
}

const SearchInput = forwardRef<SearchInputRef, SearchInputProps>(function SearchInput({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  attachmentsManagerOpen,
  onAttachmentsManagerOpen,
  onAttachmentsManagerClose
}, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [subInput, setSubInput] = useState<SubInputState>({ enabled: false, placeholder: '' })
  const [subInputValue, setSubInputValue] = useState('')

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus()
    },
    blur: () => {
      inputRef.current?.blur()
    },
    select: () => {
      inputRef.current?.select()
    }
  }), [])

  // 监听 SubInput 事件
  useEffect(() => {
    const api = window.mulbyMain?.subInput
    if (!api) return

    const cleanupEnabled = api.onEnabled((data) => {
      setSubInput({ enabled: true, placeholder: data.placeholder })
      setSubInputValue('')
      if (data.isFocus && inputRef.current) {
        inputRef.current.focus()
      }
    })

    const cleanupDisabled = api.onDisabled(() => {
      setSubInput({ enabled: false, placeholder: '' })
      setSubInputValue('')
    })

    const cleanupSetValue = api.onSetValue((text) => {
      setSubInputValue(text)
    })

    const cleanupFocus = api.onFocus(() => {
      inputRef.current?.focus()
    })

    const cleanupBlur = api.onBlur(() => {
      inputRef.current?.blur()
    })

    const cleanupSelect = api.onSelect(() => {
      inputRef.current?.select()
    })

    return () => {
      cleanupEnabled()
      cleanupDisabled()
      cleanupSetValue()
      cleanupFocus()
      cleanupBlur()
      cleanupSelect()
    }
  }, [])

  // 处理输入变化
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    if (subInput.enabled) {
      // SubInput 模式：更新本地值并通知主进程转发给插件
      setSubInputValue(text)
      window.mulbyMain?.subInput.sendChange(text)
    } else {
      // 正常模式：调用父组件回调
      onChange(text)
    }
  }, [subInput.enabled, onChange])

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (files.length === 0) return

    e.preventDefault()
    const next = await buildAttachments(files, attachments)
    if (next.length > 0) {
      onAttachmentsChange(next)
    }
  }, [attachments, onAttachmentsChange])

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files || [])
    if (files.some((file) => file.path?.endsWith('.inplugin'))) return

    e.preventDefault()
    e.stopPropagation()

    if (files.length === 0) return
    const next = await buildAttachments(files, attachments)
    if (next.length > 0) {
      onAttachmentsChange(next)
    }
  }, [attachments, onAttachmentsChange])

  const totalAttachmentSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0)
  const handleToggleManager = useCallback(() => {
    if (attachmentsManagerOpen) {
      onAttachmentsManagerClose()
    } else {
      onAttachmentsManagerOpen()
    }
  }, [attachmentsManagerOpen, onAttachmentsManagerClose, onAttachmentsManagerOpen])

  const handleClearAttachments = useCallback(() => {
    // 释放所有 blob URLs
    attachments.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
    // 清空附件列表
    onAttachmentsChange([])
  }, [attachments, onAttachmentsChange])

  const isSummaryMode = !subInput.enabled && value.length > SUMMARY_THRESHOLD
  const displayValue = subInput.enabled ? subInputValue : (isSummaryMode ? '' : value)
  const summary = isSummaryMode ? buildSummary(value) : null
  const handleClearSummary = useCallback(() => {
    onChange('')
  }, [onChange])

  return (
    <div className={`search-box ${attachments.length > 0 ? 'has-attachments' : ''}`}>
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      {isSummaryMode && (
        <div className="input-summary-card no-drag" aria-hidden="true">
          <div className="input-summary-text">
            <span className="input-summary-head">{summary?.head}</span>
            <span className="input-summary-ellipsis">...</span>
            <span className="input-summary-tail">{summary?.tail}</span>
          </div>
          <div className="input-summary-meta">共 {value.length} 字</div>
          <button
            className="input-summary-clear"
            type="button"
            onClick={handleClearSummary}
            aria-label="清空输入"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <div className="search-input-wrap">
        <textarea
          ref={inputRef}
          rows={1}
          className="search-input"
          placeholder={isSummaryMode ? '' : (subInput.enabled ? subInput.placeholder : '输入关键词搜索插件...')}
          value={displayValue}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            // Prevent Enter from creating a newline, unless Shift is pressed
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              return
            }

            // 处理 Backspace 删除附件
            if (e.key === 'Backspace') {
              // 如果是摘要模式，清空文本
              if (isSummaryMode && !subInput.enabled) {
                e.preventDefault()
                onChange('')
                return
              }

              // 如果文本为空且有附件，删除最后一个附件
              const currentValue = subInput.enabled ? subInputValue : value
              if (currentValue === '' && attachments.length > 0) {
                e.preventDefault()
                const lastAttachment = attachments[attachments.length - 1]
                // 释放 blob URL
                if (lastAttachment.previewUrl?.startsWith('blob:')) {
                  URL.revokeObjectURL(lastAttachment.previewUrl)
                }
                // 删除最后一个附件
                onAttachmentsChange(attachments.slice(0, -1))
              }
            }

            // 处理 Delete 键（摘要模式）
            if (e.key === 'Delete' && isSummaryMode && !subInput.enabled) {
              e.preventDefault()
              onChange('')
            }
          }}
          onPaste={handlePaste}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          autoFocus
        />
        {attachments.length > 0 && (
          <div className="attachment-summary attachment-summary-inline no-drag">
            <div className="attachment-summary-info">
              附件 {attachments.length} · {formatBytes(totalAttachmentSize)}
            </div>
            <div className="attachment-summary-actions">
              <button
                type="button"
                className="attachment-summary-clear"
                onClick={handleClearAttachments}
                aria-label="清空附件"
                title="清空附件"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <button
                type="button"
                className="attachment-summary-manage"
                onClick={handleToggleManager}
                aria-expanded={attachmentsManagerOpen}
              >
                {attachmentsManagerOpen ? '收起' : '管理'}
              </button>
            </div>
          </div>
        )}
      </div>
      {subInput.enabled && (
        <div className="subinput-indicator" title="SubInput 模式">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </div>
      )}
    </div>
  )
})

async function buildAttachments(files: File[], existing: UiAttachment[]): Promise<UiAttachment[]> {
  const next = [...existing]
  for (const file of files) {
    const attachment = await createAttachment(file)
    if (!attachment) continue

    const duplicate = next.some((item) => {
      if (item.path && attachment.path) {
        return item.path === attachment.path
      }
      return item.name === attachment.name && item.size === attachment.size && item.mime === attachment.mime
    })
    if (!duplicate) {
      next.push(attachment)
    } else if (attachment.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }
  return next
}

async function createAttachment(file: File): Promise<UiAttachment | null> {
  const filePath = (file as File & { path?: string }).path
  const name = file.name || filePath?.split(/[/\\]/).pop() || 'untitled'
  const mime = file.type || undefined
  const ext = extractExt(name)
  const isImage = mime?.startsWith('image/') || isImageExt(ext)
  const previewUrl = isImage ? URL.createObjectURL(file) : undefined
  const dataUrl = isImage && !filePath ? await readFileAsDataUrl(file) : undefined

  return {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name,
    size: file.size,
    kind: isImage ? 'image' : 'file',
    mime,
    ext,
    path: filePath,
    dataUrl,
    previewUrl
  }
}

function extractExt(name: string): string | undefined {
  const match = /(\.[^./\\]+)$/.exec(name)
  return match ? match[1].toLowerCase() : undefined
}

function isImageExt(ext?: string): boolean {
  if (!ext) return false
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.tif', '.heic', '.heif'].includes(ext)
}

function readFileAsDataUrl(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : undefined)
    }
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
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

const SUMMARY_THRESHOLD = 400
const SUMMARY_HEAD_LENGTH = 8
const SUMMARY_TAIL_LENGTH = 8

function buildSummary(text: string): { head: string; tail: string } {
  if (text.length <= SUMMARY_HEAD_LENGTH + SUMMARY_TAIL_LENGTH) {
    return { head: text, tail: '' }
  }
  return {
    head: text.slice(0, SUMMARY_HEAD_LENGTH),
    tail: text.slice(-SUMMARY_TAIL_LENGTH)
  }
}

export default SearchInput
