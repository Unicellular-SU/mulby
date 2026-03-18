import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluginInfo } from '../../shared/types/electron'
import type { BackgroundPluginInfo } from '../../shared/types/plugin'
import type { StoreSource } from '../../shared/types/settings'
import type { InstalledPluginUpdateInfo, PluginStoreEntry, PluginStoreSourceSyncResult } from '../../shared/types/plugin-store'

interface PluginManagerViewProps {
  onBack: () => void
  onOpenStore?: () => void
  initialSection?: 'installed' | 'store'
}

const FILTERS = ['all', 'enabled', 'disabled'] as const

type FeatureCmd = PluginInfo['features'][number]['cmds'][number] | string

interface CommandTag {
  kind: string
  label: string
  detail?: string
}

function formatCommand(cmd: FeatureCmd): CommandTag {
  if (typeof cmd === 'string') {
    return { kind: '关键词', label: cmd }
  }
  switch (cmd.type) {
    case 'keyword':
      return { kind: '关键词', label: cmd.value || '未命名' }
    case 'regex':
      return { kind: '正则', label: cmd.match || '未指定', detail: cmd.explain }
    case 'files':
      return { kind: '文件', label: cmd.exts && cmd.exts.length > 0 ? cmd.exts.map(ext => `.${ext}`).join(', ') : '任意格式' }
    case 'img':
      return { kind: '图片', label: cmd.exts && cmd.exts.length > 0 ? cmd.exts.map(ext => `.${ext}`).join(', ') : '任意格式' }
    case 'over':
      return { kind: '覆盖', label: '无需输入' }
    case 'window':
      return { kind: '窗口', label: cmd.app || cmd.title || cmd.bundleId || '当前应用' }
    default:
      return { kind: cmd.type || '命令', label: cmd.value || cmd.match || '未命名' }
  }
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

function getStoreIntegrityMeta(entry: PluginStoreEntry): { label: string; className: string } {
  if (entry.plugin.sha256) {
    return {
      label: 'SHA256',
      className: 'border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
    }
  }
  return {
    label: 'No checksum',
    className: 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'
  }
}

function buildInstallMessage(
  pluginName: string,
  action: 'installed' | 'updated' | 'already-installed' | 'downgrade-blocked' | undefined,
  integrityStatus?: 'verified' | 'missing'
): string {
  if (action === 'already-installed') {
    return `插件 ${pluginName} 已是当前版本`
  }
  const actionText = action === 'updated' ? '更新成功' : '安装成功'
  if (integrityStatus === 'verified') {
    return `插件 ${pluginName} ${actionText}，SHA256 已校验`
  }
  return `插件 ${pluginName} ${actionText}，未提供 SHA256 校验`
}

function InfoItem({ label, value, mono = false }: { label: string; value?: string | number | ReactNode; mono?: boolean }) {
  const displayValue = value === undefined || value === null || value === '' ? '—' : value
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</p>
      {typeof value === 'string' || typeof value === 'number' ? (
        <p className={`${mono ? 'font-mono text-sm' : 'text-sm'} text-slate-900 dark:text-slate-100 break-words`}>
          {displayValue}
        </p>
      ) : (
        <div className={`${mono ? 'font-mono text-sm' : 'text-sm'} text-slate-900 dark:text-slate-100`}>
          {displayValue}
        </div>
      )}
    </div>
  )
}

function PluginIcon({ icon, name, size = 'md' }: { icon?: PluginInfo['icon']; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-16 w-16' : 'h-10 w-10'
  const iconSizeClasses = size === 'sm' ? '[&>svg]:h-5 [&>svg]:w-5' : size === 'lg' ? '[&>svg]:h-10 [&>svg]:w-10' : '[&>svg]:h-6 [&>svg]:w-6'
  const imgSizeClasses = size === 'sm' ? 'h-6 w-6' : size === 'lg' ? 'h-12 w-12' : 'h-7 w-7'
  const textSizeClasses = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-base'

  if (!icon) {
    return (
      <div className={`flex ${sizeClasses} items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200`}>
        <span className={`${textSizeClasses} font-semibold`}>{name.slice(0, 1).toUpperCase()}</span>
      </div>
    )
  }

  if (icon.type === 'svg') {
    return (
      <div
        className={`flex ${sizeClasses} items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100 ${iconSizeClasses}`}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon.value }}
      />
    )
  }

  return (
    <div className={`flex ${sizeClasses} items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800`}>
      <img src={icon.value} alt="" className={`${imgSizeClasses} rounded-lg object-cover`} />
    </div>
  )
}

function PluginDetailsPanel({ pluginName, onClose, onUninstall }: { pluginName: string; onClose: () => void; onUninstall: (plugin: PluginInfo) => void }) {
  const [readme, setReadme] = useState<string | null>(null)
  const [plugin, setPlugin] = useState<PluginInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [pluginName])

  const loadData = async () => {
    setLoading(true)
    try {
      const plugins = await window.mulby.plugin.getAll()
      const current = plugins.find(p => p.name === pluginName)
      setPlugin(current || null)

      const content = await window.mulby.plugin.getReadme(pluginName)
      setReadme(content)
    } catch (err) {
      console.error('Failed to load plugin details:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleUninstall = async () => {
    if (!plugin) return
    onUninstall(plugin)
    onClose()
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">加载中...</div>
      </div>
    )
  }

  if (!plugin) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-500">插件未找到</p>
        </div>
      </div>
    )
  }

  const commandCount = plugin.features.reduce((sum, feature) => sum + (feature.cmds?.length || 0), 0)
  const hasReadme = Boolean(readme && readme.trim().length > 0)

  return (
    <div className="flex h-full flex-col bg-white/50 dark:bg-slate-900/30">
      {/* 头部 */}
      <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
          title="关闭"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{plugin.displayName}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {plugin.enabled ? '已启用' : '未启用'}
          </span>
          {plugin.builtin && (
            <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              内置
            </span>
          )}
          <button
            onClick={handleUninstall}
            disabled={plugin.builtin}
            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-full border border-transparent transition-colors"
          >
            卸载
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pb-8 pt-6">
          {/* 基本信息卡片 */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900">
            <div className="flex items-start gap-4">
              <PluginIcon icon={plugin.icon} name={plugin.displayName} size="lg" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{plugin.displayName}</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    v{plugin.version || '0.0.0'}
                  </span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {plugin.description || '暂无简介'}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                    {plugin.features.length} 个功能
                  </span>
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                    {commandCount} 条命令
                  </span>
                  {plugin.homepage && (
                    <a
                      href={plugin.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-white"
                    >
                      官方主页
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <InfoItem label="插件名称" value={plugin.name} mono />
              <InfoItem label="唯一标识" value={plugin.id} mono />
              <InfoItem label="作者" value={plugin.author || '未知'} />
              <InfoItem
                label="主页"
                value={plugin.homepage ? (
                  <a
                    className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                    href={plugin.homepage}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {plugin.homepage}
                  </a>
                ) : '—'}
              />
            </div>
          </div>

          {/* 功能与命令 */}
          <div className="mt-6">
            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">功能与命令</h4>
            <div className="space-y-3">
              {plugin.features.map((feature) => (
                <div key={feature.code} className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        {feature.icon && (
                          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
                            {feature.icon.type === 'svg' ? (
                              <div
                                className="h-3 w-3 [&>svg]:h-3 [&>svg]:w-3"
                                dangerouslySetInnerHTML={{ __html: feature.icon.value }}
                              />
                            ) : (
                              <img src={feature.icon.value} alt="" className="h-3 w-3 object-contain" />
                            )}
                          </div>
                        )}
                        <h5 className="text-sm font-semibold text-slate-900 dark:text-white">{feature.explain}</h5>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                          {feature.code}
                        </span>
                      </div>
                    </div>
                    {feature.mode && (
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        {feature.mode}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {feature.cmds.length > 0 ? (
                      feature.cmds.map((cmd, index) => {
                        const tag = formatCommand(cmd as FeatureCmd)
                        return (
                          <div
                            key={`${feature.code}-${index}`}
                            className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-2 py-1.5 text-xs text-slate-700 dark:border-slate-800/80 dark:bg-slate-950/60 dark:text-slate-200"
                            title={tag.detail ? `${tag.kind}：${tag.detail}` : tag.kind}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500">
                                {tag.kind}
                              </span>
                              <span className="font-medium text-slate-800 dark:text-slate-100">{tag.label}</span>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <span className="rounded-full border border-dashed border-slate-200 px-2 py-1 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        暂无命令
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* README */}
          {hasReadme && (
            <div className="mt-6">
              <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">README 文档</h4>
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900">
                <article className="prose prose-sm prose-slate max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {readme || ''}
                  </ReactMarkdown>
                </article>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PluginManagerView({ onBack, onOpenStore, initialSection = 'installed' }: PluginManagerViewProps) {
  const [section, setSection] = useState<'installed' | 'store'>(initialSection)
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
    void refreshPlugins()
    void refreshRunningPlugins()
    void refreshUpdates()
    void loadStoreSettings()
  }, [])

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  useEffect(() => {
    if (section !== 'store') return
    void loadStoreEntries()
  }, [section])

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

  const refreshPlugins = async () => {
    setPluginLoading(true)
    try {
      // 先重新从磁盘扫描加载插件，再获取最新列表
      await window.mulby.developer?.reloadPlugins?.()
      const list = await window.mulby.plugin.getAll()
      setPlugins(list)
    } finally {
      setPluginLoading(false)
    }
  }

  const refreshRunningPlugins = async () => {
    try {
      // listBackground 返回所有运行中的插件，包括后台插件和独立窗口插件
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
      window.mulby.notification.show('加载仓库失败', 'error')
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
    const next = sources.map((source) => source.id === id ? { ...source, enabled } : source)
    await updateStoreSources(next)
    await loadStoreEntries()
  }

  const handleRemoveSource = async (id: string) => {
    const next = sources.filter((source) => source.id !== id)
    await updateStoreSources(next)
    await loadStoreEntries()
  }

  const installStorePlugin = async (entry: PluginStoreEntry) => {
    const key = `${entry.plugin.id}:${entry.plugin.version}`
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
        window.mulby.notification.show(`插件 ${entry.plugin.name} 更新成功`, 'success')
      } else if (result.action === 'already-installed') {
        window.mulby.notification.show(`插件 ${entry.plugin.name} 已是当前版本`)
      } else {
        window.mulby.notification.show(`插件 ${entry.plugin.name} 安装成功`, 'success')
      }
      if (result.integrityStatus === 'verified' && result.action !== 'already-installed') {
        window.mulby.notification.show(`插件 ${entry.plugin.name} 的 SHA256 已通过校验`)
      } else if (result.integrityStatus === 'missing' && result.action !== 'already-installed') {
        window.mulby.notification.show(`插件 ${entry.plugin.name} 未提供 SHA256 校验信息`)
      }
      void buildInstallMessage(entry.plugin.name, result.action, result.integrityStatus)
      await Promise.all([refreshPlugins(), refreshUpdates(), loadStoreEntries()])
    } catch (err) {
      const message = err instanceof Error ? err.message : '安装失败'
      window.mulby.notification.show(message, 'error')
    } finally {
      setStoreInstallingKey(null)
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
      if (result.integrityStatus === 'verified') {
        window.mulby.notification.show(`插件 ${plugin.displayName} 的 SHA256 已通过校验`)
      } else if (result.integrityStatus === 'missing') {
        window.mulby.notification.show(`插件 ${plugin.displayName} 未提供 SHA256 校验信息`)
      }
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
        window.mulby.notification.show(`批量更新完成，${failed.length} 个插件失败`, 'error')
      } else {
        window.mulby.notification.show(`批量更新完成，共 ${result.results.length} 个插件`, 'success')
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
    const confirmed = confirm(`确定要卸载插件 ${plugin.displayName} 吗？`)
    if (!confirmed) return
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

  const filteredPlugins = useMemo(() => {
    const query = pluginQuery.trim().toLowerCase()
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
  }, [plugins, pluginQuery, pluginFilter])

  const filteredStoreEntries = useMemo(() => {
    const query = storeQuery.trim().toLowerCase()
    if (!query) return storeEntries
    return storeEntries.filter((entry) => (
      entry.plugin.name.toLowerCase().includes(query) ||
      entry.plugin.id.toLowerCase().includes(query) ||
      entry.plugin.description.toLowerCase().includes(query)
    ))
  }, [storeEntries, storeQuery])

  const updatableCount = useMemo(
    () => updates.filter((item) => item.status === 'updatable').length,
    [updates]
  )

  const isPluginRunning = (pluginName: string) => {
    return runningPlugins.some(rp => rp.pluginName === pluginName)
  }

  const getUpdateInfo = (pluginId: string) => {
    return updates.find((item) => item.pluginId === pluginId)
  }

  const getPluginRunMode = (pluginName: string): 'background' | 'active' | null => {
    const running = runningPlugins.find(rp => rp.pluginName === pluginName)
    return running?.runMode || null
  }

  const getPluginId = (pluginName: string): string | null => {
    const running = runningPlugins.find(rp => rp.pluginName === pluginName)
    return running?.pluginId || null
  }

  const handleStopPlugin = async (e: React.MouseEvent, pluginName: string) => {
    e.stopPropagation() // 阻止事件冒泡，避免触发选择插件
    const pluginId = getPluginId(pluginName)
    if (!pluginId) return

    const runMode = getPluginRunMode(pluginName)
    const modeText = runMode === 'background' ? '后台插件' : '插件'

    if (!confirm(`确定要停止此${modeText}吗？`)) return

    try {
      if (runMode === 'background') {
        await window.mulby.plugin.stopBackground(pluginId)
      } else {
        await window.mulby.plugin.stopPlugin(pluginId)
      }
      window.mulby.notification.show(`${modeText}已停止`, 'success')
      await refreshRunningPlugins()
    } catch {
      window.mulby.notification.show('停止失败', 'error')
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
            <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Plugins</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">插件管理</div>
          </div>
          <div className="flex items-center gap-2">
            {section === 'installed' ? (
              <>
                {onOpenStore && (
                  <button
                    className={topGhostButtonClass}
                    onClick={onOpenStore}
                  >
                    前往插件商店
                  </button>
                )}
                <button
                  className={topGhostButtonClass}
                  onClick={() => void refreshUpdates()}
                  disabled={updateLoading}
                >
                  {updateLoading ? '检查中...' : '检查更新'}
                </button>
                <button
                  className={topPrimaryButtonClass}
                  onClick={() => void handleUpdateAll()}
                  disabled={updatingAll || updatableCount === 0}
                >
                  {updatingAll ? '更新中...' : `全部更新${updatableCount > 0 ? ` (${updatableCount})` : ''}`}
                </button>
              </>
            ) : (
              <>
                <button
                  className={topGhostButtonClass}
                  onClick={() => setSourceModalOpen(true)}
                >
                  管理仓库源
                </button>
                <button
                  className={topPrimaryButtonClass}
                  onClick={() => void loadStoreEntries()}
                  disabled={storeLoading}
                >
                  {storeLoading ? '加载中...' : '加载仓库'}
                </button>
              </>
            )}
            <button
              className={topGhostButtonClass}
              onClick={() => {
                void refreshPlugins()
                void refreshUpdates()
                if (section === 'store') {
                  void loadStoreEntries()
                }
              }}
              disabled={pluginLoading}
            >
              {pluginLoading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        {section === 'installed' ? (
        <div className="flex-1 min-h-0 flex no-drag">
          {/* 左侧插件列表 */}
          <div className="w-80 border-r border-slate-200/70 bg-white dark:border-slate-800/80 dark:bg-slate-900 flex flex-col">
            {/* 搜索和筛选 */}
            <div className="p-4 space-y-3 border-b border-slate-200/70 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  已安装 {plugins.length} 个插件
                </div>
                <button
                  onClick={refreshRunningPlugins}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  title="刷新运行状态"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                placeholder="搜索插件..."
                value={pluginQuery}
                onChange={(e) => setPluginQuery(e.target.value)}
              />
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

            {/* 插件列表 */}
            <div className="flex-1 overflow-y-auto">
              {filteredPlugins.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  没有匹配的插件
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {filteredPlugins.map((plugin) => {
                    const isRunning = isPluginRunning(plugin.name)
                    const runMode = getPluginRunMode(plugin.name)
                    const isSelected = selectedPlugin === plugin.name
                    const updateInfo = getUpdateInfo(plugin.id)
                    const canUpdate = updateInfo?.status === 'updatable'
                    return (
                      <button
                        key={plugin.id}
                        className={`w-full text-left p-3 rounded-xl transition ${
                          isSelected
                            ? 'bg-slate-100 dark:bg-slate-800'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-900/50'
                        }`}
                        onClick={() => setSelectedPlugin(plugin.name)}
                      >
                        <div className="flex items-center gap-2.5">
                          <PluginIcon icon={plugin.icon} name={plugin.displayName} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                {plugin.displayName}
                              </div>
                              {isRunning && (
                                <button
                                  onClick={(e) => handleStopPlugin(e, plugin.name)}
                                  className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)] hover:bg-red-500 hover:shadow-[0_0_6px_rgba(239,68,68,0.6)] transition-all cursor-pointer"
                                  title={`点击停止${runMode === 'background' ? '后台' : ''}运行`}
                                />
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
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
                                  void handleUpdatePlugin(plugin)
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
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                runMode === 'background'
                                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              }`}>
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
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 右侧详情面板 */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {selectedPlugin ? (
              <PluginDetailsPanel
                pluginName={selectedPlugin}
                onClose={() => setSelectedPlugin(null)}
                onUninstall={handleUninstallPlugin}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <svg className="mx-auto h-16 w-16 text-slate-300 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                    选择一个插件查看详情
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto no-drag">
            <div className="mx-auto max-w-6xl space-y-5 px-6 pb-8 pt-6">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">在线插件</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      已配置 {sources.length} 个仓库源
                    </div>
                  </div>
                  <input
                    className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                    placeholder="搜索插件..."
                    value={storeQuery}
                    onChange={(e) => setStoreQuery(e.target.value)}
                  />
                </div>
                {filteredStoreEntries.length === 0 ? (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {storeLoading ? '正在加载仓库索引...' : '暂无可安装插件，请先添加并加载来源。'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredStoreEntries.map((entry) => {
                      const key = `${entry.plugin.id}:${entry.plugin.version}`
                      const status = entry.installState.status
                      const transportMeta = getStoreTransportMeta(entry.plugin.downloadUrl)
                      const integrityMeta = getStoreIntegrityMeta(entry)
                      const buttonLabel = status === 'updatable' ? '更新' : status === 'installed' ? '已安装' : '安装'
                      const disabled = status === 'installed' || storeInstallingKey === key
                      return (
                        <div key={key} className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-900 dark:text-white">{entry.plugin.name}</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">v{entry.plugin.version}</span>
                                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                  {entry.sourceName}
                                </span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${transportMeta.className}`}>
                                  {transportMeta.label}
                                </span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${integrityMeta.className}`}>
                                  {integrityMeta.label}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{entry.plugin.description}</div>
                              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                ID: {entry.plugin.id}
                                {entry.installState.installedVersion && <span className="ml-2">本地 v{entry.installState.installedVersion}</span>}
                                {entry.plugin.author && <span className="ml-2">作者: {entry.plugin.author}</span>}
                              </div>
                            </div>
                            <button
                              className={status === 'updatable'
                                ? 'inline-flex h-7 min-w-[68px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-slate-900 bg-slate-900 px-3 text-xs text-white transition hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
                                : 'inline-flex h-7 min-w-[68px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
                              }
                              disabled={disabled || !transportMeta.allowInstall}
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
          </div>
        )}

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
                  <div className="text-xs text-slate-500 dark:text-slate-400">统一维护插件索引 URL，不占用在线插件展示区</div>
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
                    onChange={(e) => setNewSource((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <input
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                    placeholder="JSON 索引地址"
                    value={newSource.url}
                    onChange={(e) => setNewSource((prev) => ({ ...prev, url: e.target.value }))}
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
