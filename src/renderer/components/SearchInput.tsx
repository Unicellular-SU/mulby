import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import type { InputAttachment } from '../../shared/types/plugin'
import type { AutoPasteClipboardPayload } from '../../shared/types/electron'

interface SearchInputProps {
  value: string
  summaryText: string
  onChange: (value: string) => void
  onSummaryChange: (value: string) => void
  onOpenSettings: () => void
  showSettingsButton: boolean
  launchingPlugin?: {
    pluginName: string
    displayName: string
  } | null
  attachments: UiAttachment[]
  onAttachmentsChange: (attachments: UiAttachment[]) => void
  attachmentsManagerOpen: boolean
  onAttachmentsManagerOpen: () => void
  onAttachmentsManagerClose: () => void
}

export interface SearchInputRef {
  focus: () => void
  blur: () => void
  select: () => void
}

declare global {
  interface Window {
    mulbyMain?: {
      subInput: {
        onEnabled: (callback: (data: { placeholder: string; isFocus: boolean; forwardKeys?: string[] }) => void) => () => void
        onDisabled: (callback: () => void) => () => void
        onSetValue: (callback: (text: string) => void) => () => void
        onFocus: (callback: () => void) => () => void
        onBlur: (callback: () => void) => () => void
        onSelect: (callback: () => void) => () => void
        sendKeyDown: (key: string, modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }) => void
        sendChange: (text: string) => void
      }
      clipboard: {
        onAutoPaste: (callback: (payload?: AutoPasteClipboardPayload) => void) => () => void
      }
    }
  }
}

interface SubInputState {
  enabled: boolean
  placeholder: string
  forwardKeys: string[]
}

interface UiAttachment extends InputAttachment {
  previewUrl?: string
}

type DroppedFile = File & { path?: string }
type SummaryInfo = {
  preview: string
  meta: string
}

const CLEAR_INPUT_LABEL = '\u6e05\u7a7a\u8f93\u5165'
const SEARCH_PLACEHOLDER = '\u8f93\u5165\u5173\u952e\u8bcd\u641c\u7d22\u63d2\u4ef6...'
const ATTACHMENTS_LABEL = '\u9644\u4ef6'
const CLEAR_ATTACHMENTS_LABEL = '\u6e05\u7a7a\u9644\u4ef6'
const COLLAPSE_LABEL = '\u6536\u8d77'
const MANAGE_LABEL = '\u7ba1\u7406'
const OPEN_SETTINGS_LABEL = '\u6253\u5f00\u8bbe\u7f6e'

function isInpluginFile(file: DroppedFile): boolean {
  const normalizedName = String(file.name || '').toLowerCase()
  const normalizedPath = String(file.path || '').toLowerCase()
  return normalizedName.endsWith('.inplugin') || normalizedPath.endsWith('.inplugin')
}

const SearchInput = forwardRef<SearchInputRef, SearchInputProps>(function SearchInput({
  value,
  summaryText,
  onChange,
  onSummaryChange,
  onOpenSettings,
  showSettingsButton,
  launchingPlugin,
  attachments,
  onAttachmentsChange,
  attachmentsManagerOpen,
  onAttachmentsManagerOpen,
  onAttachmentsManagerClose
}, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pendingCaretAnimationFramesRef = useRef<number[]>([])
  const pendingCaretTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const caretRestoreGenerationRef = useRef(0)
  const [subInput, setSubInput] = useState<SubInputState>({ enabled: false, placeholder: '', forwardKeys: [] })
  const [subInputValue, setSubInputValue] = useState('')
  const isPluginLaunching = Boolean(launchingPlugin)

  const setCaretToEnd = useCallback((input: HTMLTextAreaElement) => {
    const end = input.value.length
    input.setSelectionRange(end, end)
  }, [])

  const clearPendingCaretRestore = useCallback(() => {
    pendingCaretAnimationFramesRef.current.forEach((animationFrameId) => {
      cancelAnimationFrame(animationFrameId)
    })
    pendingCaretAnimationFramesRef.current = []

    pendingCaretTimeoutsRef.current.forEach((timeoutId) => {
      clearTimeout(timeoutId)
    })
    pendingCaretTimeoutsRef.current = []
  }, [])

  const restoreCaretToEndIfFocused = useCallback((generation: number) => {
    if (caretRestoreGenerationRef.current !== generation) return

    const input = inputRef.current
    if (!input || document.activeElement !== input) return

    setCaretToEnd(input)
  }, [setCaretToEnd])

  const scheduleCaretToEnd = useCallback(() => {
    clearPendingCaretRestore()

    const generation = caretRestoreGenerationRef.current + 1
    caretRestoreGenerationRef.current = generation

    queueMicrotask(() => {
      restoreCaretToEndIfFocused(generation)
    })

    const firstAnimationFrameId = requestAnimationFrame(() => {
      restoreCaretToEndIfFocused(generation)

      const secondAnimationFrameId = requestAnimationFrame(() => {
        restoreCaretToEndIfFocused(generation)
      })
      pendingCaretAnimationFramesRef.current.push(secondAnimationFrameId)
    })
    pendingCaretAnimationFramesRef.current.push(firstAnimationFrameId)

    const zeroDelayTimeoutId = setTimeout(() => {
      restoreCaretToEndIfFocused(generation)
    }, 0)
    const settledTimeoutId = setTimeout(() => {
      restoreCaretToEndIfFocused(generation)
    }, 50)
    pendingCaretTimeoutsRef.current.push(zeroDelayTimeoutId, settledTimeoutId)
  }, [clearPendingCaretRestore, restoreCaretToEndIfFocused])

  const cancelCaretRestore = useCallback(() => {
    caretRestoreGenerationRef.current += 1
    clearPendingCaretRestore()
  }, [clearPendingCaretRestore])

  const focusAtEnd = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    setCaretToEnd(input)
    scheduleCaretToEnd()
  }, [scheduleCaretToEnd, setCaretToEnd])

  useImperativeHandle(ref, () => ({
    focus: () => {
      focusAtEnd()
    },
    blur: () => {
      inputRef.current?.blur()
    },
    select: () => {
      inputRef.current?.select()
    }
  }), [focusAtEnd])

  useEffect(() => {
    const input = inputRef.current
    if (!input || document.activeElement !== input) return
    scheduleCaretToEnd()
  }, [scheduleCaretToEnd])

  useEffect(() => cancelCaretRestore, [cancelCaretRestore])

  useEffect(() => {
    const api = window.mulbyMain?.subInput
    if (!api) return

    const cleanupEnabled = api.onEnabled((data) => {
      setSubInput({ enabled: true, placeholder: data.placeholder, forwardKeys: data.forwardKeys || [] })
      setSubInputValue('')
      if (data.isFocus) {
        focusAtEnd()
      }
    })

    const cleanupDisabled = api.onDisabled(() => {
      setSubInput({ enabled: false, placeholder: '', forwardKeys: [] })
      setSubInputValue('')
    })

    const cleanupSetValue = api.onSetValue((text) => {
      setSubInputValue(text)
    })

    const cleanupFocus = api.onFocus(() => {
      focusAtEnd()
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
  }, [focusAtEnd])

  // 当 subInput 启用时，如果宿主窗口重新获得焦点，则自动聚焦到 subInput
  useEffect(() => {
    if (!subInput.enabled) return
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    const handleWindowFocus = () => {
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        focusAtEnd()
      }, 10)
    }
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      if (focusTimer) clearTimeout(focusTimer)
    }
  }, [subInput.enabled, focusAtEnd])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    if (subInput.enabled) {
      setSubInputValue(text)
      window.mulbyMain?.subInput.sendChange(text)
      return
    }
    onChange(text)
  }, [onChange, subInput.enabled])

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (files.length > 0) {
      e.preventDefault()
      const next = await buildAttachments(files, attachments)
      if (next.length > 0) {
        onAttachmentsChange(next)
      }
      return
    }

    if (subInput.enabled) {
      return
    }

    const pastedText = e.clipboardData.getData('text/plain')
    if (pastedText === '') {
      return
    }

    e.preventDefault()
    onChange(pastedText)
  }, [attachments, onAttachmentsChange, onChange, subInput.enabled])

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files || []) as DroppedFile[]
    if (files.some(isInpluginFile)) return

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
      return
    }
    onAttachmentsManagerOpen()
  }, [attachmentsManagerOpen, onAttachmentsManagerClose, onAttachmentsManagerOpen])

  const handleClearAttachments = useCallback(() => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
    onAttachmentsChange([])
    focusAtEnd()
  }, [attachments, onAttachmentsChange, focusAtEnd])

  const hasSummary = !subInput.enabled && summaryText.length > 0
  const displayValue = subInput.enabled ? subInputValue : value
  const summary = hasSummary ? buildSummary(summaryText) : null

  const handleClearSummary = useCallback(() => {
    onSummaryChange('')
    focusAtEnd()
  }, [onSummaryChange, focusAtEnd])

  const handleSummaryMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    e.preventDefault()
    focusAtEnd()
  }, [focusAtEnd])

  const handleOpenSettings = useCallback(() => {
    onOpenSettings()
  }, [onOpenSettings])

  return (
    <div
      className={`search-box ${attachments.length > 0 ? 'has-attachments' : ''} ${isPluginLaunching ? 'is-plugin-launching' : ''}`}
      aria-busy={isPluginLaunching}
    >
      {isPluginLaunching ? (
        <span className="plugin-launch-spinner" aria-hidden="true" />
      ) : (
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      )}
      <div className={`search-input-wrap ${hasSummary ? 'has-summary' : ''}`}>
        {isPluginLaunching ? (
          <div className="plugin-launch-status no-drag" role="status" aria-live="polite">
            <span className="plugin-launch-name">{launchingPlugin?.displayName || launchingPlugin?.pluginName}</span>
            <span className="plugin-launch-text">正在打开</span>
          </div>
        ) : hasSummary && summary && (
          <div className="input-summary-card no-drag" onMouseDown={handleSummaryMouseDown}>
            <div className="input-summary-body">
              <div className="input-summary-preview">{summary.preview}</div>
              <div className="input-summary-meta">{summary.meta}</div>
            </div>
            <button
              className="input-summary-clear"
              type="button"
              onClick={handleClearSummary}
              aria-label={CLEAR_INPUT_LABEL}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {!isPluginLaunching && (
          <textarea
            ref={inputRef}
            rows={1}
            className="search-input"
            placeholder={subInput.enabled ? subInput.placeholder : SEARCH_PLACEHOLDER}
            value={displayValue}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              cancelCaretRestore()

              if (e.nativeEvent.isComposing) return

              if (subInput.enabled && subInput.forwardKeys.includes(e.key)) {
                e.preventDefault()
                window.mulbyMain?.subInput.sendKeyDown(e.key, {
                  shift: e.shiftKey,
                  ctrl: e.ctrlKey,
                  alt: e.altKey,
                  meta: e.metaKey,
                })
                return
              }

              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                return
              }

              if (e.key === 'Backspace') {
                if (!subInput.enabled && value === '' && summaryText) {
                  e.preventDefault()
                  onSummaryChange('')
                  return
                }

                const currentValue = subInput.enabled ? subInputValue : value
                if (currentValue === '' && attachments.length > 0) {
                  e.preventDefault()
                  const lastAttachment = attachments[attachments.length - 1]
                  if (lastAttachment.previewUrl?.startsWith('blob:')) {
                    URL.revokeObjectURL(lastAttachment.previewUrl)
                  }
                  onAttachmentsChange(attachments.slice(0, -1))
                }
              }

              if (e.key === 'Delete' && !subInput.enabled && value === '' && summaryText) {
                e.preventDefault()
                onSummaryChange('')
              }
            }}
            onPointerDown={cancelCaretRestore}
            onPaste={handlePaste}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            autoFocus
          />
        )}
        {!isPluginLaunching && attachments.length > 0 && (
          <div className="input-summary-card no-drag" style={{ flex: '0 1 auto', minWidth: 0 }} onMouseDown={handleSummaryMouseDown}>
            <div
              className="input-summary-body"
              onClick={handleToggleManager}
              style={{ cursor: 'pointer' }}
              title={attachmentsManagerOpen ? COLLAPSE_LABEL : MANAGE_LABEL}
            >
              <div className="input-summary-preview">
                {ATTACHMENTS_LABEL} {attachments.length}
              </div>
              <div className="input-summary-meta">{formatBytes(totalAttachmentSize)}</div>
            </div>
            <button
              className="input-summary-clear"
              type="button"
              onClick={handleClearAttachments}
              aria-label={CLEAR_ATTACHMENTS_LABEL}
              title={CLEAR_ATTACHMENTS_LABEL}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {!isPluginLaunching && (showSettingsButton || subInput.enabled) && (
        <div className="search-box-actions no-drag">
          {showSettingsButton && (
            <button
              type="button"
              className="search-settings-button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleOpenSettings}
              aria-label={OPEN_SETTINGS_LABEL}
              title={OPEN_SETTINGS_LABEL}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <circle cx="12" cy="12" r="3.25" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.1 1.6c.2.1.4.1.6.1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
          )}
          {subInput.enabled && (
            <div className="subinput-indicator" title={`SubInput ${'\u6a21\u5f0f'}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </div>
          )}
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

const SUMMARY_PREVIEW_HEAD_LENGTH = 12
const SUMMARY_PREVIEW_TAIL_LENGTH = 12

function buildSummary(text: string): SummaryInfo {
  const normalized = normalizeSummaryText(text)
  const lines = normalized.split('\n')
  const preview = buildSummaryPreview(normalized)
  const charCount = countSummaryCharacters(normalized)

  if (lines.length > 1) {
    return {
      preview: preview || '\u7a7a\u884c',
      meta: `${lines.length}\u884c ${charCount}\u5b57`
    }
  }

  return {
    preview: preview || '\u7a7a\u6587\u672c',
    meta: `${charCount}\u5b57`
  }
}

function buildSummaryPreview(text: string): string {
  const compacted = compactSummaryPreviewText(text)
  if (!compacted) {
    return ''
  }
  const characters = Array.from(compacted)
  if (characters.length <= SUMMARY_PREVIEW_HEAD_LENGTH + SUMMARY_PREVIEW_TAIL_LENGTH) {
    return compacted
  }
  return `${characters.slice(0, SUMMARY_PREVIEW_HEAD_LENGTH).join('')}...${characters.slice(-SUMMARY_PREVIEW_TAIL_LENGTH).join('')}`
}

function countSummaryCharacters(text: string): number {
  return Array.from(text.replace(/\n/g, '')).length
}

function normalizeSummaryText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function compactSummaryPreviewText(text: string): string {
  return normalizeSummaryText(text)
    .replace(/[\s\u3000]+/g, '')
    .trim()
}

export default SearchInput
