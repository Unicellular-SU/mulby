import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react'
import type {
  DesktopAppSearchResult,
  DesktopFileSearchResult,
  SearchResultItem,
  SystemIconKind,
  SystemIconRequest
} from '../../shared/types/electron'
import type { InputPayload } from '../../shared/types/plugin'

interface PluginListProps {
  payload: InputPayload
  traceId: number
  traceStartedAt: number
  traceSource: 'text' | 'attachments'
  traceInputLength: number
  traceAttachmentCount: number
  onResultsChange?: (count: number) => void
  onShowDetails?: (pluginName: string) => void
  onOpenSettings?: () => void
}

type ResultSectionKey = 'best' | 'apps' | 'files' | 'recent'
type RenderItemType = 'plugin' | 'recent' | 'system-app' | 'system-file'

interface RenderItem {
  key: string
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
  index: number
  onRun: (item: RenderItem) => void
  onHover: (index: number) => void
  onShowDetails?: (pluginName: string) => void
}

const SYSTEM_APP_SEARCH_LIMIT = 12
const SYSTEM_FILE_SEARCH_LIMIT = 12
const SYSTEM_FILE_STABLE_DELAY_MS = 260
const SYSTEM_ICON_TARGET_SIZE = 128
const SYSTEM_ICON_BATCH_CONCURRENCY = 6
const RECENT_LIMIT = 40
const MAX_CACHE_SIZE = 80

const SETTINGS_ITEM_ID = '__system_settings__'

const SETTINGS_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c0 .7.4 1.3 1.1 1.6.2.1.4.1.6.1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
</svg>
`.trim()

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

function roundPerfMs(value: number): number {
  return Math.round(value * 10) / 10
}

function logSearchPerf(stage: string, payload: Record<string, unknown>) {
  const message = JSON.stringify({
    stage,
    ...payload,
    nowMs: roundPerfMs(performance.now()),
    ts: Date.now()
  })
  console.log(`[search-perf] ${message}`)
}

// 简单哈希用于缓存键
function hashPayload(payload: InputPayload): string {
  return `${payload.text}|${payload.attachments.map((a) => `${a.id}:${a.name}`).join(',')}`
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

function getSearchScore(
  item: SearchResultItem,
  query: string,
  recentOrderMap: Map<string, number>
): number {
  const normalized = query.trim().toLowerCase()
  let score = getMatchWeight(item.matchType)

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

  const recentIndex = recentOrderMap.get(getPluginKey(item))
  if (recentIndex !== undefined) {
    score += Math.max(0, 70 - recentIndex)
  }

  return score
}

function isLooseMatch(item: SearchResultItem, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return (
    item.displayName.toLowerCase().includes(normalized) ||
    item.featureCode.toLowerCase().includes(normalized) ||
    item.featureExplain.toLowerCase().includes(normalized) ||
    item.pluginName.toLowerCase().includes(normalized)
  )
}

function trimPath(path: string): string {
  if (path.length <= 42) return path
  return `${path.slice(0, 20)}...${path.slice(-18)}`
}

function isSettingsItem(item: SearchResultItem): boolean {
  return item.pluginId === SETTINGS_ITEM_ID
}

function injectSettingsResult(results: SearchResultItem[], queryText: string) {
  const text = queryText.trim().toLowerCase()
  if (!text) return results

  const keywordMatch = /(settings|setting|preferences|prefs|设置|偏好)/i.test(text)
  if (!keywordMatch) return results

  const exists = results.some((item) => item.pluginId === SETTINGS_ITEM_ID)
  if (exists) return results

  const settingsItem: SearchResultItem = {
    pluginId: SETTINGS_ITEM_ID,
    pluginName: SETTINGS_ITEM_ID,
    displayName: '设置',
    featureCode: 'settings',
    featureExplain: '打开设置面板',
    matchType: 'keyword',
    icon: { type: 'svg', value: SETTINGS_ICON_SVG }
  }

  return [settingsItem, ...results]
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
  index,
  onRun,
  onHover,
  onShowDetails
}: ResultCardProps) {
  const isSettings = item.pluginItem ? isSettingsItem(item.pluginItem) : false
  const systemClass = item.type === 'system-app' || item.type === 'system-file' ? 'system' : ''
  return (
    <div
      className={`plugin-card ${systemClass} ${isSettings ? 'settings' : ''} ${isSelected ? 'selected' : ''}`}
      role="option"
      aria-selected={isSelected}
      onClick={() => onRun(item)}
      onMouseEnter={() => onHover(index)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!item.pluginItem || isSettings) return
        onShowDetails?.(item.pluginItem.pluginName)
      }}
    >
      <div className="plugin-card-top">
        <PluginIcon icon={item.icon} />
      </div>
      <div className="plugin-card-info">
        <span className="plugin-card-name">{item.title}</span>
        <span className="plugin-card-explain">{item.subtitle}</span>
      </div>
    </div>
  )
})

function PluginList({
  payload,
  traceId,
  traceStartedAt,
  traceSource,
  traceInputLength,
  traceAttachmentCount,
  onResultsChange,
  onShowDetails,
  onOpenSettings
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
  const [columns, setColumns] = useState(() => getColumns(window.innerWidth))
  const [systemIconVersion, setSystemIconVersion] = useState(0)

  const payloadRef = useRef(payload)
  const requestIdRef = useRef(0)
  const searchStartedAtRef = useRef(0)
  const searchStartedPayloadHashRef = useRef('')
  const searchStartedTraceIdRef = useRef(0)
  const launchedSearchTokenRef = useRef('')
  const renderLoggedKeyRef = useRef('')
  const pluginCacheRef = useRef<Map<string, SearchResultItem[]>>(new Map())
  const systemAppCacheRef = useRef<Map<string, DesktopAppSearchResult[]>>(new Map())
  const systemFileCacheRef = useRef<Map<string, DesktopFileSearchResult[]>>(new Map())
  const systemIconCacheRef = useRef<Map<string, string>>(new Map())
  const systemIconPendingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    payloadRef.current = payload
  }, [payload])

  useEffect(() => {
    let active = true
    const loadRecent = async () => {
      try {
        const recent = await window.intools.plugin.getRecentUsed(RECENT_LIMIT)
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

  const payloadHash = useMemo(() => hashPayload(payload), [payload.text, payload.attachments])
  const maxItemsPerSection = Math.max(columns * 2, 2)

  useEffect(() => {
    let cancelled = false
    let kickoffTimer: ReturnType<typeof setTimeout> | null = null
    let systemTimer: ReturnType<typeof setTimeout> | null = null

    const runSearch = () => {
      const currentPayload = payload
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

      logSearchPerf('search-start', {
        traceId,
        requestId: currentRequestId,
        source: traceSource,
        payloadHash,
        queryLength: currentPayload.text.length,
        attachmentCount: currentPayload.attachments.length,
        traceInputLength,
        traceAttachmentCount,
        sinceInputMs: traceStartedAt > 0 ? roundPerfMs(searchStartedAtRef.current - traceStartedAt) : undefined
      })

      const hasInput = currentPayload.text.trim().length > 0 || currentPayload.attachments.length > 0
      if (!hasInput) {
        setPluginResults([])
        setSystemApps([])
        setSystemFiles([])
        setSystemAppsResultHash('')
        setSystemFilesResultHash('')
        setIsPluginLoading(false)
        setIsSystemAppsLoading(false)
        setIsSystemFilesLoading(false)
        return
      }

      const cachedPlugins = pluginCacheRef.current.get(payloadHash)
      if (cachedPlugins) {
        setPluginResults(cachedPlugins)
        setIsPluginLoading(false)
        logSearchPerf('plugin-ready', {
          traceId,
          requestId: currentRequestId,
          payloadHash,
          source: 'cache',
          pluginCount: cachedPlugins.length,
          elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
        })
      } else {
        setIsPluginLoading(true)
        void window.intools.plugin.search(currentPayload)
          .then((result) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            const merged = dedupePluginResults(injectSettingsResult(result, currentPayload.text))
            setLruCache(pluginCacheRef.current, payloadHash, merged, MAX_CACHE_SIZE)
            setPluginResults(merged)
            logSearchPerf('plugin-ready', {
              traceId,
              requestId: currentRequestId,
              payloadHash,
              source: 'ipc',
              pluginCount: merged.length,
              elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
            })
          })
          .catch((error) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            console.warn('[PluginList] Plugin search failed', error)
            logSearchPerf('plugin-error', {
              traceId,
              requestId: currentRequestId,
              payloadHash,
              error: error instanceof Error ? error.message : String(error),
              elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
            })
          })
          .finally(() => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            setIsPluginLoading(false)
          })
      }

      const query = currentPayload.text.trim()
      const shouldSearchSystem = query.length > 0 && currentPayload.attachments.length === 0
      if (!shouldSearchSystem) {
        setSystemApps([])
        setSystemFiles([])
        setSystemAppsResultHash('')
        setSystemFilesResultHash('')
        setIsSystemAppsLoading(false)
        setIsSystemFilesLoading(false)
        return
      }

      const systemCacheKey = query.toLowerCase()
      const cachedApps = systemAppCacheRef.current.get(systemCacheKey)
      if (cachedApps) {
        setSystemApps(cachedApps)
        setSystemAppsResultHash(payloadHash)
        setIsSystemAppsLoading(false)
        logSearchPerf('system-app-ready', {
          traceId,
          requestId: currentRequestId,
          payloadHash,
          source: 'cache',
          appCount: cachedApps.length,
          elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
        })
      } else {
        setSystemApps([])
        setSystemAppsResultHash('')
        setIsSystemAppsLoading(true)

        void window.intools.desktop.searchApps(query, SYSTEM_APP_SEARCH_LIMIT)
          .then((apps) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            setLruCache(systemAppCacheRef.current, systemCacheKey, apps, MAX_CACHE_SIZE)
            setSystemApps(apps)
            setSystemAppsResultHash(payloadHash)
            logSearchPerf('system-app-ready', {
              traceId,
              requestId: currentRequestId,
              payloadHash,
              source: 'ipc',
              appCount: apps.length,
              elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
            })
          })
          .catch((error) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            logSearchPerf('system-app-error', {
              traceId,
              requestId: currentRequestId,
              payloadHash,
              error: error instanceof Error ? error.message : String(error),
              elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
            })
          })
          .finally(() => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            setIsSystemAppsLoading(false)
          })
      }

      const cachedFiles = systemFileCacheRef.current.get(systemCacheKey)
      if (cachedFiles) {
        setSystemFiles(cachedFiles)
        setSystemFilesResultHash(payloadHash)
        setIsSystemFilesLoading(false)
        logSearchPerf('system-file-ready', {
          traceId,
          requestId: currentRequestId,
          payloadHash,
          source: 'cache',
          fileCount: cachedFiles.length,
          elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
        })
      } else {
        setSystemFiles([])
        setSystemFilesResultHash('')
        setIsSystemFilesLoading(false)

        systemTimer = setTimeout(() => {
          if (cancelled || currentRequestId !== requestIdRef.current) return
          setIsSystemFilesLoading(true)
          void window.intools.desktop.searchFiles(query, SYSTEM_FILE_SEARCH_LIMIT).then((files) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            setLruCache(systemFileCacheRef.current, systemCacheKey, files, MAX_CACHE_SIZE)
            setSystemFiles(files)
            setSystemFilesResultHash(payloadHash)
            logSearchPerf('system-file-ready', {
              traceId,
              requestId: currentRequestId,
              payloadHash,
              source: 'ipc',
              fileCount: files.length,
              elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
            })
          }).catch((error) => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            logSearchPerf('system-file-error', {
              traceId,
              requestId: currentRequestId,
              payloadHash,
              error: error instanceof Error ? error.message : String(error),
              elapsedMs: roundPerfMs(performance.now() - searchStartedAtRef.current)
            })
          }).finally(() => {
            if (cancelled || currentRequestId !== requestIdRef.current) return
            setIsSystemFilesLoading(false)
          })
        }, SYSTEM_FILE_STABLE_DELAY_MS)
      }
    }

    if (import.meta.env.DEV) {
      kickoffTimer = setTimeout(runSearch, 0)
    } else {
      runSearch()
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
  }, [payload, payloadHash, traceAttachmentCount, traceId, traceInputLength, traceSource, traceStartedAt])

  const promoteRecent = useCallback((pluginItem: SearchResultItem) => {
    setRecentPlugins((prev) => {
      const key = getPluginKey(pluginItem)
      const next = [pluginItem, ...prev.filter((item) => getPluginKey(item) !== key)]
      return next.slice(0, RECENT_LIMIT)
    })
  }, [])

  const recentOrderMap = useMemo(() => {
    const map = new Map<string, number>()
    recentPlugins.forEach((item, index) => {
      map.set(getPluginKey(item), index)
    })
    return map
  }, [recentPlugins])

  const bestPlugins = useMemo(() => {
    const sorted = dedupePluginResults(pluginResults).slice()
    sorted.sort((a, b) => {
      const scoreDiff = getSearchScore(b, payload.text, recentOrderMap) - getSearchScore(a, payload.text, recentOrderMap)
      if (scoreDiff !== 0) return scoreDiff
      return a.displayName.localeCompare(b.displayName)
    })
    return sorted.slice(0, maxItemsPerSection)
  }, [pluginResults, payload.text, recentOrderMap, maxItemsPerSection])

  const bestKeys = useMemo(() => {
    return new Set(bestPlugins.map((item) => getPluginKey(item)))
  }, [bestPlugins])

  const recentDisplayItems = useMemo(() => {
    const filtered = payload.text.trim().length > 0
      ? recentPlugins.filter((item) => isLooseMatch(item, payload.text))
      : recentPlugins
    return filtered
      .filter((item) => !bestKeys.has(getPluginKey(item)))
      .slice(0, maxItemsPerSection)
  }, [recentPlugins, payload.text, bestKeys, maxItemsPerSection])

  const appDisplayItems = useMemo(() => {
    const seen = new Set<string>()
    const sourceApps = systemAppsResultHash === payloadHash ? systemApps : []
    return sourceApps
      .filter((item) => {
        if (seen.has(item.path)) return false
        seen.add(item.path)
        return true
      })
      .slice(0, maxItemsPerSection)
  }, [maxItemsPerSection, payloadHash, systemApps, systemAppsResultHash])

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
      .slice(0, maxItemsPerSection)
  }, [maxItemsPerSection, payloadHash, systemFiles, systemFilesResultHash])

  useEffect(() => {
    const requests: SystemIconRequest[] = [
      ...appDisplayItems.map((item) => ({
        key: getSystemIconCacheKey('app', item.path),
        path: item.path,
        kind: 'app' as const
      })),
      ...fileDisplayItems.map((item) => ({
        key: getSystemIconCacheKey('file', item.path),
        path: item.path,
        kind: 'file' as const
      }))
    ]
    if (requests.length === 0) return

    const pendingRequests = requests.filter((request) => {
      if (systemIconCacheRef.current.has(request.key)) return false
      if (systemIconPendingRef.current.has(request.key)) return false
      return true
    })
    if (pendingRequests.length === 0) return

    const pendingKeys = pendingRequests.map((request) => request.key)
    pendingKeys.forEach((key) => systemIconPendingRef.current.add(key))

    const iconBatchStartedAt = performance.now()
    logSearchPerf('icon-batch-start', {
      traceId,
      payloadHash,
      requestCount: pendingRequests.length
    })

    void window.intools.system.getFileIcons(pendingRequests, {
      size: SYSTEM_ICON_TARGET_SIZE,
      concurrency: SYSTEM_ICON_BATCH_CONCURRENCY
    })
      .then((results) => {
        if (!Array.isArray(results)) return

        let changed = false
        let validCount = 0

        for (const result of results) {
          if (!result.icon || !isValidIconDataUrl(result.icon)) {
            if (result.icon) {
              logSearchPerf('icon-invalid', {
                traceId,
                payloadHash,
                targetPath: result.path,
                cacheKey: result.key,
                dataUrlLength: result.icon.length,
                dataUrlPrefix: result.icon.slice(0, 48)
              })
            }
            continue
          }

          validCount += 1
          if (systemIconCacheRef.current.get(result.key) === result.icon) {
            continue
          }
          systemIconCacheRef.current.set(result.key, result.icon)
          changed = true
        }

        logSearchPerf('icon-batch-ready', {
          traceId,
          payloadHash,
          requestCount: pendingRequests.length,
          resultCount: results.length,
          validCount,
          elapsedMs: roundPerfMs(performance.now() - iconBatchStartedAt)
        })

        if (changed) {
          setSystemIconVersion((prev) => prev + 1)
        }
      })
      .catch((error) => {
        logSearchPerf('icon-batch-error', {
          traceId,
          payloadHash,
          requestCount: pendingRequests.length,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: roundPerfMs(performance.now() - iconBatchStartedAt)
        })
      })
      .finally(() => {
        pendingKeys.forEach((key) => systemIconPendingRef.current.delete(key))
      })
  }, [appDisplayItems, fileDisplayItems, payloadHash, traceId])

  const sections = useMemo((): ResultSection[] => {
    const next: ResultSection[] = []

    const bestItems: RenderItem[] = bestPlugins.map((item) => ({
      key: `plugin:${getPluginKey(item)}`,
      type: 'plugin',
      title: item.displayName,
      subtitle: item.featureExplain,
      icon: item.icon,
      pluginItem: item
    }))
    if (bestItems.length > 0) {
      next.push({ key: 'best', title: '最佳匹配插件', items: bestItems })
    }

    const apps: RenderItem[] = appDisplayItems.map((item) => ({
      key: `app:${item.path}`,
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

    const recentItems: RenderItem[] = recentDisplayItems.map((item) => ({
      key: `recent:${getPluginKey(item)}`,
      type: 'recent',
      title: item.displayName,
      subtitle: item.featureExplain,
      icon: item.icon,
      pluginItem: item
    }))
    if (recentItems.length > 0) {
      next.push({ key: 'recent', title: '最近使用插件', items: recentItems })
    }

    return next
  }, [bestPlugins, appDisplayItems, fileDisplayItems, recentDisplayItems, systemIconVersion])

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections])
  const isSystemLoading = isSystemAppsLoading || isSystemFilesLoading
  const isSearching = isPluginLoading || isSystemLoading
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatItems.forEach((item, index) => map.set(item.key, index))
    return map
  }, [flatItems])

  useEffect(() => {
    onResultsChange?.(flatItems.length)
  }, [flatItems.length, onResultsChange])

  useEffect(() => {
    const renderKey = `${traceId}:${payloadHash}:${flatItems.length}:${isSearching ? 1 : 0}`
    if (renderLoggedKeyRef.current === renderKey) {
      return
    }
    renderLoggedKeyRef.current = renderKey

    const sectionSizes = {
      best: sections.find((section) => section.key === 'best')?.items.length ?? 0,
      apps: sections.find((section) => section.key === 'apps')?.items.length ?? 0,
      files: sections.find((section) => section.key === 'files')?.items.length ?? 0,
      recent: sections.find((section) => section.key === 'recent')?.items.length ?? 0
    }

    requestAnimationFrame(() => {
      const now = performance.now()
      const hasSearchStart = searchStartedPayloadHashRef.current === payloadHash &&
        searchStartedAtRef.current > 0 &&
        searchStartedTraceIdRef.current === traceId
      logSearchPerf('render-commit', {
        traceId,
        payloadHash,
        totalCount: flatItems.length,
        isSearching,
        isPluginLoading,
        isSystemLoading,
        isSystemAppsLoading,
        isSystemFilesLoading,
        sections: sectionSizes,
        sinceSearchStartMs: hasSearchStart ? roundPerfMs(now - searchStartedAtRef.current) : undefined,
        sinceInputMs: traceStartedAt > 0 ? roundPerfMs(now - traceStartedAt) : undefined
      })
    })
  }, [
    flatItems.length,
    isPluginLoading,
    isSearching,
    isSystemAppsLoading,
    isSystemFilesLoading,
    isSystemLoading,
    payloadHash,
    sections,
    traceId,
    traceStartedAt
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
    if (item.pluginItem) {
      if (isSettingsItem(item.pluginItem)) {
        onOpenSettings?.()
        return
      }

      const currentPayload = payloadRef.current
      const result = await window.intools.plugin.run(item.pluginItem.pluginId, item.pluginItem.featureCode, currentPayload)
      if (result.success) {
        promoteRecent(item.pluginItem)
        if (!result.hasUI) {
          window.intools.window.hide()
        }
      } else {
        console.error('Plugin error:', result.error)
      }
      return
    }

    const targetPath = item.appItem?.path || item.fileItem?.path
    if (!targetPath) return

    try {
      const openError = await window.intools.shell.openPath(targetPath)
      if (openError) {
        console.error('[PluginList] Failed to open path:', openError)
        return
      }
      window.intools.window.hide()
    } catch (error) {
      console.error('[PluginList] Failed to open system item:', error)
    }
  }, [onOpenSettings, promoteRecent])

  const handleHover = useCallback((index: number) => {
    const item = flatItems[index]
    if (!item) return
    setSelectedKey(item.key)
  }, [flatItems])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (flatItems.length === 0) return

      const currentIndex = Math.max(0, flatItems.findIndex((item) => item.key === selectedKey))
      const maxIndex = flatItems.length - 1

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault()
          const nextIndex = currentIndex - columns
          if (nextIndex >= 0) {
            setSelectedKey(flatItems[nextIndex].key)
          }
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = currentIndex + columns
          if (nextIndex <= maxIndex) {
            setSelectedKey(flatItems[nextIndex].key)
          }
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          const nextIndex = Math.max(0, currentIndex - 1)
          setSelectedKey(flatItems[nextIndex].key)
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          const nextIndex = Math.min(maxIndex, currentIndex + 1)
          setSelectedKey(flatItems[nextIndex].key)
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
            if (current?.pluginItem && !isSettingsItem(current.pluginItem)) {
              onShowDetails?.(current.pluginItem.pluginName)
            }
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatItems, selectedKey, columns, handleRun, onShowDetails])

  if (flatItems.length === 0) {
    return (
      <div className="plugin-grid" role="listbox" aria-label="搜索结果">
        <div className="result-empty">{isSearching ? '正在搜索...' : '没有匹配结果'}</div>
      </div>
    )
  }

  return (
    <div className="plugin-grid" role="listbox" aria-label="搜索结果">
      {sections.map((section) => (
        <section key={section.key} className="result-section" aria-label={section.title}>
          <div className="result-section-title">{section.title}</div>
          <div className="result-section-grid" role="group" aria-label={section.title}>
            {section.items.map((item) => {
              const index = flatIndexMap.get(item.key) ?? 0
              return (
                <ResultCard
                  key={item.key}
                  item={item}
                  index={index}
                  isSelected={item.key === selectedKey}
                  onRun={(value) => {
                    void handleRun(value)
                  }}
                  onHover={handleHover}
                  onShowDetails={onShowDetails}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export default PluginList
