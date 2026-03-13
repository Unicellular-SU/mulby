import { useEffect, useMemo, useState } from 'react'
import type { StoreSource } from '../../shared/types/settings'
import type {
  PluginStoreEntry,
  PluginStorePlugin,
  PluginStoreSourceSyncResult
} from '../../shared/types/plugin-store'
import useCachedRemoteImage from '../hooks/useCachedRemoteImage'
import StorePageTitleCard from './StorePageTitleCard'

interface PluginStoreViewProps {
  onBack: () => void
  onOpenDetails: (entry: PluginStoreEntry) => void
}

function formatStoreSyncTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '未同步'
  return new Date(timestamp).toLocaleString()
}

function getStoreTransportMeta(url: string): { label: string; allowInstall: boolean; className: string } {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') {
      return {
        label: 'HTTPS',
        allowInstall: true,
        className: 'border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
      }
    }
    const hostname = parsed.hostname.toLowerCase()
    if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
      return {
        label: 'Local HTTP',
        allowInstall: true,
        className: 'border-blue-200 text-blue-700 dark:border-blue-500/30 dark:text-blue-300'
      }
    }
    return {
      label: 'Need HTTPS',
      allowInstall: false,
      className: 'border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-300'
    }
  } catch {
    return {
      label: 'Invalid URL',
      allowInstall: false,
      className: 'border-red-200 text-red-700 dark:border-red-500/30 dark:text-red-300'
    }
  }
}

function getStorePluginDisplayName(plugin: PluginStorePlugin): string {
  return plugin.displayName || plugin.name
}

function getStorePluginInitial(plugin: PluginStorePlugin): string {
  const text = getStorePluginDisplayName(plugin).trim()
  if (!text) return '?'
  return text.slice(0, 1).toUpperCase()
}

function buildStoreSearchText(plugin: PluginStorePlugin): string {
  return [
    plugin.id,
    plugin.name,
    plugin.displayName,
    plugin.description,
    plugin.details,
    plugin.author,
    plugin.publisher,
    ...(plugin.tags || []),
    ...(plugin.categories || [])
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

function getStoreStatusMeta(status: PluginStoreEntry['installState']['status']): { label: string; className: string } {
  switch (status) {
    case 'updatable':
      return {
        label: '可更新',
        className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
      }
    case 'installed':
      return {
        label: '已安装',
        className: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
      }
    default:
      return {
        label: '未安装',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
      }
  }
}

function StoreCardIcon({ plugin }: { plugin: PluginStorePlugin }) {
  const icon = plugin.icon
  const [iconFailed, setIconFailed] = useState(false)
  const cachedIconSrc = useCachedRemoteImage(icon?.type === 'url' ? icon.value : null)
  if (icon?.type === 'url' && !iconFailed && cachedIconSrc) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
        <img src={cachedIconSrc} alt="" className="h-7 w-7 rounded-lg object-cover" onError={() => setIconFailed(true)} />
      </div>
    )
  }
  if (icon?.type === 'emoji') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-base dark:bg-slate-800">
        {icon.value}
      </div>
    )
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
      {getStorePluginInitial(plugin)}
    </div>
  )
}

export default function PluginStoreView({ onBack, onOpenDetails }: PluginStoreViewProps) {
  const [sources, setSources] = useState<StoreSource[]>([])
  const [newSource, setNewSource] = useState<{ name: string; url: string }>({ name: '', url: '' })
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [sourceModalOpen, setSourceModalOpen] = useState(false)
  const [storeEntries, setStoreEntries] = useState<PluginStoreEntry[]>([])
  const [storeSourceStates, setStoreSourceStates] = useState<PluginStoreSourceSyncResult[]>([])
  const [storeLoading, setStoreLoading] = useState(false)
  const [storeInstallingKey, setStoreInstallingKey] = useState<string | null>(null)
  const [storeQuery, setStoreQuery] = useState('')

  const topGhostButtonClass = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 text-xs leading-none text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 no-drag'
  const topPrimaryButtonClass = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 text-xs leading-none text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 no-drag'

  useEffect(() => {
    void loadStoreSettings()
    void loadStoreEntries()
  }, [])

  useEffect(() => {
    if (!sourceModalOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSourceModalOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [sourceModalOpen])

  const filteredStoreEntries = useMemo(() => {
    const query = storeQuery.trim().toLowerCase()
    if (!query) return storeEntries
    return storeEntries.filter((entry) => buildStoreSearchText(entry.plugin).includes(query))
  }, [storeEntries, storeQuery])

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

  const handleAddSource = async () => {
    const name = newSource.name.trim()
    const url = newSource.url.trim()
    if (!name || !url) {
      setSourceError('名称和地址不能为空')
      return
    }
    try {
      new URL(url)
    } catch {
      setSourceError('地址格式不正确')
      return
    }
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `source-${Date.now()}`
    const nextSource: StoreSource = {
      id,
      name,
      url,
      enabled: true,
      priority: sources.length + 1
    }
    setSourceError(null)
    setNewSource({ name: '', url: '' })
    await updateStoreSources([...sources, nextSource])
    await loadStoreEntries()
  }

  const handleToggleSource = async (id: string, enabled: boolean) => {
    const nextSources = sources.map((source) => source.id === id ? { ...source, enabled } : source)
    await updateStoreSources(nextSources)
    await loadStoreEntries()
  }

  const handleRemoveSource = async (id: string) => {
    const nextSources = sources.filter((source) => source.id !== id)
    await updateStoreSources(nextSources)
    await loadStoreEntries()
  }

  const installStorePlugin = async (entry: PluginStoreEntry) => {
    const key = `${entry.plugin.id}:${entry.plugin.version}`
    const pluginLabel = getStorePluginDisplayName(entry.plugin)
    setStoreInstallingKey(key)
    try {
      const result = await window.mulby.pluginStore.installFromUrl({
        pluginId: entry.plugin.id,
        version: entry.plugin.version,
        downloadUrl: entry.plugin.downloadUrl,
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl,
        publisher: entry.plugin.publisher,
        homepage: entry.plugin.homepage,
        repository: entry.plugin.repository,
        sha256: entry.plugin.sha256
      })
      if (!result.success) {
        window.mulby.notification.show(result.error || '安装失败', 'error')
        return
      }
      if (result.action === 'updated') {
        window.mulby.notification.show(`插件 ${pluginLabel} 更新成功`, 'success')
      } else if (result.action === 'already-installed') {
        window.mulby.notification.show(`插件 ${pluginLabel} 已是当前版本`)
      } else {
        window.mulby.notification.show(`插件 ${pluginLabel} 安装成功`, 'success')
      }
      if (result.integrityStatus === 'verified' && result.action !== 'already-installed') {
        window.mulby.notification.show(`插件 ${pluginLabel} 的 SHA256 已通过校验`)
      } else if (result.integrityStatus === 'missing' && result.action !== 'already-installed') {
        window.mulby.notification.show(`插件 ${pluginLabel} 未提供 SHA256 校验信息`)
      }
      await loadStoreEntries()
    } catch (err) {
      const message = err instanceof Error ? err.message : '安装失败'
      window.mulby.notification.show(message, 'error')
    } finally {
      setStoreInstallingKey(null)
    }
  }

  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-500/20" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-400/10" />
        <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col">
        <>
          <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
            <button
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
              title="返回"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Store</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">插件商店</div>
            </div>
            <div className="flex items-center gap-2">
              <button className={topGhostButtonClass} onClick={() => setSourceModalOpen(true)}>
                管理仓库源
              </button>
              <button
                className={topPrimaryButtonClass}
                onClick={() => void loadStoreEntries()}
                disabled={storeLoading}
              >
                {storeLoading ? '加载中...' : '加载仓库'}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto no-drag">
            <div className="mx-auto max-w-6xl space-y-5 px-6 pb-8 pt-6">
              <StorePageTitleCard
                sectionLabel="Store"
                title="插件商店"
                description="浏览在线插件、查看详情，并安装到 Mulby。"
                aside={(
                  <div className="flex w-full justify-end">
                    <div className="flex w-full gap-2 md:max-w-[380px] md:justify-end">
                      <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300 md:max-w-[288px] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                        placeholder="搜索插件..."
                        value={storeQuery}
                        onChange={(event) => setStoreQuery(event.target.value)}
                      />
                      <button
                        className={topGhostButtonClass}
                        onClick={() => void loadStoreEntries()}
                        disabled={storeLoading}
                      >
                        刷新
                      </button>
                    </div>
                  </div>
                )}
              />

              {filteredStoreEntries.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  {storeLoading ? '正在加载仓库索引...' : '暂无可安装插件，请先添加并加载仓库源。'}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredStoreEntries.map((entry) => {
                    const key = `${entry.plugin.id}:${entry.plugin.version}`
                    const buttonLabel = entry.installState.status === 'updatable'
                      ? '更新'
                      : entry.installState.status === 'installed'
                        ? '已安装'
                        : '安装'
                    const transportMeta = getStoreTransportMeta(entry.plugin.downloadUrl)
                    const disabled = entry.installState.status === 'installed' || storeInstallingKey === key || !transportMeta.allowInstall
                    const statusMeta = getStoreStatusMeta(entry.installState.status)
                    const pluginTitle = getStorePluginDisplayName(entry.plugin)

                    return (
                      <div
                        key={key}
                        className="group flex h-full flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start gap-4 text-left"
                          onClick={() => onOpenDetails(entry)}
                        >
                          <StoreCardIcon plugin={entry.plugin} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 transition group-hover:text-slate-700 dark:text-white dark:group-hover:text-slate-100">
                                {pluginTitle}
                              </span>
                              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                v{entry.plugin.version}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusMeta.className}`}>
                                {statusMeta.label}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                              {entry.plugin.description}
                            </div>
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
                            className={entry.installState.status === 'updatable'
                              ? 'inline-flex h-9 min-w-[88px] items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-4 text-sm text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
                              : 'inline-flex h-9 min-w-[88px] items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
                            }
                            disabled={disabled}
                            onClick={() => void installStorePlugin(entry)}
                          >
                            {storeInstallingKey === key ? '处理中...' : buttonLabel}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>

        {sourceModalOpen && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/45 px-4 py-6 no-drag"
            onClick={() => setSourceModalOpen(false)}
          >
            <div
              className="w-full max-w-3xl rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">仓库源管理</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">统一维护插件索引 URL，不占用在线插件列表空间。</div>
                </div>
                <button
                  className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                  onClick={() => setSourceModalOpen(false)}
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
                      return (
                        <div key={source.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/70">
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
                              className={`rounded-full px-3 py-1 text-xs transition ${source.enabled
                                ? 'border border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                                : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                                }`}
                              onClick={() => void handleToggleSource(source.id, !source.enabled)}
                            >
                              {source.enabled ? '已启用' : '已停用'}
                            </button>
                            <button
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                              onClick={() => void handleRemoveSource(source.id)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)_100px]">
                  <input
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                    placeholder="来源名称"
                    value={newSource.name}
                    onChange={(event) => setNewSource((prev) => ({ ...prev, name: event.target.value }))}
                  />
                  <input
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                    placeholder="JSON 索引地址"
                    value={newSource.url}
                    onChange={(event) => setNewSource((prev) => ({ ...prev, url: event.target.value }))}
                  />
                  <button
                    className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm text-white transition hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    onClick={() => void handleAddSource()}
                  >
                    添加来源
                  </button>
                </div>
                {sourceError && <div className="mt-2 text-xs text-red-500">{sourceError}</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
