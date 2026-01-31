import { useState, useEffect, useMemo, useCallback, useDeferredValue } from 'react'
import SearchInput from './components/SearchInput'
import PluginList from './components/PluginList'
import PluginDetails from './components/PluginDetails'
import PluginManagerView from './components/PluginManagerView'
import BackgroundPluginManagerView from './components/BackgroundPluginManagerView'
import TaskSchedulerView from './components/TaskSchedulerView'
import AttachmentManager from './components/AttachmentManager'
import SettingsView, { SettingsSection } from './components/SettingsView'
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

function App() {
  const [query, setQuery] = useState('')
  const [resultCount, setResultCount] = useState(0)
  const [pluginOpen, setPluginOpen] = useState(false) // 仅用于跟踪插件是否打开
  const [detailsPluginName, setDetailsPluginName] = useState<string | null>(null)
  const [detailsReturnTarget, setDetailsReturnTarget] = useState<'home' | 'settings' | 'plugins'>('home')
  const [viewMode, setViewMode] = useState<'home' | 'plugin-details' | 'settings' | 'plugins' | 'logs' | 'background-plugins' | 'task-scheduler'>('home')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [pluginManagerReturnTarget, setPluginManagerReturnTarget] = useState<'home' | 'settings'>('home')
  const [backgroundPluginManagerReturnTarget, setBackgroundPluginManagerReturnTarget] = useState<'home' | 'settings'>('home')
  const [taskSchedulerReturnTarget, setTaskSchedulerReturnTarget] = useState<'home' | 'settings'>('home')
  const [isDragging, setIsDragging] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [attachments, setAttachments] = useState<UiAttachment[]>([])
  const [attachmentsManagerOpen, setAttachmentsManagerOpen] = useState(false)
  const payload = useMemo(() => buildPayload(query, attachments), [query, attachments])
  const deferredPayload = useDeferredValue(payload)

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
    window.intools.theme.getActual().then(setTheme)
    const cleanup = window.intools.onThemeChange(setTheme)
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
    const EXPANDED_HEIGHT = 550
    const SYSTEM_PAGE_HEIGHT = 800
    const MANAGER_HEIGHT = managerMetrics.managerHeight

    let height = SEARCH_BOX_HEIGHT
    let allowResize = false

    if (viewMode !== 'home') {
      // 设置/详情页高度，允许自由调整大小
      height = SYSTEM_PAGE_HEIGHT
      allowResize = true
    } else if (pluginOpen) {
      // 插件面板打开时，主窗口只保持搜索框高度（插件 UI 在独立的 Panel 窗口中）
      height = SEARCH_BOX_HEIGHT
    } else if (attachmentsManagerOpen && attachments.length > 0) {
      height = SEARCH_BOX_HEIGHT + BORDER_HEIGHT + MANAGER_HEIGHT
    } else if ((query.length > 0 || attachments.length > 0) && resultCount > 0) {
      height = EXPANDED_HEIGHT
    }
    window.intools.window.setExpendHeight(height, allowResize)
  }, [query, resultCount, pluginOpen, detailsPluginName, attachments.length, attachmentsManagerOpen, managerMetrics.managerHeight, viewMode])

  // 监听插件附着事件
  useEffect(() => {
    const cleanupAttach = window.intools.onPluginAttach((_data: PluginInfo) => {
      setPluginOpen(true)
    })

    const cleanupDetached = window.intools.onPluginDetached(() => {
      setPluginOpen(false)
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

  const openSettings = useCallback((section: SettingsSection = 'general') => {
    if (pluginOpen) {
      window.intools.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setSettingsSection(section)
    setViewMode('settings')
  }, [pluginOpen])

  const openPluginManager = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.intools.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setPluginManagerReturnTarget(from)
    setViewMode('plugins')
  }, [pluginOpen])

  const openBackgroundPluginManager = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.intools.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setBackgroundPluginManagerReturnTarget(from)
    setViewMode('background-plugins')
  }, [pluginOpen])

  const openTaskScheduler = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.intools.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    setTaskSchedulerReturnTarget(from)
    setViewMode('task-scheduler')
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
          window.intools.window.close()
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
          window.intools.window.hide()
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
    const cleanup = window.intools.app.onOpenSettings(() => {
      openSettings()
    })
    return cleanup
  }, [openSettings])

  useEffect(() => {
    const cleanup = window.intools.app.onOpenPluginStore(() => {
      openSettings('store')
    })
    return cleanup
  }, [openSettings])

  useEffect(() => {
    const cleanup = window.intools.app.onOpenPluginManager(() => {
      openPluginManager('home')
    })
    return cleanup
  }, [openPluginManager])

  const handleQueryChange = (value: string) => {
    // 如果有附着的插件，先关闭它
    if (pluginOpen) {
      window.intools.window.close()
      setPluginOpen(false)
    }
    if (attachmentsManagerOpen) {
      setAttachmentsManagerOpen(false)
    }
    setQuery(value)
    if (value.length === 0 && attachments.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
      setViewMode('home')
    }
  }

  const handleAttachmentsChange = (next: UiAttachment[]) => {
    if (pluginOpen) {
      window.intools.window.close()
      setPluginOpen(false)
    }
    setAttachments(next)
    if (next.length === 0 && query.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
      setViewMode('home')
    }
  }

  const clearAttachments = () => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
    setAttachments([])
  }

  // 拖拽安装插件
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file?.path?.endsWith('.inplugin')) {
      const result = await window.intools.plugin.install(file.path)
      if (result.success) {
        window.intools.notification.show(`插件 ${result.pluginName} 安装成功`)
      } else {
        window.intools.notification.show(result.error || '安装失败', 'error')
      }
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
          onSectionChange={setSettingsSection}
          onClose={() => setViewMode('home')}
          onOpenPluginManager={() => {
            openPluginManager('settings')
          }}
          onOpenBackgroundPluginManager={() => {
            openBackgroundPluginManager('settings')
          }}
          onOpenTaskScheduler={() => {
            openTaskScheduler('settings')
          }}
          onOpenLogViewer={() => setViewMode('logs')}
        />
      </div>
    )
  }

  if (viewMode === 'plugins') {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <PluginManagerView
          onBack={() => setViewMode(pluginManagerReturnTarget === 'settings' ? 'settings' : 'home')}
          onOpenPluginDetails={(pluginName) => {
            setDetailsPluginName(pluginName)
            setDetailsReturnTarget('plugins')
            setViewMode('plugin-details')
          }}
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
        <LogViewerView onClose={() => setViewMode('settings')} />
      </div>
    )
  }


  return (
    <div
      className={`app app-home ${isDragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <SearchInput
        value={query}
        onChange={handleQueryChange}
        attachments={attachments}
        onAttachmentsChange={handleAttachmentsChange}
        attachmentsManagerOpen={attachmentsManagerOpen}
        onAttachmentsManagerOpen={() => {
          if (pluginOpen) {
            window.intools.window.close()
            setPluginOpen(false)
          }
          setAttachmentsManagerOpen(true)
        }}
        onAttachmentsManagerClose={() => setAttachmentsManagerOpen(false)}
      />
      {attachmentsManagerOpen && attachments.length > 0 && (
        <AttachmentManager
          attachments={attachments}
          onAttachmentsChange={handleAttachmentsChange}
          onClose={() => setAttachmentsManagerOpen(false)}
          listMaxHeight={managerMetrics.listHeight}
        />
      )}
      {(query.length > 0 || attachments.length > 0) && !pluginOpen && !attachmentsManagerOpen && (
        <PluginList
          payload={deferredPayload}
          onResultsChange={setResultCount}
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

export default App
