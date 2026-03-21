import {
  Suspense,
  lazy,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import SearchInput, { SearchInputRef } from './components/SearchInput'
import PluginList from './components/PluginList'
import AttachmentManager from './components/AttachmentManager'
import { shouldUseSummaryText } from './utils/summary-text'
import type { SettingsSection } from './components/SettingsView'
import { DEFAULT_SYSTEM_PLUGIN_ROUTE, type SystemPluginRoute } from './system-plugins/types'
import type { InputAttachment, InputPayload } from '../shared/types/plugin'
import type { OpenSystemPluginPayload, SystemPluginBeforeAttachPayload } from '../shared/types/electron'
import type { PluginStoreEntry } from '../shared/types/plugin-store'

const PluginDetails = lazy(() => import('./components/PluginDetails'))
const PluginManagerView = lazy(() => import('./components/PluginManagerView'))
const PluginStoreView = lazy(() => import('./components/PluginStoreView'))
const PluginStoreDetailsView = lazy(() => import('./components/PluginStoreDetailsView'))
const BackgroundPluginManagerView = lazy(() => import('./components/BackgroundPluginManagerView'))
const TaskSchedulerView = lazy(() => import('./components/TaskSchedulerView'))
const AiSettingsView = lazy(() => import('./components/AiSettingsView'))
const AiMcpSettingsView = lazy(() => import('./components/AiMcpSettingsView'))
const AiSkillsSettingsView = lazy(() => import('./components/AiSkillsSettingsView'))
const LogViewerView = lazy(() => import('./components/LogViewerView'))
const SystemPluginHost = lazy(() => import('./system-plugins/SystemPluginHost'))
const OnboardingView = lazy(() => import('./components/OnboardingView'))

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

const SETTINGS_SECTION_SET = new Set<SettingsSection>([
  'dashboard',
  'general',
  'commandQuickLaunch',
  'commandAll',
  'permissions',
  'security',
  'developer',
  'about'
])

function parseSettingsSection(value: unknown): SettingsSection | null {
  if (typeof value !== 'string') return null
  // 兼容旧的 'shortcuts' 深链接，快捷键设置已合并到通用面板
  if (value === 'shortcuts') return 'general'
  if (SETTINGS_SECTION_SET.has(value as SettingsSection)) {
    return value as SettingsSection
  }
  return null
}

function LazyViewFrame({ isDragging, children }: { isDragging: boolean; children: ReactNode }) {
  return (
    <div className={`app ${isDragging ? 'dragging' : ''}`}>
      <Suspense
        fallback={
          <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            正在载入页面...
          </div>
        }
      >
        {children}
      </Suspense>
    </div>
  )
}

type ViewMode =
  | 'home'
  | 'plugin-details'
  | 'system-plugin'
  | 'plugins'
  | 'plugin-store'
  | 'plugin-store-details'
  | 'logs'
  | 'background-plugins'
  | 'task-scheduler'
  | 'ai-settings'
  | 'ai-mcp-settings'
  | 'ai-skills-settings'

interface SystemWindowBootstrap {
  isSystemWindow: boolean
  initialViewMode: ViewMode
  initialSystemPluginRoute: SystemPluginRoute
}

interface SystemPageState {
  open: boolean
  mode: 'none' | 'attached' | 'detached'
  page: string | null
  title: string
}

type WindowResizeEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left'

const MAIN_WINDOW_RESIZE_EDGES: WindowResizeEdge[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left'
]

function parseSystemWindowBootstrap(): SystemWindowBootstrap {
  const params = new URLSearchParams(window.location.search)
  const isSystemWindow = params.get('mulbySystemWindow') === '1'
  if (!isSystemWindow) {
    return {
      isSystemWindow: false,
      initialViewMode: 'home',
      initialSystemPluginRoute: DEFAULT_SYSTEM_PLUGIN_ROUTE
    }
  }

  const page = params.get('mulbySystemPage')
  const section = parseSettingsSection(params.get('mulbySystemSection')) || 'dashboard'
  const shortcutCommandHint = params.get('mulbySystemHint') || ''

  let initialViewMode: ViewMode = 'home'

  switch (page) {
    case 'settings':
      initialViewMode = 'system-plugin'
      break
    case 'plugin-manager':
      initialViewMode = 'plugins'
      break
    case 'plugin-store':
      initialViewMode = 'plugin-store'
      break
    case 'background-plugins':
      initialViewMode = 'background-plugins'
      break
    case 'task-scheduler':
      initialViewMode = 'task-scheduler'
      break
    case 'log-viewer':
      initialViewMode = 'logs'
      break
    case 'ai-settings':
      initialViewMode = 'ai-settings'
      break
    case 'ai-mcp-settings':
      initialViewMode = 'ai-mcp-settings'
      break
    case 'ai-skills-settings':
      initialViewMode = 'ai-skills-settings'
      break
    default:
      initialViewMode = 'home'
      break
  }

  return {
    isSystemWindow: true,
    initialViewMode,
    initialSystemPluginRoute: {
      pluginId: 'settings-center',
      params: {
        section,
        shortcutCommandHint
      }
    }
  }
}

function App() {
  // 检测引导模式：?mulbyOnboarding=1
  const isOnboarding = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('mulbyOnboarding') === '1'
  }, [])

  if (isOnboarding) {
    return (
      <Suspense fallback={null}>
        <OnboardingView />
      </Suspense>
    )
  }

  return <MainApp />
}

function MainApp() {
  const systemWindowBootstrap = useMemo(() => parseSystemWindowBootstrap(), [])
  const isSystemWindow = systemWindowBootstrap.isSystemWindow
  const [query, setQuery] = useState('')
  const [payloadText, setPayloadText] = useState('')
  const [, setResultCount] = useState(0)
  const [systemPageState, setSystemPageState] = useState<SystemPageState>({
    open: false,
    mode: 'none',
    page: null,
    title: ''
  })
  const [pluginOpen, setPluginOpen] = useState(false) // 仅用于跟踪插件是否打开
  const [detailsPluginName, setDetailsPluginName] = useState<string | null>(null)
  const [detailsReturnTarget, setDetailsReturnTarget] = useState<'home' | 'settings' | 'plugins'>('home')
  const [viewMode, setViewMode] = useState<ViewMode>(systemWindowBootstrap.initialViewMode)
  const [systemPluginRoute, setSystemPluginRoute] = useState<SystemPluginRoute>(systemWindowBootstrap.initialSystemPluginRoute)
  const [pluginManagerReturnTarget, setPluginManagerReturnTarget] = useState<'home' | 'settings'>('home')
  const [pluginStoreReturnTarget, setPluginStoreReturnTarget] = useState<'home' | 'settings' | 'plugins'>('home')
  const [selectedStoreEntry, setSelectedStoreEntry] = useState<PluginStoreEntry | null>(null)
  const [backgroundPluginManagerReturnTarget, setBackgroundPluginManagerReturnTarget] = useState<'home' | 'settings'>('home')
  const [taskSchedulerReturnTarget, setTaskSchedulerReturnTarget] = useState<'home' | 'settings'>('home')
  const [logViewerReturnTarget, setLogViewerReturnTarget] = useState<'home' | 'settings'>('home')
  const [isDragging, setIsDragging] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [attachments, setAttachments] = useState<UiAttachment[]>([])
  const [attachmentsManagerOpen, setAttachmentsManagerOpen] = useState(false)
  const [pluginListHeight, setPluginListHeight] = useState(240)
  const [isWindowsMain, setIsWindowsMain] = useState(false)
  const searchText = query.length > 0 ? query : payloadText
  const runText = payloadText || query
  const searchPayload = useMemo(() => buildPayload(searchText, attachments), [searchText, attachments])
  const runPayload = useMemo(() => buildPayload(runText, attachments), [runText, attachments])
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
  const resizeAnimationFrameRef = useRef<number | null>(null)

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

  const systemPageAttached = !isSystemWindow && systemPageState.open && systemPageState.mode === 'attached'
  const hasTextInput = query.length > 0 || payloadText.length > 0

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

  useEffect(() => {
    let mounted = true
    void window.mulby.system.isWindows().then((isWindows) => {
      if (!mounted) return
      const nextIsWindowsMain = isWindows && !isSystemWindow
      setIsWindowsMain(nextIsWindowsMain)
      document.documentElement.classList.toggle('platform-win-main', nextIsWindowsMain)
    }).catch(() => {
      if (!mounted) return
      setIsWindowsMain(false)
      document.documentElement.classList.remove('platform-win-main')
    })
    return () => {
      mounted = false
      setIsWindowsMain(false)
      document.documentElement.classList.remove('platform-win-main')
    }
  }, [isSystemWindow])

  useEffect(() => {
    return () => {
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current)
      }
    }
  }, [])

  const beginMainWindowResize = useCallback((edge: WindowResizeEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const target = event.currentTarget
    const baseBounds = {
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight
    }

    const state = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY
    }

    const flushResize = () => {
      resizeAnimationFrameRef.current = null
      window.mulby.window.resizeDrag({
        edge,
        startX: state.startX,
        startY: state.startY,
        currentX: state.lastX,
        currentY: state.lastY,
        baseBounds
      })
    }

    const cleanup = () => {
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current)
        resizeAnimationFrameRef.current = null
      }
      target.removeEventListener('pointermove', onPointerMove)
      target.removeEventListener('pointerup', onPointerUp)
      target.removeEventListener('pointercancel', onPointerCancel)
      if (target.hasPointerCapture(state.pointerId)) {
        target.releasePointerCapture(state.pointerId)
      }
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== state.pointerId) return
      state.lastX = moveEvent.screenX
      state.lastY = moveEvent.screenY
      if (resizeAnimationFrameRef.current !== null) return
      resizeAnimationFrameRef.current = window.requestAnimationFrame(flushResize)
    }

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== state.pointerId) return
      state.lastX = upEvent.screenX
      state.lastY = upEvent.screenY
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current)
        resizeAnimationFrameRef.current = null
      }
      flushResize()
      cleanup()
    }

    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== state.pointerId) return
      cleanup()
    }

    event.preventDefault()
    event.stopPropagation()
    target.setPointerCapture(state.pointerId)
    target.addEventListener('pointermove', onPointerMove)
    target.addEventListener('pointerup', onPointerUp)
    target.addEventListener('pointercancel', onPointerCancel)
  }, [])

  useEffect(() => {
    if (isSystemWindow) return
    let mounted = true
    window.mulby.systemPage.getState().then((state) => {
      if (!mounted) return
      setSystemPageState(state)
    }).catch(() => {
      // ignore
    })
    const cleanup = window.mulby.systemPage.onStateChange((state) => {
      setSystemPageState(state)
    })
    return () => {
      mounted = false
      cleanup()
    }
  }, [isSystemWindow])

  // 调整窗口高度
  useEffect(() => {
    if (isSystemWindow) {
      return
    }
    const SEARCH_BOX_HEIGHT = 62
    const BORDER_HEIGHT = 1
    const EXPANDED_HEIGHT = 800
    const SEARCH_PANEL_MAX_HEIGHT = EXPANDED_HEIGHT - SEARCH_BOX_HEIGHT - BORDER_HEIGHT
    const SYSTEM_PAGE_HEIGHT = 800
    const MANAGER_HEIGHT = managerMetrics.managerHeight

    let height = SEARCH_BOX_HEIGHT
    let allowResize = false
    const showSearchPanel = (hasTextInput || attachments.length > 0)
      && !pluginOpen
      && !systemPageAttached
      && !attachmentsManagerOpen

    if (viewMode !== 'home') {
      // 设置/详情页高度，允许自由调整大小
      height = SYSTEM_PAGE_HEIGHT
      allowResize = true
    } else if (pluginOpen) {
      // 插件面板打开时，主窗口只保持搜索框高度（插件 UI 在独立的 Panel 窗口中）
      height = SEARCH_BOX_HEIGHT
    } else if (systemPageAttached) {
      // 系统页面附着模式打开时，主窗口保持搜索框高度
      height = SEARCH_BOX_HEIGHT
    } else if (attachmentsManagerOpen && attachments.length > 0) {
      height = SEARCH_BOX_HEIGHT + BORDER_HEIGHT + MANAGER_HEIGHT
    } else if (showSearchPanel) {
      const nextPanelHeight = Math.min(SEARCH_PANEL_MAX_HEIGHT, Math.max(0, pluginListHeight))
      height = SEARCH_BOX_HEIGHT + BORDER_HEIGHT + nextPanelHeight
    }
    window.mulby.window.setExpendHeight(height, allowResize)

    const hasInput = hasTextInput || attachments.length > 0
    if (hasInput && lastHeightRef.current !== height) {
      lastHeightRef.current = height

    } else if (!hasInput) {
      lastHeightRef.current = null
    }
  }, [isSystemWindow, hasTextInput, pluginOpen, systemPageAttached, detailsPluginName, attachments.length, attachmentsManagerOpen, managerMetrics.managerHeight, pluginListHeight, viewMode, perfTrace.id, perfTrace.startedAt])

  const handlePluginListHeightChange = useCallback((height: number) => {
    const normalized = Math.max(0, Math.round(height))
    setPluginListHeight((prev) => (prev === normalized ? prev : normalized))
  }, [])

  // 监听插件附着事件
  useEffect(() => {
    const cleanupAttach = window.mulby.onPluginAttach((_data: PluginInfo) => {
      if (systemPageAttached) {
        void window.mulby.systemPage.close()
      }
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
  }, [systemPageAttached])

  useEffect(() => {
    if (attachments.length === 0 && attachmentsManagerOpen) {
      setAttachmentsManagerOpen(false)
    }
  }, [attachments.length, attachmentsManagerOpen])

  useEffect(() => {
    if ((pluginOpen || systemPageAttached) && attachmentsManagerOpen) {
      setAttachmentsManagerOpen(false)
    }
  }, [pluginOpen, systemPageAttached, attachmentsManagerOpen])

  useEffect(() => {
    if (pluginOpen && systemPageAttached) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
  }, [pluginOpen, systemPageAttached])

  const openSettings = useCallback((section: SettingsSection = 'dashboard', commandHint?: string) => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({
        page: 'settings',
        settingsSection: section,
        shortcutCommandHint: commandHint?.trim() || ''
      })
      return
    }
    setSystemPluginRoute({
      pluginId: 'settings-center',
      params: {
        section,
        shortcutCommandHint: commandHint?.trim() || ''
      }
    })
    setViewMode('system-plugin')
  }, [isSystemWindow, pluginOpen])

  const showSearchSettingsButton =
    query.trim().length === 0 &&
    payloadText.trim().length === 0 &&
    attachments.length === 0 &&
    !pluginOpen &&
    !systemPageAttached

  const openPluginStore = useCallback((from: 'home' | 'settings' | 'plugins' = 'home') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'plugin-store' })
      return
    }
    setPluginStoreReturnTarget(from)
    setSelectedStoreEntry(null)
    setViewMode('plugin-store')
  }, [isSystemWindow, pluginOpen])

  const openPluginManager = useCallback((from: 'home' | 'settings' = 'home', section: 'installed' | 'store' = 'installed') => {
    if (section === 'store') {
      openPluginStore(from)
      return
    }
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'plugin-manager' })
      return
    }
    setPluginManagerReturnTarget(from)
    setViewMode('plugins')
  }, [isSystemWindow, openPluginStore, pluginOpen])

  const openBackgroundPluginManager = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'background-plugins' })
      return
    }
    setBackgroundPluginManagerReturnTarget(from)
    setViewMode('background-plugins')
  }, [isSystemWindow, pluginOpen])

  const openTaskScheduler = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'task-scheduler' })
      return
    }
    setTaskSchedulerReturnTarget(from)
    setViewMode('task-scheduler')
  }, [isSystemWindow, pluginOpen])

  const openLogViewer = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'log-viewer' })
      return
    }
    setLogViewerReturnTarget(from)
    setViewMode('logs')
  }, [isSystemWindow, pluginOpen])

  const openAiSettingsCenter = useCallback(() => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'ai-settings' })
      return
    }
    setViewMode('ai-settings')
  }, [isSystemWindow, pluginOpen])

  const openAiMcpSettings = useCallback(() => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'ai-mcp-settings' })
      return
    }
    setViewMode('ai-mcp-settings')
  }, [isSystemWindow, pluginOpen])

  const openAiSkillsSettings = useCallback(() => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'ai-skills-settings' })
      return
    }
    setViewMode('ai-skills-settings')
  }, [isSystemWindow, pluginOpen])

  const clearAttachments = useCallback(() => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
    setAttachments([])
  }, [attachments])

  // ESC 键分级退出处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (viewMode !== 'home') {
          if (isSystemWindow) {
            void window.mulby.systemPage.close()
            return
          }
          setViewMode('home')
          setDetailsPluginName(null)
        } else if (attachmentsManagerOpen) {
          setAttachmentsManagerOpen(false)
        } else if (pluginOpen) {
          // 1. 优先关闭插件
          window.mulby.window.close()
        } else if (systemPageAttached) {
          // 2. 关闭附着的系统页面
          void window.mulby.systemPage.close()
        } else if (hasTextInput) {
          // 3. 清空搜索框与附件
          setQuery('')
          setPayloadText('')
          clearAttachments()
          setResultCount(0)
          setDetailsPluginName(null)
        } else if (attachments.length > 0) {
          // 4. 清空附件
          clearAttachments()
          setResultCount(0)
        } else {
          // 5. 隐藏窗口
          window.mulby.window.hide()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [attachments.length, attachmentsManagerOpen, clearAttachments, hasTextInput, isSystemWindow, pluginOpen, systemPageAttached, viewMode])

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
    const cleanup = window.mulby.app.onOpenSystemPlugin((payload: OpenSystemPluginPayload) => {
      if (!payload || payload.pluginId !== 'settings-center') {
        return
      }
      const params = payload.params || {}
      const section = parseSettingsSection(params.section) || 'dashboard'
      const shortcutHint = typeof params.shortcutCommandHint === 'string'
        ? params.shortcutCommandHint
        : undefined
      openSettings(section, shortcutHint)
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
      openPluginStore('home')
    })
    return cleanup
  }, [openPluginStore])

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
    const cleanup = window.mulby.app.onOpenAiMcpSettings(() => {
      openAiMcpSettings()
    })
    return cleanup
  }, [openAiMcpSettings])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenAiSkillsSettings(() => {
      openAiSkillsSettings()
    })
    return cleanup
  }, [openAiSkillsSettings])

  const collapseSystemPluginForAttach = useCallback(async () => {
    let collapsed = false
    setViewMode((prev) => {
      if (prev === 'system-plugin') {
        collapsed = true
        return 'home'
      }
      return prev
    })
    if (collapsed) {
      await new Promise<void>((resolve) => setTimeout(resolve, 120))
    }
  }, [])

  useEffect(() => {
    const cleanup = window.mulby.app.onSystemPluginBeforeAttach(async (payload: SystemPluginBeforeAttachPayload) => {
      if (!payload?.requestId) return
      await collapseSystemPluginForAttach()
      await window.mulby.systemPlugin.notifyReadyForAttach(payload.requestId)
    })
    return cleanup
  }, [collapseSystemPluginForAttach])

  useEffect(() => {
    if (isSystemWindow) return
    const activePluginId = viewMode === 'system-plugin' ? systemPluginRoute.pluginId : null
    void window.mulby.systemPlugin.setActive(activePluginId)
  }, [isSystemWindow, viewMode, systemPluginRoute.pluginId])

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

  const clearTextInputs = useCallback(() => {
    setQuery('')
    setPayloadText('')
  }, [])

  const applySearchTextInput = useCallback((value: string) => {
    if (shouldUseSummaryText(value)) {
      setPayloadText(value)
      setQuery('')
      return
    }
    setQuery(value)
  }, [])

  const replaceTextInput = useCallback((value: string) => {
    if (shouldUseSummaryText(value)) {
      setPayloadText(value)
      setQuery('')
      return
    }
    setPayloadText('')
    setQuery(value)
  }, [])

  // 监听自动粘贴事件
  useEffect(() => {
    if (!window.mulbyMain?.clipboard) return

    const cleanup = window.mulbyMain.clipboard.onAutoPaste(async () => {
      // 条件1：没有打开插件
      if (pluginOpen || systemPageAttached) {
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
            replaceTextInput(text)
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
            clearTextInputs()
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
            clearTextInputs()
            beginPerfTrace('attachments', 0, newAttachments.length)
          }
        }
      } catch (err) {
        console.error('Auto paste failed:', err)
      }
    })

    return cleanup
  }, [attachments.length, beginPerfTrace, clearAttachments, clearTextInputs, pluginOpen, replaceTextInput, systemPageAttached])

  const handleQueryChange = (value: string) => {
    // 如果有附着的插件，先关闭它
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    if (systemPageAttached) {
      void window.mulby.systemPage.close()
    }
    if (attachmentsManagerOpen) {
      setAttachmentsManagerOpen(false)
    }
    beginPerfTrace('text', value.length, attachments.length)
    applySearchTextInput(value)
    if (value.length === 0 && payloadText.length === 0 && attachments.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
      setViewMode('home')
    }
  }

  const handlePayloadTextChange = useCallback((value: string) => {
    setPayloadText(value)
    if (value.length === 0 && query.length === 0 && attachments.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
      setViewMode('home')
    }
  }, [attachments.length, query.length])

  const handleAttachmentsChange = (next: UiAttachment[]) => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    if (systemPageAttached) {
      void window.mulby.systemPage.close()
    }
    beginPerfTrace('attachments', searchText.length, next.length)
    setAttachments(next)
    if (next.length === 0 && !hasTextInput) {
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
      <LazyViewFrame isDragging={isDragging}>
        <PluginDetails
          pluginName={detailsPluginName}
          onBack={() => {
            setDetailsPluginName(null)
            setViewMode(detailsReturnTarget === 'settings' ? 'system-plugin' : detailsReturnTarget === 'plugins' ? 'plugins' : 'home')
          }}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'system-plugin') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <SystemPluginHost
          route={systemPluginRoute}
          onSectionChange={(section) => {
            setSystemPluginRoute((prev) => ({
              ...prev,
              params: {
                ...prev.params,
                section
              }
            }))
          }}
          onShortcutCommandHintConsumed={() => {
            setSystemPluginRoute((prev) => ({
              ...prev,
              params: {
                ...prev.params,
                shortcutCommandHint: ''
              }
            }))
          }}
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
          onClose={() => {
            if (isSystemWindow) {
              void window.mulby.systemPage.close()
              return
            }
            setViewMode('home')
          }}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'ai-settings') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <AiSettingsView
          onBack={() => setViewMode('system-plugin')}
          onOpenMcpSettings={openAiMcpSettings}
          onOpenSkillsSettings={openAiSkillsSettings}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'ai-mcp-settings') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <AiMcpSettingsView
          onBack={() => setViewMode('ai-settings')}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'ai-skills-settings') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <AiSkillsSettingsView
          onBack={() => setViewMode('ai-settings')}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'plugins') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <PluginManagerView
          onOpenStore={() => openPluginStore('plugins')}
          onBack={() => {
            if (pluginManagerReturnTarget === 'settings') {
              setViewMode('system-plugin')
              return
            }
            if (isSystemWindow) {
              void window.mulby.systemPage.close()
              return
            }
            setViewMode('home')
          }}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'plugin-store') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <PluginStoreView
          onOpenDetails={(entry) => {
            setSelectedStoreEntry(entry)
            setViewMode('plugin-store-details')
          }}
          onBack={() => {
            setSelectedStoreEntry(null)
            if (pluginStoreReturnTarget === 'plugins') {
              setViewMode('plugins')
              return
            }
            if (pluginStoreReturnTarget === 'settings') {
              setViewMode('system-plugin')
              return
            }
            if (isSystemWindow) {
              void window.mulby.systemPage.close()
              return
            }
            setViewMode('home')
          }}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'plugin-store-details' && selectedStoreEntry) {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <PluginStoreDetailsView
          entry={selectedStoreEntry}
          onBack={() => {
            setSelectedStoreEntry(null)
            setViewMode('plugin-store')
          }}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'background-plugins') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <BackgroundPluginManagerView
          onBack={() => {
            if (backgroundPluginManagerReturnTarget === 'settings') {
              setViewMode('system-plugin')
              return
            }
            if (isSystemWindow) {
              void window.mulby.systemPage.close()
              return
            }
            setViewMode('home')
          }}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'task-scheduler') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <TaskSchedulerView
          onBack={() => {
            if (taskSchedulerReturnTarget === 'settings') {
              setViewMode('system-plugin')
              return
            }
            if (isSystemWindow) {
              void window.mulby.systemPage.close()
              return
            }
            setViewMode('home')
          }}
        />
      </LazyViewFrame>
    )
  }

  if (viewMode === 'logs') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <LogViewerView
          onClose={() => {
            if (logViewerReturnTarget === 'settings') {
              setViewMode('system-plugin')
              return
            }
            if (isSystemWindow) {
              void window.mulby.systemPage.close()
              return
            }
            setViewMode('home')
          }}
        />
      </LazyViewFrame>
    )
  }

  const showAttachmentManager = attachmentsManagerOpen && attachments.length > 0
  const showPluginList = (hasTextInput || attachments.length > 0) && !pluginOpen && !systemPageAttached && !showAttachmentManager
  const hasBottomPanel = showAttachmentManager || showPluginList

  return (
    <div
      className={`app-frame ${isDragging ? 'dragging' : ''}`}
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
      {isWindowsMain && (
        <div className="main-window-resize-layer" aria-hidden="true">
          {MAIN_WINDOW_RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className={`main-window-resize-handle main-window-resize-handle-${edge} no-drag`}
              onPointerDown={beginMainWindowResize(edge)}
            />
          ))}
        </div>
      )}
      <div className={`app app-home ${isDragging ? 'dragging' : ''}`}>
        <div className={`search-box-container ${hasBottomPanel ? 'with-bottom-panel' : ''}`}>
          <SearchInput
            ref={searchInputRef}
            value={query}
            summaryText={payloadText}
            onChange={handleQueryChange}
            onSummaryChange={handlePayloadTextChange}
            onOpenSettings={openSettings}
            showSettingsButton={showSearchSettingsButton}
            attachments={attachments}
            onAttachmentsChange={handleAttachmentsChange}
            attachmentsManagerOpen={attachmentsManagerOpen}
            onAttachmentsManagerOpen={() => {
              if (pluginOpen) {
                window.mulby.window.close()
                setPluginOpen(false)
              }
              if (systemPageAttached) {
                void window.mulby.systemPage.close()
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
          {systemPageAttached && (
            <div className="plugin-controls">
              <button
                className="plugin-control-btn plugin-reload-btn"
                onClick={() => {
                  void window.mulby.systemPage.reload()
                }}
                title="重载系统页面"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
              </button>
              <button
                className="plugin-control-btn plugin-detach-btn"
                onClick={() => {
                  void window.mulby.systemPage.detach()
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
                  void window.mulby.systemPage.close()
                  setTimeout(() => {
                    searchInputRef.current?.focus()
                  }, 100)
                }}
                title="关闭系统页面"
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
            searchPayload={searchPayload}
            runPayload={runPayload}
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
    </div>
  )
}

type UiAttachment = InputAttachment & { previewUrl?: string }

function buildPayload(text: string, attachments: UiAttachment[]): InputPayload {
  return {
    text,
    attachments: attachments.map(({ previewUrl: _previewUrl, ...rest }) => rest)
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
