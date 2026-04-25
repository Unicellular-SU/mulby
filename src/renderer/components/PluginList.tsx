import { useState, useEffect, useLayoutEffect, useCallback, useRef, memo, useMemo } from 'react'
import { useContextMenu, type ContextMenuItem } from './ContextMenu'
import type {
  DesktopAppSearchResult,
  DesktopFileSearchResult,
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

type ResultSectionKey = 'best' | 'apps' | 'files' | 'recent'
type RenderItemType = 'plugin' | 'recent' | 'system-app' | 'system-file'

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
}

interface ResultSection {
  key: ResultSectionKey
  title: string
  items: RenderItem[]
}

interface ResultCardProps {
  item: RenderItem
  isSelected: boolean
  isPinned?: boolean
  onRun: (item: RenderItem) => Promise<void>
  onContextMenu?: (item: RenderItem, e: React.MouseEvent) => void
}

const SYSTEM_APP_SEARCH_LIMIT = 12
const SYSTEM_FILE_SEARCH_LIMIT = 12
const SYSTEM_FILE_STABLE_DELAY_MS = 260
const SYSTEM_ICON_TARGET_SIZE = 128
const SYSTEM_ICON_BATCH_CONCURRENCY = 6
const RECENT_LIMIT = 40
const MAX_CACHE_SIZE = 80
const PREWARM_DEDUPE_MS = 20_000

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
    return (
      <div className="plugin-icon plugin-icon-default">
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      </div>
    )
  }

  if (icon.type === 'svg') {
    return <div className="plugin-icon" dangerouslySetInnerHTML={{ __html: icon.value }} />
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

  const payloadRef = useRef(runPayload)
  const requestIdRef = useRef(0)
  const searchStartedAtRef = useRef(0)
  const searchStartedPayloadHashRef = useRef('')
  const searchStartedTraceIdRef = useRef(0)
  const launchedSearchTokenRef = useRef('')

  const pluginCacheRef = useRef<Map<string, SearchResultItem[]>>(new Map())
  const systemAppCacheRef = useRef<Map<string, DesktopAppSearchResult[]>>(new Map())
  const systemFileCacheRef = useRef<Map<string, DesktopFileSearchResult[]>>(new Map())
  const systemIconCacheRef = useRef<Map<string, string>>(new Map())
  const systemIconPendingRef = useRef<Set<string>>(new Set())
  // 搜索设置：控制是否搜索本机应用和文件
  const searchSettingsRef = useRef<SearchSettings>({ enableApps: true, enableFiles: false })

  const [searchPreferences, setSearchPreferences] = useState<SearchPreferenceState>({ pinnedFeatures: [], hiddenFeatures: [] })

  // 使用 useLayoutEffect 在 DOM 提交后同步更新 ref：
  // - 比 useEffect 更早执行，在用户的 click/keydown 事件触发前完成，避免 handleRun 读取到旧 payload（附件丢失）
  // - 比渲染阶段赋值更安全，不会因 concurrent rendering 下未提交的渲染泄漏不一致的 payload
  useLayoutEffect(() => {
    payloadRef.current = runPayload
  }, [runPayload])

  // 挂载时获取搜索设置
  useEffect(() => {
    void window.mulby.settings.get().then(({ settings }) => {
      if (settings?.search) {
        searchSettingsRef.current = settings.search
      }
    }).catch(() => {
      // 获取设置失败，保持默认值
    })

    let active = true
    void window.mulby.plugin.getSearchPreferences().then(prefs => {
      if (active) setSearchPreferences(prefs)
    }).catch(() => {})

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

  const payloadHash = useMemo(() => hashPayload(searchPayload), [searchPayload.text, searchPayload.attachments])

  useEffect(() => {
    let cancelled = false
    let kickoffTimer: ReturnType<typeof setTimeout> | null = null
    let systemTimer: ReturnType<typeof setTimeout> | null = null

    const runSearch = () => {
      const currentPayload = searchPayload
      const searchToken = `${traceId}:${payloadHash}`
      if (launchedSearchTokenRef.current === searchToken) {
        return
      }
      launchedSearchTokenRef.current = searchToken

      const currentRequestId = requestIdRef.current + 1
      requestIdRef.current = currentRequestId
      searchStartedAtRef.current = performance.now()
      searchStartedPayloadHashRef.current = payloadHash
      searchStartedTraceIdRef.current = traceId



      const hasInput = currentPayload.text.trim().length > 0 || currentPayload.attachments.length > 0
      if (!hasInput) {
        // 即使无输入，也调用 plugin.search 以支持窗口匹配（CmdWindow）
        // 主进程会注入 activeWindow 上下文并返回 window 匹配的插件
        setSystemApps([])
        setSystemFiles([])
        setSystemAppsResultHash('')
        setSystemFilesResultHash('')
        setIsSystemAppsLoading(false)
        setIsSystemFilesLoading(false)

        const emptyCache = pluginCacheRef.current.get(payloadHash)
        if (emptyCache) {
          setPluginResults(emptyCache)
          setIsPluginLoading(false)
          return
        }

        setIsPluginLoading(true)
        void window.mulby.plugin.search(currentPayload)
          .then((result) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            const merged = dedupePluginResults(result)
            setLruCache(pluginCacheRef.current, payloadHash, merged, MAX_CACHE_SIZE)
            setPluginResults(merged)
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

      const cachedPlugins = pluginCacheRef.current.get(payloadHash)
      if (cachedPlugins) {
        setPluginResults(cachedPlugins)
        setIsPluginLoading(false)

      } else {
        setIsPluginLoading(true)
        void window.mulby.plugin.search(currentPayload)
          .then((result) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            const merged = dedupePluginResults(result)
            setLruCache(pluginCacheRef.current, payloadHash, merged, MAX_CACHE_SIZE)
            setPluginResults(merged)

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
      const shouldSearchApps = hasTextOnlyInput && isSystemSearchQueryEligible(query) && searchSettingsRef.current.enableApps
      const shouldSearchFiles = hasTextOnlyInput && isSystemSearchQueryEligible(query) && searchSettingsRef.current.enableFiles && query.length >= 2

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
  }, [payloadHash, searchPayload, traceAttachmentCount, traceId, traceInputLength, traceSource, traceStartedAt])

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
    const sorted = dedupePluginResults(pluginResults)
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
  }, [pluginResults, searchPayload.text, frecencyMap, hiddenKeys, pinnedKeys])

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
  }, [recentPlugins, searchPayload.text, bestKeys, frecencyMap])

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

  // 懒加载系统图标：只对可视区内的卡片请求图标
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // 收集所有需要图标的数据
    const allIconTargets = new Map<string, { path: string; kind: 'app' | 'file' }>()
    for (const item of appDisplayItems) {
      const key = getSystemIconCacheKey('app', item.path)
      if (!systemIconCacheRef.current.has(key)) {
        allIconTargets.set(key, { path: item.iconPath || item.path, kind: item.iconPath ? 'file' : 'app' })
      }
    }
    for (const item of fileDisplayItems) {
      const key = getSystemIconCacheKey('file', item.path)
      if (!systemIconCacheRef.current.has(key)) {
        allIconTargets.set(key, { path: item.path, kind: 'file' })
      }
    }

    if (allIconTargets.size === 0) return

    // 用 IntersectionObserver 监控系统类型卡片，只有进入视口才加载图标
    const pendingBatch: SystemIconRequest[] = []
    let batchTimer: ReturnType<typeof setTimeout> | null = null

    const flushBatch = () => {
      batchTimer = null
      if (pendingBatch.length === 0) return
      const batch = pendingBatch.splice(0)
      const batchKeys = batch.map(r => r.key)

      // 标记 pending
      batchKeys.forEach(k => systemIconPendingRef.current.add(k))

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
            setSystemIconVersion(prev => prev + 1)
          }
        })
        .catch(() => { /* ignore icon load errors */ })
        .finally(() => {
          batchKeys.forEach(k => systemIconPendingRef.current.delete(k))
        })
    }

    const scheduleBatch = (request: SystemIconRequest) => {
      pendingBatch.push(request)
      if (batchTimer === null) {
        batchTimer = setTimeout(flushBatch, 80)
      }
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target as HTMLElement
        const itemKey = el.dataset.iconKey
        if (!itemKey) continue

        const target = allIconTargets.get(itemKey)
        if (!target) continue
        if (systemIconCacheRef.current.has(itemKey)) continue
        if (systemIconPendingRef.current.has(itemKey)) continue

        scheduleBatch({ key: itemKey, path: target.path, kind: target.kind })
        observer.unobserve(el)
      }
    }, { root: container, rootMargin: '100px' })

    // 观察所有系统卡片
    const cards = container.querySelectorAll('[data-icon-key]')
    cards.forEach(card => observer.observe(card))

    return () => {
      observer.disconnect()
      if (batchTimer !== null) clearTimeout(batchTimer)
    }
  }, [appDisplayItems, fileDisplayItems, payloadHash, traceId])

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
      next.push({ key: 'recent', title: '最近使用', items: recentItems })
    }

    const bestItems: RenderItem[] = bestPlugins.map((item) => ({
      key: `plugin:${getPluginKey(item)}`,
      type: 'plugin',
      title: item.featureExplain || item.displayName,
      subtitle: item.displayName,
      icon: item.icon,
      pluginItem: item
    }))
    if (bestItems.length > 0) {
      next.push({ key: 'best', title: '最佳匹配插件', items: bestItems })
    }

    const apps: RenderItem[] = appDisplayItems.map((item) => ({
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
    if (apps.length > 0) {
      next.push({ key: 'apps', title: '系统应用', items: apps })
    }

    const files: RenderItem[] = fileDisplayItems.map((item) => ({
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
    if (files.length > 0) {
      next.push({ key: 'files', title: '系统文件', items: files })
    }

    return next
  }, [bestPlugins, appDisplayItems, fileDisplayItems, recentDisplayItems, systemIconVersion, columns])

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections])
  const isSystemLoading = isSystemAppsLoading || isSystemFilesLoading
  const isSearching = isPluginLoading || isSystemLoading

  // 搜索预热：选中项变化或鼠标悬停时提前初始化 Host
  const prewarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPrewarmedRef = useRef<{ pluginId: string; expiresAt: number }>({ pluginId: '', expiresAt: 0 })

  const triggerPrewarm = useCallback((pluginId: string, debounceMs = 120) => {
    const now = Date.now()
    const lastPrewarmed = lastPrewarmedRef.current
    if (pluginId === lastPrewarmed.pluginId && now < lastPrewarmed.expiresAt) return
    if (prewarmTimerRef.current) clearTimeout(prewarmTimerRef.current)
    prewarmTimerRef.current = setTimeout(() => {
      prewarmTimerRef.current = null
      lastPrewarmedRef.current = {
        pluginId,
        expiresAt: Date.now() + PREWARM_DEDUPE_MS
      }
      void window.mulby.plugin.prewarm(pluginId)
    }, debounceMs)
  }, [])

  // Reset across searches; within a search, the dedupe expires with the main-process prewarm TTL.
  useEffect(() => {
    lastPrewarmedRef.current = { pluginId: '', expiresAt: 0 }
  }, [searchPayload.text])

  // 键盘选中项 / 搜索结果自动选中 → 预热
  useEffect(() => {
    if (searchPayload.text.trim().length < 2) return
    const selectedItem = flatItems.find(item => item.key === selectedKey)
    if (!selectedItem?.pluginItem) return
    triggerPrewarm(selectedItem.pluginItem.pluginId)
  }, [selectedKey, flatItems, searchPayload.text, triggerPrewarm])

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
      if (prewarmTimerRef.current) clearTimeout(prewarmTimerRef.current)
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
  }, [onContentHeightChange, flatItems.length, sections.length])

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
    if (item.pluginItem) {
      const currentPayload = payloadRef.current
      const launchStart = Date.now()
      console.log(`[LaunchTrace] 🚀 User clicked plugin "${item.pluginItem.displayName}" (${item.pluginItem.pluginId}/${item.pluginItem.featureCode}) at ${launchStart}`)
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

      // 仅非内置插件显示卸载选项
      if (item.pluginItem) {
        try {
          const allPlugins = await window.mulby.plugin.getAll()
          const pluginInfo = allPlugins.find((p: { id: string }) => p.id === item.pluginItem!.pluginId)
          if (pluginInfo && !pluginInfo.builtin) {
            menuItems.push({ id: 'sep2', label: '', separator: true })
            menuItems.push({ id: 'uninstall', label: '卸载此插件', danger: true })
          }
        } catch {
          // 获取插件列表失败时不显示卸载按钮，安全优先
        }
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
              setSearchPreferences(prev => ({ ...prev, 
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

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault()
          const nextIndex = currentIndex - columns
          if (nextIndex >= 0) {
            const nextKey = flatItems[nextIndex].key
            setSelectedKey(nextKey)
            scrollToKey(nextKey)
          }
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = currentIndex + columns
          if (nextIndex <= maxIndex) {
            const nextKey = flatItems[nextIndex].key
            setSelectedKey(nextKey)
            scrollToKey(nextKey)
          }
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
  }, [flatItems, selectedKey, columns, handleRun, onShowDetails])

  return (
    <div className="plugin-grid" role="listbox" aria-label="搜索结果" ref={scrollContainerRef}>
      <div className="plugin-grid-content" ref={contentRef}>
        {flatItems.length === 0 ? (
          <div className="result-empty">{isSearching ? '正在搜索...' : '没有匹配结果'}</div>
        ) : (
          sections.map((section) => (
            section.key === 'recent' ? (
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
            ) : (
              <section key={section.key} className="result-section" aria-label={section.title}>
                <div className="result-section-title">{section.title}</div>
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
          ))
        )}
      </div>
      {contextMenu.menu}
    </div>
  )
}

export default PluginList
