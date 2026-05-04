import { useState, useEffect, useLayoutEffect, useCallback, useRef, memo, useMemo } from 'react'
import { useContextMenu, type ContextMenuItem } from './ContextMenu'
import { formatPayloadTrace, getAttachmentTraceKey } from '../../shared/attachment-trace'
import type {
  DesktopAppSearchResult,
  DesktopFileSearchResult,
  MainPushItem,
  SearchResultItem,
  SystemIconKind,
  SystemIconRequest
} from '../../shared/types/electron'
import { isSystemSearchQueryEligible } from '../../shared/system-search'
import type { InputPayload, SearchPreferenceState } from '../../shared/types/plugin'
import type { SearchSettings } from '../../shared/types/settings'

interface PluginListProps {
  searchPayload: InputPayload
  runPayload: InputPayload
  traceId: number
  traceStartedAt: number
  traceSource: 'text' | 'attachments'
  traceInputLength: number
  traceAttachmentCount: number
  onResultsChange?: (count: number) => void
  onContentHeightChange?: (height: number) => void
  onShowDetails?: (pluginName: string) => void
}

type ResultSectionKey = 'best' | 'apps' | 'files' | 'recent' | 'push'
type ExpandableResultSectionKey = Exclude<ResultSectionKey, 'recent'>
type RenderItemType = 'plugin' | 'recent' | 'system-app' | 'system-file' | 'main-push'

interface MainPushRenderData {
  pluginName: string
  displayName: string
  featureCode: string
  pushItem: MainPushItem
  searchText: string
}

interface RenderItem {
  key: string
  iconKey?: string
  type: RenderItemType
  title: string
  subtitle: string
  icon?: SearchResultItem['icon']
  pluginItem?: SearchResultItem
  appItem?: DesktopAppSearchResult
  fileItem?: DesktopFileSearchResult
  pushData?: MainPushRenderData
}

interface ResultSectionBase {
  title: string
  items: RenderItem[]
  totalCount: number
}

type ResultSection =
  | (ResultSectionBase & { key: 'recent' })
  | (ResultSectionBase & { key: ExpandableResultSectionKey })

interface NavigationLocation {
  sectionIndex: number
  itemIndex: number
}

interface ResultCardProps {
  item: RenderItem
  isSelected: boolean
  isPinned?: boolean
  onRun: (item: RenderItem) => Promise<void>
  onContextMenu?: (item: RenderItem, e: React.MouseEvent) => void
}

const DEFAULT_DISPLAY_LIMIT = 12
const SYSTEM_APP_SEARCH_LIMIT = 24
const SYSTEM_FILE_SEARCH_LIMIT = 50
const SYSTEM_FILE_STABLE_DELAY_MS = 260
const SYSTEM_ICON_TARGET_SIZE = 128
const SYSTEM_ICON_BATCH_CONCURRENCY = 6
const RECENT_LIMIT = 40
const MAX_CACHE_SIZE = 80
const PREWARM_TOP_N = 3
const PREWARM_DEDUPE_MS = 20_000
const DEFAULT_SEARCH_SETTINGS: SearchSettings = { enableApps: true, enableFiles: false }
const PUSH_DISPLAY_LIMIT = 5
const COLLAPSED_EXPANDED_SECTIONS: Record<ExpandableResultSectionKey, boolean> = {
  best: false,
  apps: false,
  push: false,
  files: false
}

const SYSTEM_APP_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="5" width="16" height="14" rx="2" />
  <path d="M9 3v4M15 3v4M4 10h16" />
</svg>
`.trim()

const SYSTEM_FILE_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
  <path d="M14 2v6h6" />
</svg>
`.trim()

const svgIconSanitizeCache = new Map<string, string | null>()

function sanitizeSvgIcon(svg: string): string | null {
  const cached = svgIconSanitizeCache.get(svg)
  if (cached !== undefined) return cached

  const cacheFailure = () => {
    setLruCache(svgIconSanitizeCache, svg, null, MAX_CACHE_SIZE)
    return null
  }

  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.tagName.toLowerCase() !== 'svg') return cacheFailure()
    if (doc.querySelector('parsererror')) return cacheFailure()

    doc.querySelectorAll('script, foreignObject, iframe, object, embed, link, meta, style').forEach((node) => {
      node.remove()
    })

    for (const element of Array.from(doc.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase()
        const value = attribute.value.trim().toLowerCase()
        if (name.startsWith('on') || name === 'style') {
          element.removeAttribute(attribute.name)
          continue
        }
        if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) {
          element.removeAttribute(attribute.name)
          continue
        }
        if (value.includes('javascript:') || value.includes('data:text/html')) {
          element.removeAttribute(attribute.name)
        }
      }
    }

    const sanitized = new XMLSerializer().serializeToString(root)
    setLruCache(svgIconSanitizeCache, svg, sanitized, MAX_CACHE_SIZE)
    return sanitized
  } catch {
    return cacheFailure()
  }
}

function DefaultPluginIcon() {
  return (
    <div className="plugin-icon plugin-icon-default">
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
      </svg>
    </div>
  )
}

// 简单哈希用于缓存键
function hashPayload(payload: InputPayload): string {
  const aw = payload.activeWindow
  const awKey = aw ? `${aw.app}|${aw.title}|${aw.bundleId || ''}` : ''
  return `${payload.text}|${payload.attachments.map((a) => `${a.id}:${a.name}`).join(',')}|${awKey}`
}

function getSystemIconCacheKey(kind: SystemIconKind, path: string): string {
  return `${kind}:${path}`
}

function isValidIconDataUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) && value.length > 64
}

function getColumns(width: number): number {
  if (width <= 420) return 2
  if (width <= 580) return 3
  if (width <= 760) return 4
  if (width <= 980) return 5
  return 6
}

function findNavigationLocation(sections: ResultSection[], selectedKey: string): NavigationLocation | null {
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const itemIndex = sections[sectionIndex].items.findIndex((item) => item.key === selectedKey)
    if (itemIndex >= 0) {
      return { sectionIndex, itemIndex }
    }
  }
  return null
}

function isSingleColumnSection(section: ResultSection): boolean {
  return section.key === 'push'
}

function getVerticalNavigationKey(
  sections: ResultSection[],
  selectedKey: string,
  columns: number,
  direction: 'up' | 'down'
): string | null {
  const location = findNavigationLocation(sections, selectedKey)
  if (!location) return sections[0]?.items[0]?.key ?? null

  const section = sections[location.sectionIndex]
  const effectiveCols = isSingleColumnSection(section) ? 1 : columns
  const sameSectionIndex = location.itemIndex + (direction === 'down' ? effectiveCols : -effectiveCols)
  if (sameSectionIndex >= 0 && sameSectionIndex < section.items.length) {
    return section.items[sameSectionIndex].key
  }

  const column = isSingleColumnSection(section) ? 0 : location.itemIndex % columns

  if (direction === 'down') {
    for (let sectionIndex = location.sectionIndex + 1; sectionIndex < sections.length; sectionIndex += 1) {
      const nextItems = sections[sectionIndex].items
      if (nextItems.length === 0) continue
      if (isSingleColumnSection(sections[sectionIndex])) return nextItems[0].key
      return nextItems[Math.min(column, nextItems.length - 1)].key
    }
    return null
  }

  for (let sectionIndex = location.sectionIndex - 1; sectionIndex >= 0; sectionIndex -= 1) {
    const previousItems = sections[sectionIndex].items
    if (previousItems.length === 0) continue
    if (isSingleColumnSection(sections[sectionIndex])) return previousItems[previousItems.length - 1].key
    const lastRowStart = Math.floor((previousItems.length - 1) / columns) * columns
    return previousItems[Math.min(lastRowStart + column, previousItems.length - 1)].key
  }

  return null
}

function getPluginKey(item: SearchResultItem): string {
  return `${item.pluginId}:${item.featureCode}`
}

function dedupePluginResults(items: SearchResultItem[]): SearchResultItem[] {
  const next: SearchResultItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const key = getPluginKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}

function getMatchWeight(matchType: SearchResultItem['matchType']): number {
  switch (matchType) {
    case 'window':
      return 600
    case 'files':
      return 520
    case 'img':
      return 520
    case 'regex':
      return 440
    case 'keyword':
      return 320
    case 'over':
      return 260
    default:
      return 200
  }
}

/**
 * Frecency = 使用频次 × 时间衰减系数
 * 参考 Mozilla Firefox 书签算法 + Alfred Frecency 模型
 */
function computeFrecency(lastUsedAt: number, useCount: number): number {
  const ageDays = (Date.now() - lastUsedAt) / 86400000
  let decay: number
  if (ageDays < 1) decay = 1.0
  else if (ageDays < 7) decay = 0.9
  else if (ageDays < 14) decay = 0.7
  else if (ageDays < 31) decay = 0.5
  else if (ageDays < 90) decay = 0.25
  else decay = 0.1
  return useCount * decay
}

/**
 * 最近使用区的综合评分：frecency 基础分 + 查询相关性加分
 * 完全不相关时降权（×0.05）而非剔除，避免区域莫名为空
 */
function getRecentItemScore(item: SearchResultItem, query: string, frecency: number): number {
  let score = frecency
  const normalized = query.trim().toLowerCase()
  if (!normalized) return score

  const name = item.displayName.toLowerCase()
  const code = item.featureCode.toLowerCase()
  const explain = item.featureExplain.toLowerCase()
  const pluginName = item.pluginName.toLowerCase()

  // 按匹配精度阶梯加分
  if (name === normalized || code === normalized) score += 200
  else if (name.startsWith(normalized) || code.startsWith(normalized)) score += 120
  else if (name.includes(normalized) || code.includes(normalized)) score += 60

  if (explain.includes(normalized) || pluginName.includes(normalized)) score += 20

  // 完全不相关时大幅降权，推到列表末尾但不剔除
  const anyMatch = name.includes(normalized) || code.includes(normalized) ||
    explain.includes(normalized) || pluginName.includes(normalized)
  if (!anyMatch) score *= 0.05

  return score
}

function getSearchScore(
  item: SearchResultItem,
  query: string,
  frecencyMap: Map<string, number>,
  isPinned?: boolean
): number {
  const normalized = query.trim().toLowerCase()
  let score = getMatchWeight(item.matchType)

  if (isPinned && normalized) {
    score += 10000
  }

  if (normalized) {
    const name = item.displayName.toLowerCase()
    const code = item.featureCode.toLowerCase()
    const explain = item.featureExplain.toLowerCase()

    if (name === normalized || code === normalized) {
      score += 420
    } else if (name.startsWith(normalized) || code.startsWith(normalized)) {
      score += 300
    } else if (name.includes(normalized) || code.includes(normalized)) {
      score += 180
    }

    if (explain.includes(normalized)) {
      score += 80
    }
  }

  // 频次×时间衰减加权
  // 上限严格 < 最小 matchType 档位间隔（over→keyword 差 60），
  // 确保 frecency 只在同档内打破平局，不会让低优先级 matchType 越级超过高优先级。
  // 例：over(260)+55=315 < keyword(320)；keyword(320)+55=375 < regex(440)
  const frecency = frecencyMap.get(getPluginKey(item))
  if (frecency !== undefined) {
    score += Math.min(frecency * 10, 55)
  }

  return score
}

function trimPath(path: string): string {
  if (path.length <= 42) return path
  return `${path.slice(0, 20)}...${path.slice(-18)}`
}

function setLruCache<T>(cache: Map<string, T>, key: string, value: T, maxSize: number) {
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, value)
  while (cache.size > maxSize) {
    const firstKey = cache.keys().next().value as string | undefined
    if (!firstKey) break
    cache.delete(firstKey)
  }
}

// 图标组件
const PluginIcon = memo(function PluginIcon({ icon }: { icon?: SearchResultItem['icon'] }) {
  if (!icon) {
    return <DefaultPluginIcon />
  }

  if (icon.type === 'svg') {
    const sanitized = sanitizeSvgIcon(icon.value)
    if (!sanitized) return <DefaultPluginIcon />
    return <div className="plugin-icon" dangerouslySetInnerHTML={{ __html: sanitized }} />
  }

  if (icon.type === 'emoji') {
    return (
      <div className="plugin-icon" style={{ fontSize: '20px', lineHeight: '20px', textAlign: 'center' }}>
        {icon.value}
      </div>
    )
  }

  return (
    <div className="plugin-icon">
      <img src={icon.value} alt="" width="20" height="20" />
    </div>
  )
})

const ResultCard = memo(function ResultCard({
  item,
  isSelected,
  isPinned,
  onRun,
  onContextMenu
}: ResultCardProps) {
  const systemClass = item.type === 'system-app' || item.type === 'system-file' ? 'system' : ''
  return (
    <div
      className={`plugin-card ${systemClass} ${isSelected ? 'selected' : ''}`}
      role="option"
      aria-selected={isSelected}
      data-item-key={item.key}
      data-icon-key={item.iconKey || undefined}
      onClick={() => {
        void onRun(item)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.(item, e)
      }}
    >
      <div className="plugin-card-top">
        <PluginIcon icon={item.icon} />
        {isPinned && (
          <div className="plugin-card-pinned">
            <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
              <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
            </svg>
          </div>
        )}
      </div>
      <div className="plugin-card-info">
        <span className="plugin-card-name">{item.title}</span>
        <span className="plugin-card-explain">{item.subtitle}</span>
      </div>
    </div>
  )
})

const PUSH_ITEM_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 19V5M5 12l7-7 7 7" />
</svg>
`.trim()

interface PushResultRowProps {
  item: RenderItem
  isSelected: boolean
  onSelect: (item: RenderItem) => Promise<void>
}

const PushResultRow = memo(function PushResultRow({
  item,
  isSelected,
  onSelect
}: PushResultRowProps) {
  const pushIcon = item.pushData?.pushItem.icon
  return (
    <div
      className={`push-row ${isSelected ? 'selected' : ''}`}
      role="option"
      aria-selected={isSelected}
      data-item-key={item.key}
      onClick={() => { void onSelect(item) }}
    >
      <div className="push-row-icon">
        {pushIcon ? (
          <img src={pushIcon} alt="" width="20" height="20" />
        ) : (
          <div dangerouslySetInnerHTML={{ __html: PUSH_ITEM_ICON_SVG }} />
        )}
      </div>
      <div className="push-row-content">
        <span className="push-row-title">{item.title}</span>
        <span className="push-row-text">{item.subtitle}</span>
      </div>
      <span className="push-row-source">{item.pushData?.displayName}</span>
    </div>
  )
})

function PluginList({
  searchPayload,
  runPayload,
  traceId,
  traceStartedAt,
  traceSource,
  traceInputLength,
  traceAttachmentCount,
  onResultsChange,
  onContentHeightChange,
  onShowDetails
}: PluginListProps) {
  const [pluginResults, setPluginResults] = useState<SearchResultItem[]>([])
  const [pluginResultsHash, setPluginResultsHash] = useState('')
  const [systemApps, setSystemApps] = useState<DesktopAppSearchResult[]>([])
  const [systemFiles, setSystemFiles] = useState<DesktopFileSearchResult[]>([])
  const [systemAppsResultHash, setSystemAppsResultHash] = useState('')
  const [systemFilesResultHash, setSystemFilesResultHash] = useState('')
  const [recentPlugins, setRecentPlugins] = useState<SearchResultItem[]>([])
  const [isPluginLoading, setIsPluginLoading] = useState(false)
  const [isSystemAppsLoading, setIsSystemAppsLoading] = useState(false)
  const [isSystemFilesLoading, setIsSystemFilesLoading] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(() => getColumns(window.innerWidth))
  const [systemIconVersion, setSystemIconVersion] = useState(0)
  const [expandedSections, setExpandedSections] = useState<Record<ExpandableResultSectionKey, boolean>>(() => ({
    ...COLLAPSED_EXPANDED_SECTIONS
  }))

  const payloadRef = useRef(runPayload)
  const payloadAttachmentKeyRef = useRef(getAttachmentTraceKey(runPayload.attachments))
  const requestIdRef = useRef(0)
  const launchedSearchTokenRef = useRef('')

  const pluginCacheRef = useRef<Map<string, SearchResultItem[]>>(new Map())
  const systemAppCacheRef = useRef<Map<string, DesktopAppSearchResult[]>>(new Map())
  const systemFileCacheRef = useRef<Map<string, DesktopFileSearchResult[]>>(new Map())
  const systemIconCacheRef = useRef<Map<string, string>>(new Map())
  const systemIconPendingRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)
  // 搜索设置：控制是否搜索本机应用和文件
  const [searchSettings, setSearchSettings] = useState<SearchSettings | null>(null)

  const [searchPreferences, setSearchPreferences] = useState<SearchPreferenceState>({ pinnedFeatures: [], hiddenFeatures: [] })

  // 使用 useLayoutEffect 在 DOM 提交后同步更新 ref：
  // - 比 useEffect 更早执行，在用户的 click/keydown 事件触发前完成，避免 handleRun 读取到旧 payload（附件丢失）
  // - 比渲染阶段赋值更安全，不会因 concurrent rendering 下未提交的渲染泄漏不一致的 payload
  useLayoutEffect(() => {
    const nextAttachmentKey = getAttachmentTraceKey(runPayload.attachments)
    if (payloadAttachmentKeyRef.current !== nextAttachmentKey) {
      payloadAttachmentKeyRef.current = nextAttachmentKey
      console.log(`[AttachmentTrace][Renderer] runPayload synced | ${formatPayloadTrace(runPayload)}`)
    }
    payloadRef.current = runPayload
  }, [runPayload])

  useEffect(() => {
    // React StrictMode replays effects in development; reset this during setup
    // so async icon callbacks from the live mount can still trigger a repaint.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 挂载时获取搜索设置
  useEffect(() => {
    void window.mulby.settings.get().then(({ settings }) => {
      setSearchSettings(settings?.search ?? DEFAULT_SEARCH_SETTINGS)
    }).catch(() => {
      setSearchSettings(DEFAULT_SEARCH_SETTINGS)
    })

    let active = true
    void window.mulby.plugin.getSearchPreferences().then(prefs => {
      if (active) setSearchPreferences(prefs)
    }).catch(() => { })

    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const loadRecent = async () => {
      try {
        const recent = await window.mulby.plugin.getRecentUsed(RECENT_LIMIT)
        if (!active) return
        setRecentPlugins(dedupePluginResults(recent))
      } catch (error) {
        console.warn('[PluginList] Failed to load recent plugins', error)
      }
    }
    void loadRecent()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setColumns(getColumns(window.innerWidth))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const payloadHash = useMemo(() => hashPayload(searchPayload), [searchPayload])

  useEffect(() => {
    setExpandedSections({ ...COLLAPSED_EXPANDED_SECTIONS })
  }, [payloadHash])

  const toggleSectionExpand = useCallback((sectionKey: ExpandableResultSectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }))
  }, [])

  useEffect(() => {
    if (!searchSettings) return

    let cancelled = false
    let kickoffTimer: ReturnType<typeof setTimeout> | null = null
    let systemTimer: ReturnType<typeof setTimeout> | null = null

    const runSearch = () => {
      const currentPayload = searchPayload
      const searchToken = `${traceId}:${payloadHash}:${searchSettings.enableApps ? 1 : 0}:${searchSettings.enableFiles ? 1 : 0}`
      if (launchedSearchTokenRef.current === searchToken) {
        return
      }
      launchedSearchTokenRef.current = searchToken

      const currentRequestId = requestIdRef.current + 1
      requestIdRef.current = currentRequestId

      const hasInput = currentPayload.text.trim().length > 0 || currentPayload.attachments.length > 0
      const canUsePluginCache = Boolean(currentPayload.activeWindow)
      if (!hasInput) {
        // 即使无输入，也调用 plugin.search 以支持窗口匹配（CmdWindow）
        // 主进程会注入 activeWindow 上下文并返回 window 匹配的插件
        setSystemApps([])
        setSystemFiles([])
        setSystemAppsResultHash('')
        setSystemFilesResultHash('')
        setIsSystemAppsLoading(false)
        setIsSystemFilesLoading(false)

        const emptyCache = canUsePluginCache ? pluginCacheRef.current.get(payloadHash) : undefined
        if (emptyCache) {
          setPluginResults(emptyCache)
          setPluginResultsHash(payloadHash)
          setIsPluginLoading(false)
          return
        }

        setIsPluginLoading(true)
        setPluginResults([])
        setPluginResultsHash('')
        void window.mulby.plugin.search(currentPayload)
          .then((result) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            const merged = dedupePluginResults(result)
            if (canUsePluginCache) {
              setLruCache(pluginCacheRef.current, payloadHash, merged, MAX_CACHE_SIZE)
            }
            setPluginResults(merged)
            setPluginResultsHash(payloadHash)
          })
          .catch((error) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            console.warn('[PluginList] Empty-query plugin search failed', error)
          })
          .finally(() => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            setIsPluginLoading(false)
          })
        return
      }

      const cachedPlugins = canUsePluginCache ? pluginCacheRef.current.get(payloadHash) : undefined
      if (cachedPlugins) {
        setPluginResults(cachedPlugins)
        setPluginResultsHash(payloadHash)
        setIsPluginLoading(false)

      } else {
        setIsPluginLoading(true)
        setPluginResults([])
        setPluginResultsHash('')
        void window.mulby.plugin.search(currentPayload)
          .then((result) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            const merged = dedupePluginResults(result)
            if (canUsePluginCache) {
              setLruCache(pluginCacheRef.current, payloadHash, merged, MAX_CACHE_SIZE)
            }
            setPluginResults(merged)
            setPluginResultsHash(payloadHash)

          })
          .catch((error) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            console.warn('[PluginList] Plugin search failed', error)
          })


          .finally(() => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            setIsPluginLoading(false)
          })
      }

      const query = currentPayload.text.trim()
      const hasTextOnlyInput = query.length > 0 && currentPayload.attachments.length === 0
      const shouldSearchApps = hasTextOnlyInput && isSystemSearchQueryEligible(query) && searchSettings.enableApps
      const shouldSearchFiles = hasTextOnlyInput && isSystemSearchQueryEligible(query) && searchSettings.enableFiles && query.length >= 2

      if (!hasTextOnlyInput) {
        setSystemApps([])
        setSystemFiles([])
        setSystemAppsResultHash('')
        setSystemFilesResultHash('')
        setIsSystemAppsLoading(false)
        setIsSystemFilesLoading(false)
        return
      }

      const systemCacheKey = query.toLowerCase()
      if (!shouldSearchApps) {
        setSystemApps([])
        setSystemAppsResultHash('')
        setIsSystemAppsLoading(false)
      } else {
        const cachedApps = systemAppCacheRef.current.get(systemCacheKey)
        if (cachedApps) {
          setSystemApps(cachedApps)
          setSystemAppsResultHash(payloadHash)
          setIsSystemAppsLoading(false)
        } else {
          setSystemApps([])
          setSystemAppsResultHash('')
          setIsSystemAppsLoading(true)

          void window.mulby.desktop.searchApps(query, SYSTEM_APP_SEARCH_LIMIT)
            .then((apps) => {
              if (cancelled || currentRequestId !== requestIdRef.current) return
              setLruCache(systemAppCacheRef.current, systemCacheKey, apps, MAX_CACHE_SIZE)
              setSystemApps(apps)
              setSystemAppsResultHash(payloadHash)
            })
            .catch((_) => {
              if (cancelled || currentRequestId !== requestIdRef.current) return
            })
            .finally(() => {
              if (cancelled || currentRequestId !== requestIdRef.current) return
              setIsSystemAppsLoading(false)
            })
        }
      }

      if (!shouldSearchFiles) {
        setSystemFiles([])
        setSystemFilesResultHash('')
        setIsSystemFilesLoading(false)
      } else {
        const cachedFiles = systemFileCacheRef.current.get(systemCacheKey)
        if (cachedFiles) {
          setSystemFiles(cachedFiles)
          setSystemFilesResultHash(payloadHash)
          setIsSystemFilesLoading(false)
        } else {
          setSystemFiles([])
          setSystemFilesResultHash('')
          setIsSystemFilesLoading(false)

          systemTimer = setTimeout(() => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            setIsSystemFilesLoading(true)
            void window.mulby.desktop.searchFiles(query, SYSTEM_FILE_SEARCH_LIMIT).then((files) => {
              if (cancelled || currentRequestId !== requestIdRef.current) return
              setLruCache(systemFileCacheRef.current, systemCacheKey, files, MAX_CACHE_SIZE)
              setSystemFiles(files)
              setSystemFilesResultHash(payloadHash)
            }).catch(() => {
              if (cancelled || currentRequestId !== requestIdRef.current) return
            }).finally(() => {
              if (cancelled || currentRequestId !== requestIdRef.current) return
              setIsSystemFilesLoading(false)
            })
          }, SYSTEM_FILE_STABLE_DELAY_MS)
        }
      }
    }

    // 无输入时立即响应，有输入时 debounce 80ms 合并快速连续输入
    const hasInput = searchPayload.text.trim().length > 0 || searchPayload.attachments.length > 0
    const SEARCH_DEBOUNCE_MS = 80

    if (!hasInput) {
      // 清空输入立即响应
      if (import.meta.env.DEV) {
        kickoffTimer = setTimeout(runSearch, 0)
      } else {
        runSearch()
      }
    } else {
      // 有输入时 debounce，合并连续键入
      kickoffTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS)
    }

    return () => {
      cancelled = true
      if (kickoffTimer) {
        clearTimeout(kickoffTimer)
      }
      if (systemTimer) {
        clearTimeout(systemTimer)
      }
    }
  }, [payloadHash, searchPayload, searchSettings, traceAttachmentCount, traceId, traceInputLength, traceSource, traceStartedAt])

  const promoteRecent = useCallback((pluginItem: SearchResultItem) => {
    setRecentPlugins((prev) => {
      const key = getPluginKey(pluginItem)
      const existing = prev.find((item) => getPluginKey(item) === key)
      // 合并已有频次元数据并递增，防止运行后 frecency 因 useCount=1 骤降
      const promoted: SearchResultItem = {
        ...pluginItem,
        lastUsedAt: Date.now(),
        useCount: (existing?.useCount ?? 0) + 1
      }
      const next = [promoted, ...prev.filter((item) => getPluginKey(item) !== key)]
      return next.slice(0, RECENT_LIMIT)
    })
  }, [])

  // 构建 Frecency Map：key → 频次×时间衰减得分
  const frecencyMap = useMemo(() => {
    const map = new Map<string, number>()
    recentPlugins.forEach((item) => {
      const score = computeFrecency(
        item.lastUsedAt ?? Date.now(),
        item.useCount ?? 1
      )
      map.set(getPluginKey(item), score)
    })
    return map
  }, [recentPlugins])

  const hiddenKeys = useMemo(() => {
    return new Set(searchPreferences.hiddenFeatures.map(item => `${item.pluginId}:${item.featureCode}`))
  }, [searchPreferences.hiddenFeatures])

  const pinnedKeys = useMemo(() => {
    return new Set(searchPreferences.pinnedFeatures.map(item => `${item.pluginId}:${item.featureCode}`))
  }, [searchPreferences.pinnedFeatures])

  const bestPlugins = useMemo(() => {
    const sourcePlugins = pluginResultsHash === payloadHash ? pluginResults : []
    const sorted = dedupePluginResults(sourcePlugins)
      .filter((item) => !hiddenKeys.has(getPluginKey(item)))
      .slice()
    sorted.sort((a, b) => {
      const aPinned = pinnedKeys.has(getPluginKey(a))
      const bPinned = pinnedKeys.has(getPluginKey(b))
      const scoreDiff = getSearchScore(b, searchPayload.text, frecencyMap, bPinned) - getSearchScore(a, searchPayload.text, frecencyMap, aPinned)
      if (scoreDiff !== 0) return scoreDiff
      return a.displayName.localeCompare(b.displayName)
    })
    return sorted
  }, [pluginResults, pluginResultsHash, payloadHash, searchPayload.text, frecencyMap, hiddenKeys, pinnedKeys])

  const bestKeys = useMemo(() => {
    return new Set(bestPlugins.map((item) => getPluginKey(item)))
  }, [bestPlugins])

  const recentDisplayItems = useMemo(() => {
    const query = searchPayload.text.trim()
    const normalized = query.toLowerCase()
    let items = recentPlugins.filter((item) => {
      const key = getPluginKey(item)
      return !bestKeys.has(key) && !hiddenKeys.has(key)
    })

    // 有查询词时，过滤掉完全无关的条目
    // 防止不相关 recent chip 因 frecency 高而排首位，被 Enter 误执行
    if (normalized) {
      items = items.filter((item) =>
        item.displayName.toLowerCase().includes(normalized) ||
        item.featureCode.toLowerCase().includes(normalized) ||
        item.featureExplain.toLowerCase().includes(normalized) ||
        item.pluginName.toLowerCase().includes(normalized)
      )
    }

    // 按 frecency + 查询相关性综合排序（有关联的高频插件排在前面）
    return items.sort((a, b) => {
      const fa = frecencyMap.get(getPluginKey(a)) ?? 0
      const fb = frecencyMap.get(getPluginKey(b)) ?? 0
      return getRecentItemScore(b, query, fb) - getRecentItemScore(a, query, fa)
    })
  }, [recentPlugins, searchPayload.text, bestKeys, hiddenKeys, frecencyMap])

  const appDisplayItems = useMemo(() => {
    const seen = new Set<string>()
    const sourceApps = systemAppsResultHash === payloadHash ? systemApps : []
    return sourceApps
      .filter((item) => {
        if (seen.has(item.path)) return false
        seen.add(item.path)
        return true
      })
  }, [payloadHash, systemApps, systemAppsResultHash])

  const fileDisplayItems = useMemo(() => {
    const seen = new Set<string>()
    const sourceFiles = systemFilesResultHash === payloadHash ? systemFiles : []
    return sourceFiles
      .filter((item) => {
        // .app 应归类到“系统应用”，避免在“系统文件”里重复展示和重复请求图标。
        if (item.path.toLowerCase().endsWith('.app')) return false
        if (seen.has(item.path)) return false
        seen.add(item.path)
        return true
      })
  }, [payloadHash, systemFiles, systemFilesResultHash])

  // 加载系统图标：当 app/file 展示列表变化时，批量请求尚未缓存的图标
  useEffect(() => {
    // 收集当前搜索结果中所有需要的 icon key
    const neededKeys = new Set<string>()
    const batch: SystemIconRequest[] = []
    for (const item of appDisplayItems) {
      const key = getSystemIconCacheKey('app', item.path)
      neededKeys.add(key)
      if (!systemIconCacheRef.current.has(key) && !systemIconPendingRef.current.has(key)) {
        batch.push({ key, path: item.iconPath || item.path, kind: item.iconPath ? 'file' : 'app' })
      }
    }
    for (const item of fileDisplayItems) {
      const key = getSystemIconCacheKey('file', item.path)
      neededKeys.add(key)
      if (!systemIconCacheRef.current.has(key) && !systemIconPendingRef.current.has(key)) {
        batch.push({ key, path: item.path, kind: 'file' })
      }
    }

    // 只清除不在当前结果中的过期 pending key，保留当前仍在 in-flight 的条目
    for (const key of systemIconPendingRef.current) {
      if (!neededKeys.has(key)) {
        systemIconPendingRef.current.delete(key)
      }
    }

    if (batch.length === 0) return

    batch.forEach(r => systemIconPendingRef.current.add(r.key))

    void window.mulby.system.getFileIcons(batch, {
      size: SYSTEM_ICON_TARGET_SIZE,
      concurrency: SYSTEM_ICON_BATCH_CONCURRENCY
    })
      .then((results) => {
        if (!Array.isArray(results)) return
        let changed = false
        for (const result of results) {
          if (!result.icon || !isValidIconDataUrl(result.icon)) continue
          if (systemIconCacheRef.current.get(result.key) === result.icon) continue
          systemIconCacheRef.current.set(result.key, result.icon)
          changed = true
        }
        if (changed) {
          if (!mountedRef.current) return
          setSystemIconVersion(prev => prev + 1)
        }
      })
      .catch(() => { /* ignore icon load errors */ })
      .finally(() => {
        batch.forEach(r => systemIconPendingRef.current.delete(r.key))
      })
  }, [appDisplayItems, fileDisplayItems])

  // 从搜索结果中提取所有 MainPush 项，聚合为扁平列表
  const pushDisplayItems = useMemo(() => {
    const sourcePlugins = pluginResultsHash === payloadHash ? pluginResults : []
    const items: RenderItem[] = []
    const searchText = searchPayload.text.trim()
    for (const plugin of sourcePlugins) {
      if (!plugin.mainPushItems || plugin.mainPushItems.length === 0) continue
      for (let i = 0; i < plugin.mainPushItems.length; i++) {
        const pushItem = plugin.mainPushItems[i]
        items.push({
          key: `push:${plugin.pluginId}:${plugin.featureCode}:${i}`,
          type: 'main-push',
          title: pushItem.title,
          subtitle: pushItem.text,
          icon: pushItem.icon ? { type: 'url', value: pushItem.icon } : undefined,
          pushData: {
            pluginName: plugin.pluginName,
            displayName: plugin.displayName,
            featureCode: plugin.featureCode,
            pushItem,
            searchText
          }
        })
      }
    }
    return items
  }, [pluginResults, pluginResultsHash, payloadHash, searchPayload.text])

  const sections = useMemo((): ResultSection[] => {
    const next: ResultSection[] = []

    // 最近使用：置顶，紧凑单行，最多显示一行（columns 个）
    const recentItems: RenderItem[] = recentDisplayItems
      .slice(0, columns)
      .map((item) => ({
        key: `recent:${getPluginKey(item)}`,
        type: 'recent',
        title: item.featureExplain || item.displayName,
        subtitle: item.displayName,
        icon: item.icon,
        pluginItem: item
      }))
    if (recentItems.length > 0) {
      next.push({ key: 'recent', title: '最近使用', items: recentItems, totalCount: recentDisplayItems.length })
    }

    // MainPush 推送结果：在"最近使用"之后、"最佳匹配"之前
    if (pushDisplayItems.length > 0) {
      const pushItems = expandedSections.push ? pushDisplayItems : pushDisplayItems.slice(0, PUSH_DISPLAY_LIMIT)
      next.push({ key: 'push', title: '推送结果', items: pushItems, totalCount: pushDisplayItems.length })
    }

    const fullBestItems: RenderItem[] = bestPlugins.map((item) => ({
      key: `plugin:${getPluginKey(item)}`,
      type: 'plugin',
      title: item.featureExplain || item.displayName,
      subtitle: item.displayName,
      icon: item.icon,
      pluginItem: item
    }))
    const bestItems = expandedSections.best ? fullBestItems : fullBestItems.slice(0, DEFAULT_DISPLAY_LIMIT)
    if (bestItems.length > 0) {
      next.push({ key: 'best', title: '最佳匹配插件', items: bestItems, totalCount: fullBestItems.length })
    }

    const fullApps: RenderItem[] = appDisplayItems.map((item) => ({
      key: `app:${item.path}`,
      iconKey: getSystemIconCacheKey('app', item.path),
      type: 'system-app',
      title: item.name,
      subtitle: item.kind === 'shortcut' ? '系统应用快捷方式' : '系统应用',
      icon: systemIconCacheRef.current.has(getSystemIconCacheKey('app', item.path))
        ? { type: 'data-url', value: systemIconCacheRef.current.get(getSystemIconCacheKey('app', item.path))! }
        : { type: 'svg', value: SYSTEM_APP_ICON_SVG },
      appItem: item
    }))
    const apps = expandedSections.apps ? fullApps : fullApps.slice(0, DEFAULT_DISPLAY_LIMIT)
    if (apps.length > 0) {
      next.push({ key: 'apps', title: '系统应用', items: apps, totalCount: fullApps.length })
    }

    const fullFiles: RenderItem[] = fileDisplayItems.map((item) => ({
      key: `file:${item.path}`,
      iconKey: getSystemIconCacheKey('file', item.path),
      type: 'system-file',
      title: item.name,
      subtitle: trimPath(item.path),
      icon: systemIconCacheRef.current.has(getSystemIconCacheKey('file', item.path))
        ? { type: 'data-url', value: systemIconCacheRef.current.get(getSystemIconCacheKey('file', item.path))! }
        : { type: 'svg', value: SYSTEM_FILE_ICON_SVG },
      fileItem: item
    }))
    const files = expandedSections.files ? fullFiles : fullFiles.slice(0, DEFAULT_DISPLAY_LIMIT)
    if (files.length > 0) {
      next.push({ key: 'files', title: '系统文件', items: files, totalCount: fullFiles.length })
    }

    return next
  }, [
    bestPlugins,
    appDisplayItems,
    fileDisplayItems,
    recentDisplayItems,
    pushDisplayItems,
    systemIconVersion,
    columns,
    expandedSections.best,
    expandedSections.apps,
    expandedSections.files,
    expandedSections.push
  ])

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections])
  const isSystemLoading = isSystemAppsLoading || isSystemFilesLoading
  const isSearching = searchSettings === null || isPluginLoading || isSystemLoading

  // 搜索预热：Top N 结果、选中项变化或鼠标悬停时提前初始化 Host
  const prewarmTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastPrewarmedRef = useRef<Map<string, number>>(new Map())

  const triggerPrewarm = useCallback((pluginId: string, debounceMs = 120) => {
    const now = Date.now()
    const expiresAt = lastPrewarmedRef.current.get(pluginId) ?? 0
    if (now < expiresAt) return

    const existingTimer = prewarmTimersRef.current.get(pluginId)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
      prewarmTimersRef.current.delete(pluginId)
      lastPrewarmedRef.current.set(pluginId, Date.now() + PREWARM_DEDUPE_MS)
      void window.mulby.plugin.prewarm(pluginId)
    }, debounceMs)
    prewarmTimersRef.current.set(pluginId, timer)
  }, [])

  const triggerPrewarmMany = useCallback((pluginIds: string[], debounceMs = 120) => {
    const seen = new Set<string>()
    for (const pluginId of pluginIds) {
      if (seen.has(pluginId)) continue
      seen.add(pluginId)
      triggerPrewarm(pluginId, debounceMs)
      if (seen.size >= PREWARM_TOP_N) break
    }
  }, [triggerPrewarm])

  // Reset across searches; within a search, the dedupe expires with the main-process prewarm TTL.
  useEffect(() => {
    for (const timer of prewarmTimersRef.current.values()) {
      clearTimeout(timer)
    }
    prewarmTimersRef.current.clear()
    lastPrewarmedRef.current.clear()
  }, [searchPayload.text])

  // 键盘选中项 / 搜索结果自动选中 → 预热选中项开始的 Top N 插件结果
  useEffect(() => {
    if (searchPayload.text.trim().length < 2) return
    const pluginItems = flatItems.filter((item) => item.pluginItem)
    if (pluginItems.length === 0) return

    const selectedIndex = pluginItems.findIndex((item) => item.key === selectedKey)
    const startIndex = selectedIndex >= 0 ? selectedIndex : 0
    const candidates = pluginItems
      .slice(startIndex, startIndex + PREWARM_TOP_N)
      .map((item) => item.pluginItem!.pluginId)
    triggerPrewarmMany(candidates)
  }, [selectedKey, flatItems, searchPayload.text, triggerPrewarmMany])

  // 鼠标悬停 → 预热（事件委托，不增加组件 re-render）
  const lastHoveredKeyRef = useRef('')
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleMouseOver = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest('[data-item-key]')
      if (!card) return
      const key = card.getAttribute('data-item-key')
      if (!key || key === lastHoveredKeyRef.current) return
      lastHoveredKeyRef.current = key
      const item = flatItems.find(i => i.key === key)
      if (!item?.pluginItem) return
      triggerPrewarm(item.pluginItem.pluginId, 200)
    }
    container.addEventListener('mouseover', handleMouseOver, { passive: true })
    return () => container.removeEventListener('mouseover', handleMouseOver)
  }, [flatItems, triggerPrewarm])

  useEffect(() => {
    return () => {
      for (const timer of prewarmTimersRef.current.values()) {
        clearTimeout(timer)
      }
      prewarmTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    onResultsChange?.(flatItems.length)
  }, [flatItems.length, onResultsChange])

  // Measure actual content height and report to parent for dynamic window sizing
  useEffect(() => {
    if (!onContentHeightChange) return
    const el = contentRef.current
    if (!el) return

    const report = () => {
      const h = el.scrollHeight
      onContentHeightChange(h)
    }

    // Initial measurement
    report()

    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [
    onContentHeightChange,
    flatItems.length,
    sections.length,
    expandedSections.best,
    expandedSections.apps,
    expandedSections.files,
    expandedSections.push
  ])

  useEffect(() => {
    if (flatItems.length === 0) {
      setSelectedKey('')
      return
    }
    setSelectedKey((prev) => {
      if (prev && flatItems.some((item) => item.key === prev)) {
        return prev
      }
      return flatItems[0].key
    })
  }, [flatItems])

  const handleRun = useCallback(async (item: RenderItem) => {
    if (item.type === 'main-push' && item.pushData) {
      try {
        const shouldOpenUI = await window.mulby.plugin.mainPushSelect(
          item.pushData.pluginName,
          {
            code: item.pushData.featureCode,
            type: 'text',
            payload: item.pushData.searchText,
            option: item.pushData.pushItem
          }
        )
        if (!shouldOpenUI) {
          window.mulby.window.hide()
        }
      } catch (error) {
        console.error('[PluginList] MainPush select failed:', error)
      }
      return
    }

    if (item.pluginItem) {
      const currentPayload = payloadRef.current
      const launchStart = Date.now()
      console.log(`[AttachmentTrace][Renderer] plugin run click | plugin=${item.pluginItem.pluginId} | feature=${item.pluginItem.featureCode} | startedAt=${launchStart} | ${formatPayloadTrace(currentPayload)}`)
      const result = await window.mulby.plugin.run(item.pluginItem.pluginId, item.pluginItem.featureCode, currentPayload, launchStart)
      if (result.success) {
        promoteRecent(item.pluginItem)
        if (!result.hasUI) {
          window.mulby.window.hide()
        }
      } else {
        console.error('Plugin error:', result.error)
      }
      return
    }

    const targetPath = item.appItem?.path || item.fileItem?.path
    if (!targetPath) return

    try {
      const openError = await window.mulby.shell.openPath(targetPath)
      if (openError) {
        console.error('[PluginList] Failed to open path:', openError)
        return
      }
      window.mulby.window.hide()
    } catch (error) {
      console.error('[PluginList] Failed to open system item:', error)
    }
  }, [promoteRecent])

  // 自定义右键菜单
  const contextMenu = useContextMenu()

  // 跨平台文案：「在 Finder/资源管理器/文件管理器 中显示」
  const revealLabel = useMemo(() => {
    const p = navigator.platform.toLowerCase()
    if (p.includes('mac')) return '在 Finder 中显示'
    if (p.includes('win')) return '在资源管理器中显示'
    return '在文件管理器中显示'
  }, [])

  // 跨平台文案：「移到废纸篓/回收站」
  const trashLabel = useMemo(() => {
    return navigator.platform.toLowerCase().includes('mac') ? '移到废纸篓' : '移到回收站'
  }, [])

  // 右键菜单：根据结果类型构建不同菜单项
  const handleItemContextMenu = useCallback(async (item: RenderItem, e: React.MouseEvent) => {
    const menuItems: ContextMenuItem[] = []

    if (item.type === 'plugin' || item.type === 'recent') {
      const isPinned = item.pluginItem ? pinnedKeys.has(getPluginKey(item.pluginItem)) : false

      if (isPinned) {
        menuItems.push({ id: 'unpin-feature', label: '取消置顶' })
      } else {
        menuItems.push({ id: 'pin-feature', label: '置顶此项' })
      }
      menuItems.push({ id: 'hide-feature', label: '隐藏此功能' })

      if (item.type === 'recent') {
        menuItems.push({ id: 'remove-recent', label: '从最近使用中移除' })
      }

      menuItems.push({ id: 'sep1', label: '', separator: true })

      if (item.pluginItem) {
        menuItems.push({ id: 'show-details', label: '查看插件详情' })
        menuItems.push({ id: 'config-shortcut', label: '配置快捷键' })
        menuItems.push({ id: 'copy-launch-link', label: '复制启动链接' })
      }

      if (item.pluginItem?.builtin === false) {
        menuItems.push({ id: 'sep2', label: '', separator: true })
        menuItems.push({ id: 'uninstall', label: '卸载此插件', danger: true })
      }
    } else if (item.type === 'system-app') {
      // 系统应用
      menuItems.push({ id: 'reveal-in-finder', label: revealLabel })
      menuItems.push({ id: 'copy-path', label: '复制路径' })
    } else if (item.type === 'system-file') {
      // 系统文件
      menuItems.push({ id: 'reveal-in-finder', label: revealLabel })
      menuItems.push({ id: 'copy-path', label: '复制路径' })
      menuItems.push({ id: 'copy-name', label: '复制文件名' })
      menuItems.push({ id: 'sep', label: '', separator: true })
      menuItems.push({ id: 'trash', label: trashLabel, danger: true })
    }

    if (menuItems.length === 0) return

    const selectedId = await contextMenu.show(menuItems, e)
    if (!selectedId) return

    const path = item.appItem?.path || item.fileItem?.path

    switch (selectedId) {
      case 'show-details':
        if (item.pluginItem) {
          onShowDetails?.(item.pluginItem.pluginName)
        }
        break
      case 'pin-feature':
        if (item.pluginItem) {
          const { pluginId, featureCode } = item.pluginItem
          void window.mulby.plugin.pinFeature(pluginId, featureCode).then(() => {
            setSearchPreferences(prev => ({
              ...prev,
              pinnedFeatures: [...prev.pinnedFeatures, { pluginId, featureCode, pinnedAt: Date.now() }]
            }))
          })
        }
        break
      case 'unpin-feature':
        if (item.pluginItem) {
          const { pluginId, featureCode } = item.pluginItem
          void window.mulby.plugin.unpinFeature(pluginId, featureCode).then(() => {
            setSearchPreferences(prev => ({
              ...prev,
              pinnedFeatures: prev.pinnedFeatures.filter(p => !(p.pluginId === pluginId && p.featureCode === featureCode))
            }))
          })
        }
        break
      case 'hide-feature':
        if (item.pluginItem) {
          const { pluginId, featureCode, displayName } = item.pluginItem
          const confirmResult = await window.mulby.dialog.showMessageBox({
            type: 'question',
            title: '确认隐藏',
            message: `确定要隐藏「${displayName}」吗？`,
            detail: '隐藏后该功能将不再出现在搜索结果中。\n你可以在「设置 › 插件管理」中重新启用。',
            buttons: ['取消', '隐藏'],
            defaultId: 0,
            cancelId: 0
          })
          if (confirmResult.response === 1) {
            void window.mulby.plugin.hideFeature(pluginId, featureCode).then(() => {
              setSearchPreferences(prev => ({
                ...prev,
                hiddenFeatures: [...prev.hiddenFeatures, { pluginId, featureCode, hiddenAt: Date.now() }],
                pinnedFeatures: prev.pinnedFeatures.filter(p => !(p.pluginId === pluginId && p.featureCode === featureCode))
              }))
              setRecentPlugins(curr => curr.filter(i => !(i.pluginId === pluginId && i.featureCode === featureCode)))
            })
          }
        }
        break
      case 'remove-recent':
        if (item.pluginItem) {
          const { pluginId, featureCode } = item.pluginItem
          void window.mulby.plugin.removeRecentUsage(pluginId, featureCode).then(() => {
            setRecentPlugins(curr => curr.filter(i => !(i.pluginId === pluginId && i.featureCode === featureCode)))
          })
        }
        break
      case 'config-shortcut':
        if (item.pluginItem) {
          void window.mulby.systemPage.open({
            page: 'settings',
            settingsSection: 'commandQuickLaunch',
            shortcutCommandHint: item.pluginItem.displayName
          })
          window.mulby.window.hide()
        }
        break
      case 'copy-launch-link':
        if (item.pluginItem) {
          const { pluginId, featureCode } = item.pluginItem
          const launchUrl = `mulby://plugin/run/${encodeURIComponent(pluginId)}/${encodeURIComponent(featureCode)}`
          void window.mulby.clipboard.writeText(launchUrl)
          window.mulby.notification.show('启动链接已复制到剪贴板')
        }
        break
      case 'uninstall':
        if (item.pluginItem) {
          const { pluginId, pluginName } = item.pluginItem
          const dialogResult = await window.mulby.dialog.showMessageBox({
            type: 'warning',
            title: '确认卸载',
            message: `确定要卸载插件 "${pluginName}" 吗？`,
            buttons: ['取消', '卸载'],
            defaultId: 0,
            cancelId: 0
          })
          if (dialogResult.response === 1) {
            void window.mulby.plugin.uninstall(pluginId).then(res => {
              if (res.success) {
                window.mulby.notification.show(`已卸载插件 "${pluginName}"`)
                // 清理脏数据：从当前搜索结果、最近使用和缓存中移除该插件
                setPluginResults(prev => prev.filter(p => p.pluginId !== pluginId))
                setRecentPlugins(prev => prev.filter(p => p.pluginId !== pluginId))
                pluginCacheRef.current.clear()
              } else {
                window.mulby.notification.show(`卸载失败: ${res.error}`, 'error')
              }
            })
          }
        }
        break
      case 'reveal-in-finder':
        if (path) {
          void window.mulby.shell.showItemInFolder(path)
        }
        break
      case 'copy-path':
        if (path) {
          void window.mulby.clipboard.writeText(path)
        }
        break
      case 'copy-name':
        if (item.fileItem) {
          void window.mulby.clipboard.writeText(item.fileItem.name)
        }
        break
      case 'trash':
        if (path) {
          void window.mulby.shell.trashItem(path)
        }
        break
    }
  }, [onShowDetails, contextMenu, revealLabel, trashLabel, pinnedKeys])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (flatItems.length === 0) return

      const currentIndex = Math.max(0, flatItems.findIndex((item) => item.key === selectedKey))
      const maxIndex = flatItems.length - 1

      const scrollToKey = (key: string) => {
        const container = scrollContainerRef.current
        if (!container) return
        const el = container.querySelector(`[data-item-key="${CSS.escape(key)}"]`)
        if (el) {
          el.scrollIntoView({ block: 'nearest' })
        }
      }

      const selectKey = (key: string | null) => {
        if (!key) return
        setSelectedKey(key)
        scrollToKey(key)
      }

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault()
          selectKey(getVerticalNavigationKey(sections, selectedKey, columns, 'up'))
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          selectKey(getVerticalNavigationKey(sections, selectedKey, columns, 'down'))
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          const nextIndex = Math.max(0, currentIndex - 1)
          const nextKey = flatItems[nextIndex].key
          setSelectedKey(nextKey)
          scrollToKey(nextKey)
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          const nextIndex = Math.min(maxIndex, currentIndex + 1)
          const nextKey = flatItems[nextIndex].key
          setSelectedKey(nextKey)
          scrollToKey(nextKey)
          break
        }
        case 'Enter':
          e.preventDefault()
          if (flatItems[currentIndex]) {
            void handleRun(flatItems[currentIndex])
          }
          break
        case 'i':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            const current = flatItems[currentIndex]
            if (current?.pluginItem) {
              onShowDetails?.(current.pluginItem.pluginName)
            }
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatItems, sections, selectedKey, columns, handleRun, onShowDetails])

  return (
    <div className="plugin-grid" role="listbox" aria-label="搜索结果" ref={scrollContainerRef}>
      <div className="plugin-grid-content" ref={contentRef}>
        {flatItems.length === 0 ? (
          <div className="result-empty">{isSearching ? '正在搜索...' : '没有匹配结果'}</div>
        ) : (
          sections.map((section) => {
            if (section.key === 'recent') {
              return (
                <section key="recent" className="result-section result-section-recent" aria-label={section.title}>
                  <div className="recent-bar" role="group" aria-label={section.title}>
                    {section.items.map((item) => {
                      return (
                        <div
                          key={item.key}
                          className={`recent-chip ${item.key === selectedKey ? 'selected' : ''}`}
                          role="option"
                          aria-selected={item.key === selectedKey}
                          data-item-key={item.key}
                          onClick={() => { void handleRun(item) }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            void handleItemContextMenu(item, e)
                          }}
                        >
                          <PluginIcon icon={item.icon} />
                          <span className="recent-chip-name">{item.title}</span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            }

            if (section.key === 'push') {
              const isPushExpanded = expandedSections.push
              return (
                <section key="push" className="result-section result-section-push" aria-label={section.title}>
                  <div className="result-section-title">
                    <span className="result-section-title-text">{section.title}</span>
                    {section.totalCount > PUSH_DISPLAY_LIMIT && (
                      <button
                        type="button"
                        className="result-section-expand-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleSectionExpand('push')
                        }}
                        onKeyDown={(e) => { e.stopPropagation() }}
                        aria-expanded={isPushExpanded}
                        aria-label={isPushExpanded ? '收起推送结果' : '展开全部推送结果'}
                      >
                        {isPushExpanded ? '收起' : `全部 (${section.totalCount})`}
                      </button>
                    )}
                  </div>
                  <div className="push-list" role="group" aria-label={section.title}>
                    {section.items.map((item) => (
                      <PushResultRow
                        key={item.key}
                        item={item}
                        isSelected={item.key === selectedKey}
                        onSelect={handleRun}
                      />
                    ))}
                  </div>
                </section>
              )
            }

            const sectionKey = section.key
            const isExpanded = expandedSections[sectionKey]

            return (
              <section key={sectionKey} className="result-section" aria-label={section.title}>
                <div className="result-section-title">
                  <span className="result-section-title-text">{section.title}</span>
                  {section.totalCount > DEFAULT_DISPLAY_LIMIT && (
                    <button
                      type="button"
                      className="result-section-expand-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSectionExpand(sectionKey)
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                      }}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? `收起${section.title}` : `展开${section.title}全部结果`}
                    >
                      {isExpanded ? '收起' : `全部 (${section.totalCount})`}
                    </button>
                  )}
                </div>
                <div className="result-section-grid" role="group" aria-label={section.title}>
                  {section.items.map((item) => {
                    return (
                      <ResultCard
                        key={item.key}
                        item={item}
                        isSelected={item.key === selectedKey}
                        isPinned={item.pluginItem ? pinnedKeys.has(getPluginKey(item.pluginItem)) : false}
                        onRun={handleRun}
                        onContextMenu={handleItemContextMenu}
                      />
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>
      {contextMenu.menu}
    </div>
  )
}

export default PluginList
