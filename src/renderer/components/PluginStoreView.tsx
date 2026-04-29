import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StoreSource } from '../../shared/types/settings'
import type {
  PluginStoreEntry,
  PluginStoreSourceSyncResult
} from '../../shared/types/plugin-store'
import { clearRemoteImageCache } from '../hooks/useCachedRemoteImage'
import useStorePluginInstall from '../hooks/useStorePluginInstall'
import {
  buildStoreSearchText,
  collectStoreCategories,
  formatStoreSyncTime,
  getPluginTypeLabel,
  getStorePluginDisplayName,
  getStoreStatusMeta,
  getStoreTransportMeta,
  sortStoreEntries,
  STORE_BUTTON_GHOST,
  STORE_BUTTON_PRIMARY,
  type StoreSortKey
} from '../utils/plugin-store-helpers'
import StorePageLayout from './StorePageLayout'
import StorePluginIcon from './StorePluginIcon'

interface PluginStoreViewProps {
  onBack: () => void
  onOpenDetails: (entry: PluginStoreEntry) => void
}

const SORT_OPTIONS: { key: StoreSortKey; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'name', label: '按名称' },
  { key: 'updated', label: '按更新' },
  { key: 'installed-first', label: '已安装优先' }
]

const UNCATEGORIZED_KEY = '__uncategorized__'

function PluginCardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-full animate-pulse rounded-full bg-slate-100 dark:bg-slate-800/60" />
          <div className="h-3 w-4/5 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800/60" />
        </div>
      </div>
      <div className="mt-auto flex items-center justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
        <div className="h-9 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800/60" />
        <div className="h-9 w-20 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  )
}

const StorePluginCard = memo(function StorePluginCard({
  entry,
  installing,
  onOpenDetails,
  onInstall
}: {
  entry: PluginStoreEntry
  installing: boolean
  onOpenDetails: (entry: PluginStoreEntry) => void
  onInstall: (entry: PluginStoreEntry) => void
}) {
  const plugin = entry.plugin
  const transportMeta = getStoreTransportMeta(plugin.downloadUrl)
  const statusMeta = getStoreStatusMeta(entry.installState.status)
  const pluginTitle = getStorePluginDisplayName(plugin)
  const disabled =
    entry.installState.status === 'installed' || installing || !transportMeta.allowInstall
  const buttonLabel =
    entry.installState.status === 'updatable'
      ? '更新'
      : entry.installState.status === 'installed'
        ? '已安装'
        : '安装'

  return (
    <div className="group flex h-full flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white p-4 transition hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-4 text-left"
        onClick={() => onOpenDetails(entry)}
      >
        <StorePluginIcon plugin={plugin} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 transition group-hover:text-slate-700 dark:text-white dark:group-hover:text-slate-100">
              {pluginTitle}
            </span>
            <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
              v{plugin.version}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusMeta.className}`}>
              {statusMeta.label}
            </span>
          </div>
          <div className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {plugin.description}
          </div>
          {plugin.author && (
            <div className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
              by {plugin.author}
            </div>
          )}
        </div>
      </button>

      <div className="mt-auto flex items-center justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          onClick={() => onOpenDetails(entry)}
        >
          详情
        </button>
        <button
          type="button"
          className={
            entry.installState.status === 'updatable'
              ? 'inline-flex h-9 min-w-[88px] items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-4 text-sm text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
              : 'inline-flex h-9 min-w-[88px] items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
          }
          disabled={disabled}
          onClick={() => onInstall(entry)}
        >
          {installing ? (
            <span className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
              </svg>
              处理中
            </span>
          ) : (
            buttonLabel
          )}
        </button>
      </div>
    </div>
  )
})

function StoreEmptyState({
  loading,
  hasQuery,
  hasSources,
  onClearQuery,
  onOpenSourceModal,
  onRefresh
}: {
  loading: boolean
  hasQuery: boolean
  hasSources: boolean
  onClearQuery: () => void
  onOpenSourceModal: () => void
  onRefresh: () => void
}) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <PluginCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (hasQuery) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <svg className="h-6 w-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">未找到匹配的插件</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">尝试使用不同的关键词搜索</p>
        <button
          className="mt-4 inline-flex h-8 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-xs text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          onClick={onClearQuery}
        >
          清除搜索
        </button>
      </div>
    )
  }

  if (!hasSources) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <svg className="h-6 w-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">还没有添加仓库源</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">添加一个插件仓库源，开始浏览和安装插件</p>
        <button
          className="mt-4 inline-flex h-8 items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-4 text-xs text-white transition hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          onClick={onOpenSourceModal}
        >
          添加仓库源
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <svg className="h-6 w-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path d="M12 8v4l3 3" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">暂无可安装的插件</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">点击加载仓库以获取最新插件列表</p>
      <button
        className="mt-4 inline-flex h-8 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-xs text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
        onClick={onRefresh}
      >
        加载仓库
      </button>
    </div>
  )
}

function SourceManagementModal({
  open,
  sources,
  storeSourceStates,
  onClose,
  onAdd,
  onToggle,
  onRemove
}: {
  open: boolean
  sources: StoreSource[]
  storeSourceStates: PluginStoreSourceSyncResult[]
  onClose: () => void
  onAdd: (name: string, url: string) => Promise<void>
  onToggle: (id: string, enabled: boolean) => void
  onRemove: (id: string) => void
}) {
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      setConfirmDeleteId(null)
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [open])

  if (!open) return null

  const handleAdd = async () => {
    const name = newName.trim()
    const url = newUrl.trim()
    if (!name || !url) {
      setError('名称和地址不能为空')
      return
    }
    try {
      new URL(url)
    } catch {
      setError('地址格式不正确')
      return
    }
    setError(null)
    setNewName('')
    setNewUrl('')
    await onAdd(name, url)
    nameInputRef.current?.focus()
  }

  const handleRemove = (id: string) => {
    if (confirmDeleteId === id) {
      onRemove(id)
      setConfirmDeleteId(null)
    } else {
      setConfirmDeleteId(id)
    }
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/45 px-4 py-6 no-drag"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="仓库源管理"
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">仓库源管理</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              统一维护插件索引 URL，不占用在线插件列表空间。
            </div>
          </div>
          <button
            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto px-5 py-4">
          <div className="space-y-3">
            {sources.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">还没有添加任何插件源。</div>
            ) : (
              sources.map((source) => {
                const syncState = storeSourceStates.find((item) => item.sourceId === source.id)
                const isConfirmingDelete = confirmDeleteId === source.id
                return (
                  <div
                    key={source.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/70"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{source.name}</div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{source.url}</div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        最近同步：{formatStoreSyncTime(syncState?.lastSyncAt ?? source.lastSyncAt)}
                        {((syncState && !syncState.success) || source.lastError) && (
                          <span className="ml-2 text-red-500">{syncState?.error || source.lastError}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className={`rounded-full px-3 py-1 text-xs transition ${
                          source.enabled
                            ? 'border border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                            : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                        }`}
                        onClick={() => onToggle(source.id, !source.enabled)}
                      >
                        {source.enabled ? '已启用' : '已停用'}
                      </button>
                      <button
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          isConfirmingDelete
                            ? 'border-red-300 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
                        }`}
                        onClick={() => handleRemove(source.id)}
                      >
                        {isConfirmingDelete ? '确认删除' : '删除'}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)_100px]">
            <input
              ref={nameInputRef}
              className={`rounded-xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300 dark:bg-slate-950 dark:text-slate-200 ${
                error && !newName.trim()
                  ? 'border-red-300 dark:border-red-500/40'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
              placeholder="来源名称"
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAdd()
              }}
            />
            <input
              className={`rounded-xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300 dark:bg-slate-950 dark:text-slate-200 ${
                error && !newUrl.trim()
                  ? 'border-red-300 dark:border-red-500/40'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
              placeholder="JSON 索引地址"
              value={newUrl}
              onChange={(event) => {
                setNewUrl(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAdd()
              }}
            />
            <button
              className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm text-white transition hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              onClick={() => void handleAdd()}
            >
              添加来源
            </button>
          </div>
          {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
        </div>
      </div>
    </div>
  )
}

interface CategoryGroup {
  key: string
  label: string
  entries: PluginStoreEntry[]
}

function groupEntriesByCategory(entries: PluginStoreEntry[]): CategoryGroup[] {
  const grouped = new Map<string, PluginStoreEntry[]>()

  for (const entry of entries) {
    const typeKey = entry.plugin.type || UNCATEGORIZED_KEY
    const list = grouped.get(typeKey)
    if (list) {
      if (!list.some((e) => e.plugin.id === entry.plugin.id)) list.push(entry)
    } else {
      grouped.set(typeKey, [entry])
    }
  }

  const result: CategoryGroup[] = []
  const uncategorized = grouped.get(UNCATEGORIZED_KEY)
  grouped.delete(UNCATEGORIZED_KEY)

  const sortedKeys = Array.from(grouped.keys()).sort()
  for (const key of sortedKeys) {
    result.push({ key, label: getPluginTypeLabel(key), entries: grouped.get(key)! })
  }

  if (uncategorized?.length) {
    result.push({ key: UNCATEGORIZED_KEY, label: '其他', entries: uncategorized })
  }

  return result
}

export default function PluginStoreView({ onBack, onOpenDetails }: PluginStoreViewProps) {
  const [sources, setSources] = useState<StoreSource[]>([])
  const [sourceModalOpen, setSourceModalOpen] = useState(false)
  const [storeEntries, setStoreEntries] = useState<PluginStoreEntry[]>([])
  const [storeSourceStates, setStoreSourceStates] = useState<PluginStoreSourceSyncResult[]>([])
  const [storeLoading, setStoreLoading] = useState(false)
  const [storeQuery, setStoreQuery] = useState('')
  const [sortKey, setSortKey] = useState<StoreSortKey>('default')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [debouncedQuery, setDebouncedQuery] = useState('')

  const handleQueryChange = useCallback((value: string) => {
    setStoreQuery(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 200)
  }, [])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const { install, isInstalling } = useStorePluginInstall({
    onSuccess: () => void loadStoreEntries()
  })

  const categories = useMemo(() => collectStoreCategories(storeEntries), [storeEntries])

  const filteredStoreEntries = useMemo(() => {
    let entries = storeEntries

    if (selectedCategory) {
      entries = entries.filter(
        (e) =>
          e.plugin.type === selectedCategory ||
          e.plugin.categories?.includes(selectedCategory)
      )
    }

    const query = debouncedQuery.trim().toLowerCase()
    if (query) {
      entries = entries.filter((e) => buildStoreSearchText(e.plugin).includes(query))
    }

    return sortStoreEntries(entries, sortKey)
  }, [storeEntries, debouncedQuery, sortKey, selectedCategory])

  const categoryGroups = useMemo(
    () => groupEntriesByCategory(filteredStoreEntries),
    [filteredStoreEntries]
  )

  const showGrouped = !selectedCategory && !debouncedQuery.trim()

  const stats = useMemo(() => {
    const total = storeEntries.length
    const installed = storeEntries.filter((e) => e.installState.status === 'installed').length
    const updatable = storeEntries.filter((e) => e.installState.status === 'updatable').length
    return { total, installed, updatable }
  }, [storeEntries])

  useEffect(() => {
    void loadStoreSettings()
    void loadStoreEntries()
  }, [])

  const loadStoreSettings = async () => {
    try {
      const result = await window.mulby.settings.get()
      setSources(result.settings.storeSources || [])
    } catch (err) {
      console.error('Failed to load store sources:', err)
    }
  }

  const updateStoreSources = async (nextSources: StoreSource[]) => {
    const result = await window.mulby.settings.update({ storeSources: nextSources })
    setSources(result.settings.storeSources || [])
  }

  const loadStoreEntries = async () => {
    if (!window.mulby?.pluginStore?.fetch) return
    setStoreLoading(true)
    try {
      await clearRemoteImageCache()
      const result = await window.mulby.pluginStore.fetch()
      setStoreEntries(result.entries)
      setStoreSourceStates(result.sources)
      await loadStoreSettings()
    } catch (err) {
      console.error('Failed to fetch store entries:', err)
      window.mulby.notification.show('加载插件商店失败', 'error')
    } finally {
      setStoreLoading(false)
    }
  }

  const handleAddSource = async (name: string, url: string) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `source-${Date.now()}`
    const nextSource: StoreSource = {
      id,
      name,
      url,
      enabled: true,
      priority: sources.length + 1
    }
    await updateStoreSources([...sources, nextSource])
    await loadStoreEntries()
  }

  const handleToggleSource = async (id: string, enabled: boolean) => {
    const nextSources = sources.map((source) =>
      source.id === id ? { ...source, enabled } : source
    )
    await updateStoreSources(nextSources)
    await loadStoreEntries()
  }

  const handleRemoveSource = async (id: string) => {
    const nextSources = sources.filter((source) => source.id !== id)
    await updateStoreSources(nextSources)
    await loadStoreEntries()
  }

  return (
    <StorePageLayout
      headerTitle="插件商店"
      onBack={onBack}
      headerActions={
        <>
          <button className={STORE_BUTTON_GHOST} onClick={() => setSourceModalOpen(true)}>
            管理仓库源
          </button>
          <button
            className={STORE_BUTTON_PRIMARY}
            onClick={() => void loadStoreEntries()}
            disabled={storeLoading}
          >
            {storeLoading ? '加载中...' : '加载仓库'}
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-6xl px-6 pb-8 pt-5">
        {/* Search / Filter / Sort toolbar */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <svg
                className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-8 text-sm text-slate-700 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                placeholder="搜索插件名称、描述、作者..."
                value={storeQuery}
                onChange={(event) => handleQueryChange(event.target.value)}
              />
              {storeQuery && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
                  onClick={() => {
                    setStoreQuery('')
                    setDebouncedQuery('')
                  }}
                  aria-label="清除搜索"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                  </svg>
                </button>
              )}
            </div>
            <select
              className="h-[42px] rounded-2xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as StoreSortKey)}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Category tabs + stats */}
          {(categories.length > 0 || stats.total > 0) && (
            <div className="flex items-center justify-between gap-4">
              {categories.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                  <button
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      selectedCategory === null
                        ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                    onClick={() => setSelectedCategory(null)}
                  >
                    全部
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        selectedCategory === cat
                          ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                      onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                    >
                      {getPluginTypeLabel(cat)}
                    </button>
                  ))}
                </div>
              )}
              {stats.total > 0 && (
                <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {filteredStoreEntries.length !== stats.total
                      ? `${filteredStoreEntries.length} / ${stats.total}`
                      : `${stats.total} 个插件`}
                  </span>
                  {stats.installed > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                      已装 {stats.installed}
                    </span>
                  )}
                  {stats.updatable > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                      更新 {stats.updatable}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Plugin list */}
        <div className="mt-5">
          {filteredStoreEntries.length === 0 ? (
            <StoreEmptyState
              loading={storeLoading}
              hasQuery={debouncedQuery.trim().length > 0 || selectedCategory !== null}
              hasSources={sources.length > 0}
              onClearQuery={() => {
                setStoreQuery('')
                setDebouncedQuery('')
                setSelectedCategory(null)
              }}
              onOpenSourceModal={() => setSourceModalOpen(true)}
              onRefresh={() => void loadStoreEntries()}
            />
          ) : showGrouped && categoryGroups.length > 1 ? (
            <div className="space-y-8">
              {categoryGroups.map((group) => (
                <section key={group.key}>
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {group.label}
                    </h3>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {group.entries.length}
                    </span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {group.entries.map((entry) => (
                      <StorePluginCard
                        key={`${entry.plugin.id}:${entry.plugin.version}`}
                        entry={entry}
                        installing={isInstalling(entry)}
                        onOpenDetails={onOpenDetails}
                        onInstall={(e) => void install(e)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredStoreEntries.map((entry) => (
                <StorePluginCard
                  key={`${entry.plugin.id}:${entry.plugin.version}`}
                  entry={entry}
                  installing={isInstalling(entry)}
                  onOpenDetails={onOpenDetails}
                  onInstall={(e) => void install(e)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <SourceManagementModal
        open={sourceModalOpen}
        sources={sources}
        storeSourceStates={storeSourceStates}
        onClose={() => setSourceModalOpen(false)}
        onAdd={handleAddSource}
        onToggle={(id, enabled) => void handleToggleSource(id, enabled)}
        onRemove={(id) => void handleRemoveSource(id)}
      />
    </StorePageLayout>
  )
}
