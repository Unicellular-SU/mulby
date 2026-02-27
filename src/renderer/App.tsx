import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import SearchInput, { SearchInputRef } from './components/SearchInput'
import PluginList from './components/PluginList'
import PluginDetails from './components/PluginDetails'
import PluginManagerView from './components/PluginManagerView'
import BackgroundPluginManagerView from './components/BackgroundPluginManagerView'
import TaskSchedulerView from './components/TaskSchedulerView'
import AttachmentManager from './components/AttachmentManager'
import SettingsView, { SettingsSection } from './components/SettingsView'
import AiSettingsView from './components/AiSettingsView'
import AiMcpSettingsView from './components/AiMcpSettingsView'
import AiSkillsSettingsView from './components/AiSkillsSettingsView'
import LogViewerView from './components/LogViewerView'
import type { InputAttachment, InputPayload } from '../shared/types/plugin'

// 插件附着信息（Panel 模式）
interface PluginInfo {
  pluginName: string
  displayName: string
  featureCode: string
  input: string
  mode: 'panel'
}

type SearchPerfTraceSource = 'text' | 'attachments'

interface SearchPerfTrace {
  id: number
  startedAt: number
  source: SearchPerfTraceSource
  textLength: number
  attachmentCount: number
}

type DroppedFile = File & { path?: string }

function isInpluginFile(file: DroppedFile): boolean {
  const normalizedName = String(file.name || '').toLowerCase()
  const normalizedPath = String(file.path || '').toLowerCase()
  return normalizedName.endsWith('.inplugin') || normalizedPath.endsWith('.inplugin')
}

function App() {
  const [query, setQuery] = useState('')
  const [, setResultCount] = useState(0)
  const [pluginOpen, setPluginOpen] = useState(false) // 仅用于跟踪插件是否打开
  const [detailsPluginName, setDetailsPluginName] = useState<string | null>(null)
  const [detailsReturnTarget, setDetailsReturnTarget] = useState<'home' | 'settings' | 'plugins'>('home')
  const [viewMode, setViewMode] = useState<'home' | 'plugin-details' | 'settings' | 'plugins' | 'logs' | 'background-plugins' | 'task-scheduler' | 'ai-settings' | 'ai-mcp-settings' | 'ai-skills-settings'>('home')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [shortcutCommandHint, setShortcutCommandHint] = useState('')
  const [pluginManagerReturnTarget, setPluginManagerReturnTarget] = useState<'home' | 'settings'>('home')
  const [pluginManagerSection, setPluginManagerSection] = useState<'installed' | 'store'>('installed')
  const [backgroundPluginManagerReturnTarget, setBackgroundPluginManagerReturnTarget] = useState<'home' | 'settings'>('home')
  const [taskSchedulerReturnTarget, setTaskSchedulerReturnTarget] = useState<'home' | 'settings'>('home')
  const [logViewerReturnTarget, setLogViewerReturnTarget] = useState<'home' | 'settings'>('settings')
  const [isDragging, setIsDragging] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [attachments, setAttachments] = useState<UiAttachment[]>([])
  const [attachmentsManagerOpen, setAttachmentsManagerOpen] = useState(false)
  const [pluginListHeight, setPluginListHeight] = useState(240)
  const payload = useMemo(() => buildPayload(query, attachments), [query, attachments])
  const [perfTrace, setPerfTrace] = useState<SearchPerfTrace>({
    id: 0,
    startedAt: 0,
    source: 'text',
    textLength: 0,
    attachmentCount: 0
  })

  // 搜索框 ref
  const searchInputRef = useRef<SearchInputRef>(null)
  const perfTraceSeqRef = useRef(0)
  const lastHeightRef = useRef<number | null>(null)

  const beginPerfTrace = useCallback((source: SearchPerfTraceSource, textLength: number, attachmentCount: number) => {
    const nextId = perfTraceSeqRef.current + 1
    perfTraceSeqRef.current = nextId
    const startedAt = performance.now()
    setPerfTrace({
      id: nextId,
      startedAt,
      source,
      textLength,
      attachmentCount
    })

  }, [])

  const managerMetrics = useMemo(() => {
    const MANAGER_HEADER_HEIGHT = 34
    const MANAGER_TOOLBAR_HEIGHT = 34
    const MANAGER_ROW_HEIGHT = 52
    const MANAGER_ROW_GAP = 6
    const MANAGER_GAP = 10
    const MANAGER_PADDING = 26
    const MANAGER_MAX_ROWS = 6

    const rows = Math.min(attachments.length, MANAGER_MAX_ROWS)
    const rawListHeight = rows * MANAGER_ROW_HEIGHT + Math.max(0, rows - 1) * MANAGER_ROW_GAP
    const listHeight = Math.max(60, rawListHeight)
    const managerHeight = MANAGER_PADDING +
      MANAGER_HEADER_HEIGHT +
      MANAGER_TOOLBAR_HEIGHT +
      MANAGER_GAP * 2 +
      listHeight

    return { managerHeight, listHeight }
  }, [attachments.length])

  // 初始化主题
  useEffect(() => {
    window.mulby.theme.getActual().then(setTheme)
    const cleanup = window.mulby.onThemeChange(setTheme)
    return cleanup
  }, [])

  // 应用主题到 document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // 调整窗口高度
  useEffect(() => {
    const SEARCH_BOX_HEIGHT = 62
    const BORDER_HEIGHT = 1
    const EXPANDED_HEIGHT = 800
    const SEARCH_PANEL_MAX_HEIGHT = EXPANDED_HEIGHT - SEARCH_BOX_HEIGHT - BORDER_HEIGHT
    const SYSTEM_PAGE_HEIGHT = 800
    const MANAGER_HEIGHT = managerMetrics.managerHeight

    let height = SEARCH_BOX_HEIGHT
    let allowResize = false
    const showSearchPanel = (query.length > 0 || attachments.length > 0) && !pluginOpen && !attachmentsManagerOpen

    if (viewMode !== 'home') {
      // 设置/详情页高度，允许自由调整大小
      height = SYSTEM_PAGE_HEIGHT
      allowResize = true
    } else if (pluginOpen) {
      // 插件面板打开时，主窗口只保持搜索框高度（插件 UI 在独立的 Panel 窗口中）
      height = SEARCH_BOX_HEIGHT
    } else if (attachmentsManagerOpen && attachments.length > 0) {
      height = SEARCH_BOX_HEIGHT + BORDER_HEIGHT + MANAGER_HEIGHT
    } else if (showSearchPanel) {
      const nextPanelHeight = Math.min(SEARCH_PANEL_MAX_HEIGHT, Math.max(0, pluginListHeight))
      height = SEARCH_BOX_HEIGHT + BORDER_HEIGHT + nextPanelHeight
    }
    window.mulby.window.setExpendHeight(height, allowResize)

    const hasInput = query.length > 0 || attachments.length > 0
    if (hasInput && lastHeightRef.current !== height) {
      lastHeightRef.current = height

    } else if (!hasInput) {
      lastHeightRef.current = null
    }
  }, [query, pluginOpen, detailsPluginName, attachments.length, attachmentsManagerOpen, managerMetrics.managerHeight, pluginListHeight, viewMode, perfTrace.id, perfTrace.startedAt])

  const handlePluginListHeightChange = useCallback((height: number) => {
    const normalized = Math.max(0, Math.round(height))
    setPluginListHeight((prev) => (prev === normalized ? prev : normalized))
  }, [])

  // 监听插件附着事件
  useEffect(() => {
    const cleanupAttach = window.mulby.onPluginAttach((_data: PluginInfo) => {
      setPluginOpen(true)
    })

    const cleanupDetached = window.mulby.onPluginDetached(() => {
      setPluginOpen(false)
      // 插件关闭后，让搜索框重新获取焦点
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    })

    return () => {
      cleanupAttach()
      cleanupDetached()
    }
  }, [])

  useEffect(() => {
    if (attachments.length === 0 && attachmentsManagerOpen) {
      setAttachmentsManagerOpen(false)
    }
  }, [attachments.length, attachmentsManagerOpen])

  useEffect(() => {
    if (pluginOpen && attachmentsManagerOpen) {
      setAttachmentsManagerOpen(false)
    }
  }, [pluginOpen, attachmentsManagerOpen])

  const openSettings = useCallback((section: SettingsSection = 'general', commandHint?: string) => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setSettingsSection(section)
    setShortcutCommandHint(commandHint?.trim() || '')
    setViewMode('settings')
  }, [pluginOpen])

  const openPluginManager = useCallback((from: 'home' | 'settings' = 'home', section: 'installed' | 'store' = 'installed') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setPluginManagerReturnTarget(from)
    setPluginManagerSection(section)
    setViewMode('plugins')
  }, [pluginOpen])

  const openBackgroundPluginManager = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setBackgroundPluginManagerReturnTarget(from)
    setViewMode('background-plugins')
  }, [pluginOpen])

  const openTaskScheduler = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setTaskSchedulerReturnTarget(from)
    setViewMode('task-scheduler')
  }, [pluginOpen])

  const openLogViewer = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setLogViewerReturnTarget(from)
    setViewMode('logs')
  }, [pluginOpen])

  const openAiSettingsCenter = useCallback(() => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setViewMode('ai-settings')
  }, [pluginOpen])

  // ESC 键分级退出处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (viewMode !== 'home') {
          setViewMode('home')
          setDetailsPluginName(null)
        } else if (attachmentsManagerOpen) {
          setAttachmentsManagerOpen(false)
        } else if (pluginOpen) {
          // 1. 优先关闭插件
          window.mulby.window.close()
        } else if (query.length > 0) {
          // 2. 清空搜索框与附件
          setQuery('')
          clearAttachments()
          setResultCount(0)
          setDetailsPluginName(null)
        } else if (attachments.length > 0) {
          // 3. 清空附件
          clearAttachments()
          setResultCount(0)
        } else {
          // 4. 隐藏窗口
          window.mulby.window.hide()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pluginOpen, query, attachments.length, attachmentsManagerOpen, viewMode])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        openSettings()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openSettings])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenSettings(() => {
      openSettings()
    })
    return cleanup
  }, [openSettings])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenCommandShortcuts((payload) => {
      openSettings('commandQuickLaunch', payload?.cmdLabel)
    })
    return cleanup
  }, [openSettings])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenPluginStore(() => {
      openPluginManager('home', 'store')
    })
    return cleanup
  }, [openPluginManager])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenPluginManager(() => {
      openPluginManager('home')
    })
    return cleanup
  }, [openPluginManager])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenAiSettings(() => {
      openAiSettingsCenter()
    })
    return cleanup
  }, [openAiSettingsCenter])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenBackgroundPlugins(() => {
      openBackgroundPluginManager('home')
    })
    return cleanup
  }, [openBackgroundPluginManager])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenTaskScheduler(() => {
      openTaskScheduler('home')
    })
    return cleanup
  }, [openTaskScheduler])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenLogViewer(() => {
      openLogViewer('home')
    })
    return cleanup
  }, [openLogViewer])

  const clearAttachments = useCallback(() => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
    setAttachments([])
  }, [attachments])

  // 监听自动粘贴事件
  useEffect(() => {
    if (!window.mulbyMain?.clipboard) return

    const cleanup = window.mulbyMain.clipboard.onAutoPaste(async () => {
      // 条件1：没有打开插件
      if (pluginOpen) {
        return
      }

      // 执行自动粘贴
      try {
        const format = await window.mulby.clipboard.getFormat()

        if (format === 'text') {
          // 粘贴文本 - 清空附件
          const text = await window.mulby.clipboard.readText()
          if (text && text.trim()) {
            // 清空旧的附件
            if (attachments.length > 0) {
              clearAttachments()
            }
            // 设置文本（如果搜索框为空，或者覆盖旧文本）
            setQuery(text)
            beginPerfTrace('text', text.length, 0)
          }
        } else if (format === 'image') {
          // 粘贴图片 - 总是替换附件
          const imageBuffer = await window.mulby.clipboard.readImage()
          if (imageBuffer) {
            // 清理旧的附件
            clearAttachments()

            const uint8Array = new Uint8Array(imageBuffer)
            const blob = new Blob([uint8Array], { type: 'image/png' })
            const file = new File([blob], 'clipboard.png', { type: 'image/png' })
            const dataUrl = await readFileAsDataUrl(file)
            const previewUrl = URL.createObjectURL(blob)

            const attachment: UiAttachment = {
              id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              name: 'clipboard.png',
              size: blob.size,
              kind: 'image',
              mime: 'image/png',
              ext: '.png',
              dataUrl,
              previewUrl
            }
            setAttachments([attachment])
            // 清空搜索框，让用户专注于附件
            setQuery('')
            beginPerfTrace('attachments', 0, 1)
          }
        } else if (format === 'files') {
          // 粘贴文件 - 总是替换附件
          const files = await window.mulby.clipboard.readFiles()
          if (files && files.length > 0) {
            // 清理旧的附件
            clearAttachments()

            const newAttachments: UiAttachment[] = files.map(file => ({
              id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              name: file.name,
              size: file.size,
              kind: file.isDirectory ? 'file' : (file.type?.startsWith('image/') ? 'image' : 'file'),
              mime: file.type,
              path: file.path
            }))
            setAttachments(newAttachments)
            // 清空搜索框，让用户专注于附件
            setQuery('')
            beginPerfTrace('attachments', 0, newAttachments.length)
          }
        }
      } catch (err) {
        console.error('Auto paste failed:', err)
      }
    })

    return cleanup
  }, [query, pluginOpen, clearAttachments, attachments.length, beginPerfTrace])

  const handleQueryChange = (value: string) => {
    // 如果有附着的插件，先关闭它
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    if (attachmentsManagerOpen) {
      setAttachmentsManagerOpen(false)
    }
    beginPerfTrace('text', value.length, attachments.length)
    setQuery(value)
    if (value.length === 0 && attachments.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
      setViewMode('home')
    }
  }

  const handleAttachmentsChange = (next: UiAttachment[]) => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    beginPerfTrace('attachments', query.length, next.length)
    setAttachments(next)
    if (next.length === 0 && query.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
      setViewMode('home')
    }
  }

  // 拖拽安装插件
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files || []) as DroppedFile[]
    const pluginFile = files.find(isInpluginFile)
    if (!pluginFile) return

    if (!pluginFile.path) {
      window.mulby.notification.show('无法读取插件包路径，请从本地文件管理器拖放 .inplugin 文件', 'error')
      return
    }

    try {
      const result = await window.mulby.plugin.install(pluginFile.path)
      if (result.success) {
        if (result.action === 'already-installed') {
          window.mulby.notification.show(`插件 ${result.pluginName} 已是当前版本`)
        } else if (result.action === 'updated') {
          window.mulby.notification.show(`插件 ${result.pluginName} 更新成功`)
        } else {
          window.mulby.notification.show(`插件 ${result.pluginName} 安装成功`)
        }
      } else {
        window.mulby.notification.show(result.error || '安装失败', 'error')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '安装失败'
      window.mulby.notification.show(message, 'error')
    }
  }

  if (viewMode === 'plugin-details' && detailsPluginName) {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <PluginDetails
          pluginName={detailsPluginName}
          onBack={() => {
            setDetailsPluginName(null)
            setViewMode(detailsReturnTarget === 'settings' ? 'settings' : detailsReturnTarget === 'plugins' ? 'plugins' : 'home')
          }}
        />
      </div>
    )
  }

  if (viewMode === 'settings') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <SettingsView
          section={settingsSection}
          shortcutCommandHint={shortcutCommandHint}
          onShortcutCommandHintConsumed={() => setShortcutCommandHint('')}
          onPrepareCommandLaunch={async () => {
            setViewMode('home')
            await new Promise<void>((resolve) => setTimeout(resolve, 120))
          }}
          onSectionChange={setSettingsSection}
          onClose={() => setViewMode('home')}
          onOpenPluginManager={(section = 'installed') => {
            openPluginManager('settings', section)
          }}
          onOpenBackgroundPluginManager={() => {
            openBackgroundPluginManager('settings')
          }}
          onOpenTaskScheduler={() => {
            openTaskScheduler('settings')
          }}
          onOpenLogViewer={() => {
            openLogViewer('settings')
          }}
          onOpenAiSettings={openAiSettingsCenter}
        />
      </div>
    )
  }

  if (viewMode === 'ai-settings') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <AiSettingsView
          onBack={() => setViewMode('settings')}
          onOpenMcpSettings={() => setViewMode('ai-mcp-settings')}
          onOpenSkillsSettings={() => setViewMode('ai-skills-settings')}
        />
      </div>
    )
  }

  if (viewMode === 'ai-mcp-settings') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <AiMcpSettingsView
          onBack={() => setViewMode('ai-settings')}
        />
      </div>
    )
  }

  if (viewMode === 'ai-skills-settings') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <AiSkillsSettingsView
          onBack={() => setViewMode('ai-settings')}
        />
      </div>
    )
  }

  if (viewMode === 'plugins') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <PluginManagerView
          initialSection={pluginManagerSection}
          onBack={() => setViewMode(pluginManagerReturnTarget === 'settings' ? 'settings' : 'home')}
        />
      </div>
    )
  }

  if (viewMode === 'background-plugins') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <BackgroundPluginManagerView
          onBack={() => setViewMode(backgroundPluginManagerReturnTarget === 'settings' ? 'settings' : 'home')}
        />
      </div>
    )
  }

  if (viewMode === 'task-scheduler') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <TaskSchedulerView
          onBack={() => setViewMode(taskSchedulerReturnTarget === 'settings' ? 'settings' : 'home')}
        />
      </div>
    )
  }

  if (viewMode === 'logs') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <LogViewerView onClose={() => setViewMode(logViewerReturnTarget === 'settings' ? 'settings' : 'home')} />
      </div>
    )
  }

  const showAttachmentManager = attachmentsManagerOpen && attachments.length > 0
  const showPluginList = (query.length > 0 || attachments.length > 0) && !pluginOpen && !showAttachmentManager
  const hasBottomPanel = showAttachmentManager || showPluginList

  return (
    <div
      className={`app app-home ${isDragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!isDragging) {
          setIsDragging(true)
        }
      }}
      onDragLeave={(e) => {
        const nextTarget = e.relatedTarget as Node | null
        if (nextTarget && e.currentTarget.contains(nextTarget)) return
        setIsDragging(false)
      }}
      onDrop={handleDrop}
    >
      <div className={`search-box-container ${hasBottomPanel ? 'with-bottom-panel' : ''}`}>
        <SearchInput
          ref={searchInputRef}
          value={query}
          onChange={handleQueryChange}
          attachments={attachments}
          onAttachmentsChange={handleAttachmentsChange}
          attachmentsManagerOpen={attachmentsManagerOpen}
          onAttachmentsManagerOpen={() => {
            if (pluginOpen) {
              window.mulby.window.close()
              setPluginOpen(false)
            }
            setAttachmentsManagerOpen(true)
          }}
          onAttachmentsManagerClose={() => setAttachmentsManagerOpen(false)}
        />
        {pluginOpen && (
          <div className="plugin-controls">
            <button
              className="plugin-control-btn plugin-reload-btn"
              onClick={() => {
                window.mulby.window.reload()
              }}
              title="重载插件"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
            <button
              className="plugin-control-btn plugin-detach-btn"
              onClick={() => {
                window.mulby.window.detach()
              }}
              title="转为独立窗口"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 9V3h-6M3 15v6h6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
            <button
              className="plugin-control-btn plugin-close-btn"
              onClick={() => {
                window.mulby.window.close()
                setPluginOpen(false)
                // 关闭插件后，让搜索框重新获取焦点
                setTimeout(() => {
                  searchInputRef.current?.focus()
                }, 100)
              }}
              title="关闭插件"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {showAttachmentManager && (
        <AttachmentManager
          attachments={attachments}
          onAttachmentsChange={handleAttachmentsChange}
          onClose={() => setAttachmentsManagerOpen(false)}
          listMaxHeight={managerMetrics.listHeight}
        />
      )}
      {showPluginList && (
        <PluginList
          payload={payload}
          traceId={perfTrace.id}
          traceStartedAt={perfTrace.startedAt}
          traceSource={perfTrace.source}
          traceInputLength={perfTrace.textLength}
          traceAttachmentCount={perfTrace.attachmentCount}
          onResultsChange={setResultCount}
          onPanelHeightChange={handlePluginListHeightChange}
          onShowDetails={(pluginName) => {
            setDetailsPluginName(pluginName)
            setDetailsReturnTarget('home')
            setViewMode('plugin-details')
          }}
          onOpenSettings={() => openSettings()}
        />
      )}
      {isDragging && <div className="drop-hint">拖放 .inplugin 文件安装插件</div>}
    </div>
  )
}

type UiAttachment = InputAttachment & { previewUrl?: string }

function buildPayload(text: string, attachments: UiAttachment[]): InputPayload {
  return {
    text,
    attachments: attachments.map(({ previewUrl, ...rest }) => rest)
  }
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

export default App
