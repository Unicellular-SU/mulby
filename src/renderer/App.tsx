import {
  Suspense,
  lazy,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import SearchInput, { SearchInputRef } from './components/SearchInput'
import PluginList from './components/PluginList'
import AttachmentManager from './components/AttachmentManager'
import {
  getSearchPanelHeight,
  shouldResetSearchPanelHeight,
  shouldShowEmptyLaunchSuggestions,
  shouldShowSearchPanel
} from './search-panel-layout'
import { shouldUseSummaryText } from './utils/summary-text'
import type { SettingsSection } from './components/SettingsView'
import { DEFAULT_SYSTEM_PLUGIN_ROUTE, type SystemPluginRoute } from './system-plugins/types'
import { formatAttachmentTrace } from '../shared/attachment-trace'
import type { InputAttachment, InputPayload } from '../shared/types/plugin'
import type {
  OpenSystemPluginPayload,
  PluginLaunchEndEvent,
  PluginLaunchStartEvent,
  SystemPluginBeforeAttachPayload,
  AutoPasteClipboardPayload,
  MainWindowShowEvent,
  UpdateCenterState
} from '../shared/types/electron'
import type { PluginStoreEntry } from '../shared/types/plugin-store'

const PluginDetails = lazy(() => import('./components/PluginDetails'))
const PluginManagerView = lazy(() => import('./components/PluginManagerView'))
const PluginStoreView = lazy(() => import('./components/PluginStoreView'))
const PluginStoreDetailsView = lazy(() => import('./components/PluginStoreDetailsView'))
const BackgroundPluginManagerView = lazy(() => import('./components/BackgroundPluginManagerView'))
const TaskSchedulerView = lazy(() => import('./components/TaskSchedulerView'))
const AiSettingsView = lazy(() => import('./components/AiSettingsView'))
const AiMcpSettingsView = lazy(() => import('./components/AiMcpSettingsView'))
const AiToolsSettingsView = lazy(() => import('./components/AiToolsSettingsView'))
const AiSkillsSettingsView = lazy(() => import('./components/AiSkillsSettingsView'))
const LogViewerView = lazy(() => import('./components/LogViewerView'))
const PluginStorageExplorerView = lazy(() => import('./components/PluginStorageExplorerView'))
const SystemPluginHost = lazy(() => import('./system-plugins/SystemPluginHost'))
const OnboardingView = lazy(() => import('./components/OnboardingView'))

// 插件附着信息（Panel 模式）
interface PluginInfo {
  pluginName: string
  displayName: string
  featureCode: string
  input: string
  attachments?: InputAttachment[]
  mode: 'panel'
  launchRequestId?: string
}

interface PluginLaunchInfo extends PluginLaunchStartEvent {
  visible: boolean
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

function getLegacyDroppedFilePath(file: DroppedFile): string {
  return typeof file.path === 'string' ? file.path : ''
}

async function resolveDroppedFilePath(file: DroppedFile): Promise<string> {
  const [resolvedPath] = window.mulby.plugin.resolveDroppedFilePaths([file])
  return resolvedPath || getLegacyDroppedFilePath(file)
}

const SETTINGS_SECTION_SET = new Set<SettingsSection>([
  'dashboard',
  'general',
  'floatingBall',
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
  | 'ai-tools-settings'
  | 'ai-skills-settings'
  | 'storage-explorer'

interface SystemWindowBootstrap {
  isSystemWindow: boolean
  initialViewMode: ViewMode
  initialSystemPluginRoute: SystemPluginRoute
  initialPluginStoreFilter?: 'updatable'
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

const PLUGIN_LAUNCH_VISIBLE_DELAY_MS = 160
const PLUGIN_LAUNCH_TIMEOUT_MS = 30_000

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
  const initialPluginStoreFilter =
    params.get('mulbySystemStoreFilter') === 'updatable' ? 'updatable' : undefined

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
    case 'ai-tools-settings':
      initialViewMode = 'ai-tools-settings'
      break
    case 'ai-skills-settings':
      initialViewMode = 'ai-skills-settings'
      break
    case 'storage-explorer':
      initialViewMode = 'storage-explorer'
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
    },
    initialPluginStoreFilter: page === 'plugin-store' ? initialPluginStoreFilter : undefined
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
  const [pluginLaunch, setPluginLaunch] = useState<PluginLaunchInfo | null>(null)
  const [detailsPluginName, setDetailsPluginName] = useState<string | null>(null)
  const [detailsReturnTarget, setDetailsReturnTarget] = useState<'home' | 'settings' | 'plugins'>('home')
  const [viewMode, setViewMode] = useState<ViewMode>(systemWindowBootstrap.initialViewMode)
  const [systemPluginRoute, setSystemPluginRoute] = useState<SystemPluginRoute>(systemWindowBootstrap.initialSystemPluginRoute)
  const [pluginManagerReturnTarget, setPluginManagerReturnTarget] = useState<'home' | 'settings'>('home')
  const [pluginStoreReturnTarget, setPluginStoreReturnTarget] = useState<'home' | 'settings' | 'plugins'>('home')
  const [pluginStoreInitialFilter, setPluginStoreInitialFilter] = useState<'updatable' | undefined>(systemWindowBootstrap.initialPluginStoreFilter)
  const [selectedStoreEntry, setSelectedStoreEntry] = useState<PluginStoreEntry | null>(null)
  const [backgroundPluginManagerReturnTarget, setBackgroundPluginManagerReturnTarget] = useState<'home' | 'settings'>('home')
  const [taskSchedulerReturnTarget, setTaskSchedulerReturnTarget] = useState<'home' | 'settings'>('home')
  const [storageExplorerReturnTarget, setStorageExplorerReturnTarget] = useState<'home' | 'settings'>('home')
  const [logViewerReturnTarget, setLogViewerReturnTarget] = useState<'home' | 'settings'>('home')
  const [isDragging, setIsDragging] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [attachments, setAttachments] = useState<UiAttachment[]>([])
  const [attachmentsManagerOpen, setAttachmentsManagerOpen] = useState(false)
  const [isWindowsMain, setIsWindowsMain] = useState(false)
  const [activationSessionIdle, setActivationSessionIdle] = useState(false)
  const [updateCenterState, setUpdateCenterState] = useState<UpdateCenterState | null>(null)
  // 是否存在可用更新：用于把搜索框右侧的「设置」按钮变为「升级」入口
  const hasAppUpdate = updateCenterState?.hasUpdate === true
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
  const searchPanelContentHeightRef = useRef(0)
  const shrinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const macRepaintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pluginLaunchVisibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pluginLaunchTimeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pluginLaunchRequestIdRef = useRef<string | null>(null)
  const [searchPanelHeight, setSearchPanelHeight] = useState(0)
  const systemPageAttached = !isSystemWindow && systemPageState.open && systemPageState.mode === 'attached'
  const hasTextInput = query.length > 0 || payloadText.length > 0
  const hasInput = hasTextInput || attachments.length > 0
  const isMacMain = !isSystemWindow && navigator.platform.toLowerCase().includes('mac')
  const visiblePluginLaunch = pluginLaunch?.visible ? pluginLaunch : null

  useEffect(() => {
    if (isSystemWindow) return
    const cleanup = window.mulby.app.onMainWindowShow((event: MainWindowShowEvent) => {
      setActivationSessionIdle(!event.autoPasteScheduled)
    })
    return cleanup
  }, [isSystemWindow])

  const focusSearchAfterPluginAction = useCallback(() => {
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 100)
  }, [])

  const handlePluginActionMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    void window.mulby.window.showPluginMenu({ x: rect.left, y: rect.bottom })
  }, [])

  const handleSystemPageActionMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    void window.mulby.systemPage.showMenu({ x: rect.left, y: rect.bottom })
  }, [])

  const clearPluginLaunchTimers = useCallback(() => {
    if (pluginLaunchVisibleTimerRef.current) {
      clearTimeout(pluginLaunchVisibleTimerRef.current)
      pluginLaunchVisibleTimerRef.current = null
    }
    if (pluginLaunchTimeoutTimerRef.current) {
      clearTimeout(pluginLaunchTimeoutTimerRef.current)
      pluginLaunchTimeoutTimerRef.current = null
    }
  }, [])

  const clearPluginLaunch = useCallback((requestId?: string) => {
    if (requestId && pluginLaunchRequestIdRef.current && pluginLaunchRequestIdRef.current !== requestId) {
      return
    }
    pluginLaunchRequestIdRef.current = null
    clearPluginLaunchTimers()
    setPluginLaunch((current) => {
      if (!current) return null
      if (requestId && current.requestId !== requestId) return current
      return null
    })
  }, [clearPluginLaunchTimers])

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
    const MANAGER_HEADER_HEIGHT = 40
    const MANAGER_TOOLBAR_HEIGHT = 40
    const MANAGER_ROW_HEIGHT = 56
    const MANAGER_ROW_GAP = 8
    const MANAGER_GAP = 16
    const MANAGER_PADDING = 40
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

  useEffect(() => {
    document.documentElement.classList.toggle('platform-mac-main', isMacMain)
    return () => {
      document.documentElement.classList.remove('platform-mac-main')
    }
  }, [isMacMain])

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

  // Dynamic search panel height: grow immediately, shrink with delay
  const SEARCH_PANEL_MIN_HEIGHT = 120
  const SEARCH_PANEL_MAX_HEIGHT_CONST = 737 // 800 - 62 - 1
  const SHRINK_DELAY_MS = 280

  const cancelPendingShrinkTimer = useCallback((_reason: string) => {
    if (!shrinkTimerRef.current) return
    clearTimeout(shrinkTimerRef.current)
    shrinkTimerRef.current = null
  }, [])

  const scheduleMacInvalidate = useCallback(() => {
    if (!isMacMain) return
    if (macRepaintTimerRef.current) {
      clearTimeout(macRepaintTimerRef.current)
    }
    macRepaintTimerRef.current = setTimeout(() => {
      macRepaintTimerRef.current = null
      window.mulby.window.invalidate()
    }, 32)
  }, [isMacMain])

  const beginPluginLaunch = useCallback((data: PluginLaunchStartEvent) => {
    clearPluginLaunchTimers()
    cancelPendingShrinkTimer('plugin launch start')
    pluginLaunchRequestIdRef.current = data.requestId
    setPluginLaunch({ ...data, visible: false })

    pluginLaunchVisibleTimerRef.current = setTimeout(() => {
      pluginLaunchVisibleTimerRef.current = null
      setPluginLaunch((current) => {
        if (!current || current.requestId !== data.requestId) return current
        return { ...current, visible: true }
      })
      scheduleMacInvalidate()
    }, PLUGIN_LAUNCH_VISIBLE_DELAY_MS)

    pluginLaunchTimeoutTimerRef.current = setTimeout(() => {
      pluginLaunchTimeoutTimerRef.current = null
      if (pluginLaunchRequestIdRef.current !== data.requestId) return
      pluginLaunchRequestIdRef.current = null
      setPluginLaunch((current) => {
        if (!current || current.requestId !== data.requestId) return current
        return null
      })
      scheduleMacInvalidate()
    }, PLUGIN_LAUNCH_TIMEOUT_MS)
  }, [cancelPendingShrinkTimer, clearPluginLaunchTimers, scheduleMacInvalidate])

  const handleContentHeightChange = useCallback((contentHeight: number, options?: { compact?: boolean }) => {
    const clamped = getSearchPanelHeight({
      contentHeight,
      minHeight: SEARCH_PANEL_MIN_HEIGHT,
      maxHeight: SEARCH_PANEL_MAX_HEIGHT_CONST,
      compact: options?.compact === true
    })

    const prev = searchPanelContentHeightRef.current
    searchPanelContentHeightRef.current = contentHeight

    if (clamped >= prev || prev === 0) {
      cancelPendingShrinkTimer('grow')
      setSearchPanelHeight(clamped)
      scheduleMacInvalidate()
    } else {
      cancelPendingShrinkTimer('reschedule shrink')
      shrinkTimerRef.current = setTimeout(() => {
        shrinkTimerRef.current = null
        setSearchPanelHeight(clamped)
        scheduleMacInvalidate()
      }, SHRINK_DELAY_MS)
    }
  }, [cancelPendingShrinkTimer, scheduleMacInvalidate])

  // Clean up shrink timer
  useEffect(() => {
    return () => {
      cancelPendingShrinkTimer('unmount')
      clearPluginLaunchTimers()
      if (macRepaintTimerRef.current) {
        clearTimeout(macRepaintTimerRef.current)
        macRepaintTimerRef.current = null
      }
    }
  }, [cancelPendingShrinkTimer, clearPluginLaunchTimers])

  // 调整窗口高度
  useEffect(() => {
    if (isSystemWindow) {
      return
    }
    const SEARCH_BOX_HEIGHT = 62
    const BORDER_HEIGHT = 1
    const SYSTEM_PAGE_HEIGHT = 800
    const MANAGER_HEIGHT = managerMetrics.managerHeight

    let height = SEARCH_BOX_HEIGHT
    let allowResize = false
    const showEmptyLaunchSuggestions = shouldShowEmptyLaunchSuggestions({
      hasInput,
      activationSessionIdle,
      pluginOpen,
      visiblePluginLaunch: Boolean(visiblePluginLaunch),
      systemPageAttached,
      attachmentsManagerOpen
    })
    const showSearchPanel = shouldShowSearchPanel({
      hasInput,
      showEmptyLaunchSuggestions,
      pluginOpen,
      visiblePluginLaunch: Boolean(visiblePluginLaunch),
      systemPageAttached,
      attachmentsManagerOpen
    })

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
      if (searchPanelHeight > 0) {
        // 动态高度：基于实际内容，首次测量前保持搜索框高度，避免先撑满再缩小的闪烁
        height = SEARCH_BOX_HEIGHT + BORDER_HEIGHT + searchPanelHeight
      }
      // searchPanelHeight === 0 表示尚未测量，保持 SEARCH_BOX_HEIGHT 等待 ResizeObserver 回调
    }
    window.mulby.window.setExpendHeight(height, allowResize)

    if (shouldResetSearchPanelHeight({ hasInput, showSearchPanel })) {
      // 面板不可见（输入清空隐藏，或被附着插件/系统页/附件管理器遮挡）：重置测量高度，
      // 下次面板重新出现时等待 ResizeObserver 重新测量，避免用旧高度先撑开再回缩闪烁。
      // 注意：此重置必须先于下面的 hasInput 分支判断——附着插件常带着搜索文本启动
      // (hasInput=true)，若被 hasInput 分支拦截就会残留旧高度，关闭插件后闪回。
      lastHeightRef.current = null
      searchPanelContentHeightRef.current = 0
      setSearchPanelHeight(0)
    } else if (hasInput && lastHeightRef.current !== height) {
      lastHeightRef.current = height
    }
  // perfTrace 不影响高度计算，不纳入依赖：避免每次搜索都触发多余的
  // setExpendHeight IPC（透明窗口频繁 resize 会破坏合成器）
  }, [isSystemWindow, hasInput, activationSessionIdle, pluginOpen, visiblePluginLaunch, systemPageAttached, detailsPluginName, attachmentsManagerOpen, managerMetrics.managerHeight, viewMode, searchPanelHeight])


  // 监听插件附着事件
  useEffect(() => {
    const cleanupLaunchStart = window.mulby.onPluginLaunchStart((data: PluginLaunchStartEvent) => {
      console.log(`[AttachmentTrace][Renderer] plugin:launch-start received | plugin=${data.pluginName} | feature=${data.featureCode} | request=${data.requestId}`)
      beginPluginLaunch(data)
    })

    const cleanupLaunchEnd = window.mulby.onPluginLaunchEnd((data: PluginLaunchEndEvent) => {
      console.log(`[AttachmentTrace][Renderer] plugin:launch-end received | plugin=${data.pluginName} | feature=${data.featureCode} | request=${data.requestId} | reason=${data.reason}`)
      clearPluginLaunch(data.requestId)
      scheduleMacInvalidate()
    })

    const cleanupAttach = window.mulby.onPluginAttach((data: PluginInfo) => {
      console.log(`[AttachmentTrace][Renderer] plugin:attach received | plugin=${data.pluginName} | feature=${data.featureCode} | ${formatAttachmentTrace(data.attachments || [])}`)
      cancelPendingShrinkTimer('plugin attach')
      clearPluginLaunch(data.launchRequestId)
      scheduleMacInvalidate()
      if (systemPageAttached) {
        void window.mulby.systemPage.close()
      }
      setPluginOpen(true)
    })

    const cleanupDetached = window.mulby.onPluginDetached(() => {
      console.log('[AttachmentTrace][Renderer] plugin:detached received')
      cancelPendingShrinkTimer('plugin detached')
      scheduleMacInvalidate()
      setPluginOpen(false)
      setTimeout(() => {
        searchInputRef.current?.focus()
        scheduleMacInvalidate()
      }, 100)
    })

    return () => {
      cleanupLaunchStart()
      cleanupLaunchEnd()
      cleanupAttach()
      cleanupDetached()
    }
  }, [beginPluginLaunch, cancelPendingShrinkTimer, clearPluginLaunch, scheduleMacInvalidate, systemPageAttached])

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
    !visiblePluginLaunch &&
    !systemPageAttached

  const openPluginStore = useCallback((from: 'home' | 'settings' | 'plugins' = 'home', storeFilter?: 'updatable') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'plugin-store', storeFilter })
      return
    }
    setPluginStoreReturnTarget(from)
    setPluginStoreInitialFilter(storeFilter)
    setSelectedStoreEntry(null)
    setViewMode('plugin-store')
  }, [isSystemWindow, pluginOpen])

  const openPluginManager = useCallback((from: 'home' | 'settings' = 'home', section: 'installed' | 'store' = 'installed', pluginId?: string, storeFilter?: 'updatable') => {
    if (section === 'store') {
      openPluginStore(from, storeFilter)
      return
    }
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'plugin-manager', detailsPluginId: pluginId })
      return
    }
    setPluginManagerReturnTarget(from)
    setViewMode('plugins')
    if (pluginId) {
      setTimeout(() => {
        setDetailsPluginName(pluginId)
        setDetailsReturnTarget('plugins')
        setViewMode('plugin-details')
      }, 50)
    }
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

  const openStorageExplorer = useCallback((from: 'home' | 'settings' = 'home') => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'storage-explorer' })
      return
    }
    setStorageExplorerReturnTarget(from)
    setViewMode('storage-explorer')
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

  const openAiToolsSettings = useCallback(() => {
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    setAttachmentsManagerOpen(false)
    if (!isSystemWindow) {
      void window.mulby.systemPage.open({ page: 'ai-tools-settings' })
      return
    }
    setViewMode('ai-tools-settings')
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
    console.log(`[AttachmentTrace][Renderer] summary attachments cleared | prev=${formatAttachmentTrace(attachments)}`)
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
          setActivationSessionIdle(false)
          setQuery('')
          setPayloadText('')
          clearAttachments()
          setResultCount(0)
          setDetailsPluginName(null)
        } else if (attachments.length > 0) {
          // 4. 清空附件
          setActivationSessionIdle(false)
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

  // 订阅更新中心状态：有新版本时把搜索框的设置按钮替换为升级图标
  useEffect(() => {
    let active = true
    window.mulby.settings.getUpdateCenterState()
      .then((state) => {
        if (active) setUpdateCenterState(state)
      })
      .catch(() => {
        // 获取失败时维持默认（无更新），不阻塞主界面
      })
    const cleanup = window.mulby.settings.onUpdateStateChanged((state) => {
      setUpdateCenterState(state)
    })
    return () => {
      active = false
      cleanup()
    }
  }, [])

  // 监听窗口重新获得焦点，确保主界面的搜索框依然有焦点
  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    const handleWindowFocus = () => {
      if (viewMode === 'home' && !pluginOpen && !systemPageAttached && !attachmentsManagerOpen && !isSystemWindow) {
        // 确保在主窗口渲染后执行焦点获取
        if (focusTimer) clearTimeout(focusTimer)
        focusTimer = setTimeout(() => {
          searchInputRef.current?.focus()
        }, 10)
      }
    }
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      if (focusTimer) clearTimeout(focusTimer)
    }
  }, [viewMode, pluginOpen, systemPageAttached, attachmentsManagerOpen, isSystemWindow])

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
    const cleanup = window.mulby.app.onOpenPluginStore((filter) => {
      openPluginStore('home', filter)
    })
    return cleanup
  }, [openPluginStore])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenPluginManager((pluginId?: string) => {
      openPluginManager('home', 'installed', pluginId)
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
    const cleanup = window.mulby.app.onOpenAiToolsSettings(() => {
      openAiToolsSettings()
    })
    return cleanup
  }, [openAiToolsSettings])

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenAiSkillsSettings(() => {
      openAiSkillsSettings()
    })
    return cleanup
  }, [openAiSkillsSettings])

  const collapseSystemPluginForAttach = useCallback(async () => {
    let collapsed = false
    setViewMode((prev) => {
      if (prev !== 'home') {
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
    const activePluginId = viewMode !== 'home' ? (viewMode === 'system-plugin' ? systemPluginRoute.pluginId : `__view:${viewMode}`) : null
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

  useEffect(() => {
    const cleanup = window.mulby.app.onOpenStorageExplorer(() => {
      openStorageExplorer('home')
    })
    return cleanup
  }, [openStorageExplorer])

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

  useEffect(() => {
    const cleanup = window.mulby.app.onSetSearchText((queryText) => {
      setActivationSessionIdle(false)
      // 通过 requestAnimationFrame 确保在正确的渲染周期应用
      requestAnimationFrame(() => {
        applySearchTextInput(queryText)
      })
    })
    return cleanup
  }, [applySearchTextInput])

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

    const cleanup = window.mulbyMain.clipboard.onAutoPaste(async (payload?: AutoPasteClipboardPayload) => {
      // 条件1：没有打开插件
      if (pluginOpen || systemPageAttached) {
        return
      }

      // 执行自动粘贴
      try {
        const format = payload?.format ?? await window.mulby.clipboard.getFormat()

        if (format === 'text') {
          // 粘贴文本 - 清空附件
          const text = payload?.text ?? await window.mulby.clipboard.readText()
          if (text && text.trim()) {
            setActivationSessionIdle(false)
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
          const imageBuffer = payload?.image ?? await window.mulby.clipboard.readImage()
          if (imageBuffer) {
            setActivationSessionIdle(false)
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
            console.log(`[AttachmentTrace][Renderer] auto-paste image replace | prev=${formatAttachmentTrace(attachments)} | next=${formatAttachmentTrace([attachment])}`)
            setAttachments([attachment])
            // 清空搜索框，让用户专注于附件
            clearTextInputs()
            beginPerfTrace('attachments', 0, 1)
          }
        } else if (format === 'files') {
          // 粘贴文件 - 总是替换附件
          const files = payload?.files ?? await window.mulby.clipboard.readFiles()
          if (files && files.length > 0) {
            setActivationSessionIdle(false)
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
            console.log(`[AttachmentTrace][Renderer] auto-paste files replace | prev=${formatAttachmentTrace(attachments)} | next=${formatAttachmentTrace(newAttachments)}`)
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
    setActivationSessionIdle(false)
    if (pluginOpen) {
      cancelPendingShrinkTimer('queryChange close plugin')
      scheduleMacInvalidate()
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
    scheduleMacInvalidate()
    if (value.length === 0 && payloadText.length === 0 && attachments.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
      setViewMode('home')
    }
  }

  const handlePayloadTextChange = useCallback((value: string) => {
    setActivationSessionIdle(false)
    setPayloadText(value)
    if (value.length === 0 && query.length === 0 && attachments.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
      setViewMode('home')
    }
  }, [attachments.length, query.length])

  const handleAttachmentsChange = (next: UiAttachment[]) => {
    setActivationSessionIdle(false)
    if (pluginOpen) {
      window.mulby.window.close()
      setPluginOpen(false)
    }
    if (systemPageAttached) {
      void window.mulby.systemPage.close()
    }
    console.log(`[AttachmentTrace][Renderer] summary attachments changed | prev=${formatAttachmentTrace(attachments)} | next=${formatAttachmentTrace(next)}`)
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

    const pluginPath = await resolveDroppedFilePath(pluginFile)
    if (!pluginPath) {
      window.mulby.notification.show('无法读取插件包路径，请从本地文件管理器拖放 .inplugin 文件', 'error')
      return
    }

    try {
      const result = await window.mulby.plugin.install(pluginPath)
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
          onOpenPluginManager={(section = 'installed', storeFilter) => {
            openPluginManager('settings', section, undefined, storeFilter)
          }}
          onOpenBackgroundPluginManager={() => {
            openBackgroundPluginManager('settings')
          }}
          onOpenTaskScheduler={() => {
            openTaskScheduler('settings')
          }}
          onOpenStorageExplorer={() => {
            openStorageExplorer('settings')
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
          onOpenToolsSettings={openAiToolsSettings}
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

  if (viewMode === 'ai-tools-settings') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <AiToolsSettingsView
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
          initialStatusFilter={pluginStoreInitialFilter}
          onOpenDetails={(entry) => {
            setSelectedStoreEntry(entry)
            setViewMode('plugin-store-details')
          }}
          onBack={() => {
            setSelectedStoreEntry(null)
            setPluginStoreInitialFilter(undefined)
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

  if (viewMode === 'storage-explorer') {
    return (
      <LazyViewFrame isDragging={isDragging}>
        <PluginStorageExplorerView
          onBack={() => {
            if (storageExplorerReturnTarget === 'settings') {
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
  const showEmptyLaunchSuggestions = shouldShowEmptyLaunchSuggestions({
    hasInput,
    activationSessionIdle,
    pluginOpen,
    visiblePluginLaunch: Boolean(visiblePluginLaunch),
    systemPageAttached,
    attachmentsManagerOpen
  })
  const showPluginList = shouldShowSearchPanel({
    hasInput,
    showEmptyLaunchSuggestions,
    pluginOpen,
    visiblePluginLaunch: Boolean(visiblePluginLaunch),
    systemPageAttached,
    attachmentsManagerOpen
  })
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
        <div className={`search-box-container shrink-0 ${hasBottomPanel ? 'with-bottom-panel' : ''}`}>
          <SearchInput
            ref={searchInputRef}
            value={query}
            summaryText={payloadText}
            onChange={handleQueryChange}
            onSummaryChange={handlePayloadTextChange}
            onOpenSettings={() => openSettings(hasAppUpdate ? 'about' : 'dashboard')}
            showSettingsButton={showSearchSettingsButton}
            hasUpdate={hasAppUpdate}
            launchingPlugin={visiblePluginLaunch}
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
                className="plugin-control-btn plugin-more-btn"
                onClick={handlePluginActionMenu}
                title="更多插件操作"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="1" />
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="12" cy="19" r="1" />
                </svg>
              </button>
              <button
                className="plugin-control-btn plugin-detach-btn"
                onClick={() => {
                  window.mulby.window.detach()
                  setPluginOpen(false)
                  focusSearchAfterPluginAction()
                }}
                title="转为独立窗口运行"
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
                  focusSearchAfterPluginAction()
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
                className="plugin-control-btn plugin-more-btn"
                onClick={handleSystemPageActionMenu}
                title="更多页面操作"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="1" />
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="12" cy="19" r="1" />
                </svg>
              </button>
              <button
                className="plugin-control-btn plugin-detach-btn"
                onClick={() => {
                  void window.mulby.systemPage.detach()
                  focusSearchAfterPluginAction()
                }}
                title="转为独立窗口运行"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 9V3h-6M3 15v6h6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
              <button
                className="plugin-control-btn plugin-close-btn"
                onClick={() => {
                  void window.mulby.systemPage.close()
                  focusSearchAfterPluginAction()
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
            showEmptyLaunchSuggestions={showEmptyLaunchSuggestions}
            onResultsChange={setResultCount}
            onContentHeightChange={handleContentHeightChange}
            onShowDetails={(pluginName) => {
              setDetailsPluginName(pluginName)
              setDetailsReturnTarget('home')
              setViewMode('plugin-details')
            }}
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
