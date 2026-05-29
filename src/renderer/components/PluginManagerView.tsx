import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginInfo } from '../../shared/types/electron'
import type { BackgroundPluginInfo } from '../../shared/types/plugin'
import type { InstalledPluginUpdateInfo } from '../../shared/types/plugin-store'
import { STORE_BUTTON_GHOST, STORE_BUTTON_PRIMARY } from '../utils/plugin-store-helpers'
import StorePageLayout from './StorePageLayout'
import PluginDetailsPanel, { PluginIcon } from './PluginDetailsPanel'

interface PluginManagerViewProps {
  onBack: () => void
  onOpenStore?: () => void
}

const FILTERS = ['all', 'enabled', 'disabled'] as const

const PluginListItem = memo(function PluginListItem({
  plugin,
  isSelected,
  isRunning,
  runMode,
  updateInfo,
  updatingPluginId,
  onSelect,
  onUpdate,
  onStop
}: {
  plugin: PluginInfo
  isSelected: boolean
  isRunning: boolean
  runMode: 'background' | 'active' | null
  updateInfo?: InstalledPluginUpdateInfo
  updatingPluginId: string | null
  onSelect: (name: string) => void
  onUpdate: (plugin: PluginInfo) => void
  onStop: (e: React.MouseEvent, name: string) => void
}) {
  const canUpdate = updateInfo?.status === 'updatable'

  return (
    <button
      className={`w-full text-left p-3 rounded-xl transition ${
        isSelected
          ? 'bg-slate-100 dark:bg-slate-800'
          : 'hover:bg-slate-50 dark:hover:bg-slate-900/50'
      }`}
      onClick={() => onSelect(plugin.name)}
    >
      <div className="flex items-center gap-2.5">
        <PluginIcon icon={plugin.icon} name={plugin.displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
              {plugin.displayName}
            </div>
            {isRunning && (
              <button
                onClick={(e) => onStop(e, plugin.name)}
                className="h-1.5 w-1.5 shrink-0 cursor-pointer rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)] transition-all hover:bg-red-500 hover:shadow-[0_0_6px_rgba(239,68,68,0.6)]"
                title={`点击停止${runMode === 'background' ? '后台' : ''}运行`}
              />
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="truncate text-xs text-slate-500 dark:text-slate-400">
              {plugin.name}
            </span>
            {plugin.version && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                v{plugin.version}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {canUpdate && (
            <button
              className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 transition hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
              onClick={(e) => {
                e.stopPropagation()
                onUpdate(plugin)
              }}
              disabled={updatingPluginId === plugin.id}
            >
              {updatingPluginId === plugin.id
                ? '更新中...'
                : `更新 ${updateInfo?.installedVersion ?? ''}→${updateInfo?.remoteVersion ?? ''}`}
            </button>
          )}
          {updateInfo?.status === 'latest' && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              已最新
            </span>
          )}
          {isRunning && runMode && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                runMode === 'background'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              }`}
            >
              {runMode === 'background' ? '后台' : '活跃'}
            </span>
          )}
          {!plugin.enabled && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              停用
            </span>
          )}
          {plugin.builtin && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              内置
            </span>
          )}
          {plugin.isDev && (
            <span
              className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              title={plugin.overriddenInstallPath ? `开发版（已覆盖安装版：${plugin.overriddenInstallPath}）` : '开发目录插件'}
            >
              {plugin.overriddenInstallPath ? '开发版·覆盖' : '开发版'}
            </span>
          )}
        </div>
      </div>
    </button>
  )
})

export default function PluginManagerView({ onBack, onOpenStore }: PluginManagerViewProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [runningPlugins, setRunningPlugins] = useState<BackgroundPluginInfo[]>([])
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginFilter, setPluginFilter] = useState<(typeof FILTERS)[number]>('all')
  const [pluginLoading, setPluginLoading] = useState(false)
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null)
  const [updates, setUpdates] = useState<InstalledPluginUpdateInfo[]>([])
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updatingPluginId, setUpdatingPluginId] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)

  const [debouncedQuery, setDebouncedQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const handleQueryChange = useCallback((value: string) => {
    setPluginQuery(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 150)
  }, [])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  useEffect(() => {
    void refreshPlugins()
    void refreshRunningPlugins()
    void refreshUpdates()
  }, [])

  const refreshPlugins = async () => {
    setPluginLoading(true)
    try {
      await window.mulby.developer?.reloadPlugins?.()
      const list = await window.mulby.plugin.getAll()
      setPlugins(list)
    } finally {
      setPluginLoading(false)
    }
  }

  const refreshRunningPlugins = async () => {
    try {
      const list = await window.mulby.plugin.listBackground()
      setRunningPlugins(list)
    } catch (err) {
      console.error('Failed to get running plugins:', err)
    }
  }

  const refreshUpdates = async () => {
    if (!window.mulby?.pluginStore?.checkUpdatesInstalled) return
    setUpdateLoading(true)
    try {
      const result = await window.mulby.pluginStore.checkUpdatesInstalled()
      setUpdates(result.updates)
    } catch (err) {
      console.error('Failed to check plugin updates:', err)
      window.mulby.notification.show('检查更新失败', 'error')
    } finally {
      setUpdateLoading(false)
    }
  }

  const handleUpdatePlugin = async (plugin: PluginInfo) => {
    const update = updates.find((item) => item.pluginId === plugin.id)
    if (!update || update.status !== 'updatable' || !update.downloadUrl) return
    setUpdatingPluginId(plugin.id)
    try {
      const result = await window.mulby.pluginStore.installFromUrl({
        pluginId: update.pluginId,
        version: update.remoteVersion,
        downloadUrl: update.downloadUrl,
        sourceId: update.sourceId,
        sourceName: update.sourceName,
        sourceUrl: update.sourceUrl,
        publisher: update.publisher,
        homepage: update.homepage,
        repository: update.repository,
        sha256: update.sha256
      })
      if (!result.success) {
        window.mulby.notification.show(result.error || '更新失败', 'error')
        return
      }
      window.mulby.notification.show(`插件 ${plugin.displayName} 已更新`, 'success')
      await Promise.all([refreshPlugins(), refreshUpdates()])
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新失败'
      window.mulby.notification.show(message, 'error')
    } finally {
      setUpdatingPluginId(null)
    }
  }

  const handleUpdateAll = async () => {
    if (!window.mulby?.pluginStore?.updateAll) return
    setUpdatingAll(true)
    try {
      const result = await window.mulby.pluginStore.updateAll()
      const failed = result.results.filter((item) => !item.success)
      if (failed.length > 0) {
        window.mulby.notification.show(
          `批量更新完成，${failed.length} 个插件失败`,
          'error'
        )
      } else {
        window.mulby.notification.show(
          `批量更新完成，共 ${result.results.length} 个插件`,
          'success'
        )
      }
      await Promise.all([refreshPlugins(), refreshUpdates()])
    } catch (err) {
      const message = err instanceof Error ? err.message : '批量更新失败'
      window.mulby.notification.show(message, 'error')
    } finally {
      setUpdatingAll(false)
    }
  }

  const handleUninstallPlugin = async (plugin: PluginInfo) => {
    if (plugin.builtin) {
      window.mulby.notification.show('内置插件不可卸载', 'error')
      return
    }
    const { response } = await window.mulby.dialog.showMessageBox({
      type: 'question',
      title: '卸载插件',
      message: `确定要卸载插件「${plugin.displayName}」吗？`,
      buttons: ['取消', '卸载'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return
    const result = await window.mulby.plugin.uninstall(plugin.name)
    if (result.success) {
      setPlugins((prev) => prev.filter((item) => item.name !== plugin.name))
      setUpdates((prev) => prev.filter((item) => item.pluginId !== plugin.id))
      if (selectedPlugin === plugin.name) {
        setSelectedPlugin(null)
      }
    } else {
      window.mulby.notification.show(result.error || '卸载失败', 'error')
    }
  }

  const handleStopPlugin = async (e: React.MouseEvent, pluginName: string) => {
    e.stopPropagation()
    const running = runningPlugins.find((rp) => rp.pluginName === pluginName)
    if (!running?.pluginId) return

    const modeText = running.runMode === 'background' ? '后台插件' : '插件'
    const { response } = await window.mulby.dialog.showMessageBox({
      type: 'question',
      title: '停止插件',
      message: `确定要停止此${modeText}吗？`,
      buttons: ['取消', '停止'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return

    try {
      if (running.runMode === 'background') {
        await window.mulby.plugin.stopBackground(running.pluginId)
      } else {
        await window.mulby.plugin.stopPlugin(running.pluginId)
      }
      window.mulby.notification.show(`${modeText}已停止`, 'success')
      await refreshRunningPlugins()
    } catch {
      window.mulby.notification.show('停止失败', 'error')
    }
  }

  const filteredPlugins = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase()
    return plugins.filter((plugin) => {
      if (pluginFilter === 'enabled' && !plugin.enabled) return false
      if (pluginFilter === 'disabled' && plugin.enabled) return false
      if (!query) return true
      return (
        plugin.displayName.toLowerCase().includes(query) ||
        plugin.name.toLowerCase().includes(query) ||
        plugin.description.toLowerCase().includes(query)
      )
    })
  }, [plugins, debouncedQuery, pluginFilter])

  const updatableCount = useMemo(
    () => updates.filter((item) => item.status === 'updatable').length,
    [updates]
  )

  const runningMap = useMemo(() => {
    const map = new Map<string, BackgroundPluginInfo>()
    for (const rp of runningPlugins) map.set(rp.pluginName, rp)
    return map
  }, [runningPlugins])

  const updateMap = useMemo(() => {
    const map = new Map<string, InstalledPluginUpdateInfo>()
    for (const u of updates) map.set(u.pluginId, u)
    return map
  }, [updates])

  return (
    <StorePageLayout
      headerTitle="插件管理"
      headerSubtitle="Plugins"
      onBack={onBack}
      headerActions={
        <>
          {onOpenStore && (
            <button className={STORE_BUTTON_GHOST} onClick={onOpenStore}>
              前往插件商店
            </button>
          )}
          <button
            className={STORE_BUTTON_GHOST}
            onClick={() => void refreshUpdates()}
            disabled={updateLoading}
          >
            {updateLoading ? '检查中...' : '检查更新'}
          </button>
          <button
            className={STORE_BUTTON_PRIMARY}
            onClick={() => void handleUpdateAll()}
            disabled={updatingAll || updatableCount === 0}
          >
            {updatingAll
              ? '更新中...'
              : `全部更新${updatableCount > 0 ? ` (${updatableCount})` : ''}`}
          </button>
        </>
      }
    >
      <div className="flex h-full min-h-0">
        {/* Left: plugin list */}
        <div className="flex w-80 flex-col border-r border-slate-200/70 bg-white dark:border-slate-800/80 dark:bg-slate-900">
          <div className="space-y-3 border-b border-slate-200/70 p-4 dark:border-slate-800/80">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                已安装 {plugins.length} 个插件
              </div>
              <button
                onClick={() => void refreshRunningPlugins()}
                className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                aria-label="刷新运行状态"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className="relative">
              <svg
                className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-xs text-slate-700 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                placeholder="搜索插件..."
                value={pluginQuery}
                onChange={(e) => handleQueryChange(e.target.value)}
              />
              {pluginQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
                  onClick={() => {
                    setPluginQuery('')
                    setDebouncedQuery('')
                  }}
                  aria-label="清除搜索"
                >
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/60">
              {FILTERS.map((key) => (
                <button
                  key={key}
                  className={`no-drag flex-1 rounded-full px-2 py-1 text-xs transition ${
                    pluginFilter === key
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white'
                  }`}
                  onClick={() => setPluginFilter(key)}
                >
                  {key === 'all' ? '全部' : key === 'enabled' ? '已启用' : '已禁用'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredPlugins.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                {pluginLoading ? '加载中...' : '没有匹配的插件'}
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {filteredPlugins.map((plugin) => {
                  const running = runningMap.get(plugin.name)
                  return (
                    <PluginListItem
                      key={plugin.id}
                      plugin={plugin}
                      isSelected={selectedPlugin === plugin.name}
                      isRunning={!!running}
                      runMode={running?.runMode || null}
                      updateInfo={updateMap.get(plugin.id)}
                      updatingPluginId={updatingPluginId}
                      onSelect={setSelectedPlugin}
                      onUpdate={(p) => void handleUpdatePlugin(p)}
                      onStop={(e, name) => void handleStopPlugin(e, name)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: details panel */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedPlugin ? (
            <PluginDetailsPanel
              pluginName={selectedPlugin}
              onClose={() => setSelectedPlugin(null)}
              onUninstall={handleUninstallPlugin}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <svg
                  className="mx-auto h-16 w-16 text-slate-300 dark:text-slate-700"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
                <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                  选择一个插件查看详情
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </StorePageLayout>
  )
}
