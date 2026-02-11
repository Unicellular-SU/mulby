import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluginInfo } from '../../shared/types/electron'
import type { BackgroundPluginInfo } from '../../shared/types/plugin'

interface PluginManagerViewProps {
  onBack: () => void
  onOpenPluginDetails: (pluginName: string) => void
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
    default:
      return { kind: cmd.type || '命令', label: cmd.value || cmd.match || '未命名' }
  }
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
    if (plugin && confirm(`确定要卸载插件 ${plugin.displayName || pluginName} 吗？`)) {
      onUninstall(plugin)
      onClose()
    }
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

export default function PluginManagerView({ onBack }: PluginManagerViewProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [runningPlugins, setRunningPlugins] = useState<BackgroundPluginInfo[]>([])
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginFilter, setPluginFilter] = useState<(typeof FILTERS)[number]>('all')
  const [pluginLoading, setPluginLoading] = useState(false)
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null)

  useEffect(() => {
    void refreshPlugins()
    void refreshRunningPlugins()
  }, [])

  const refreshPlugins = async () => {
    setPluginLoading(true)
    try {
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

  const isPluginRunning = (pluginName: string) => {
    return runningPlugins.some(rp => rp.pluginName === pluginName)
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
    } catch (err) {
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
          <button
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 no-drag"
            onClick={refreshPlugins}
            disabled={pluginLoading}
          >
            {pluginLoading ? '刷新中...' : '刷新'}
          </button>
        </div>

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
              <div className="flex gap-1.5">
                {FILTERS.map((key) => (
                  <button
                    key={key}
                    className={`flex-1 rounded-lg px-2 py-1 text-xs transition ${
                      pluginFilter === key
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
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
      </div>
    </div>
  )
}
