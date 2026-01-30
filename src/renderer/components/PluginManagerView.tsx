import { useEffect, useMemo, useState } from 'react'
import type { PluginInfo } from '../../shared/types/electron'

interface PluginManagerViewProps {
  onBack: () => void
  onOpenPluginDetails: (pluginName: string) => void
}

const FILTERS = ['all', 'enabled', 'disabled'] as const

function PluginIcon({ icon, name }: { icon?: PluginInfo['icon']; name: string }) {
  if (!icon) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
        <span className="text-lg font-semibold">{name.slice(0, 1).toUpperCase()}</span>
      </div>
    )
  }

  if (icon.type === 'svg') {
    return (
      <div
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100 [&>svg]:h-7 [&>svg]:w-7"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon.value }}
      />
    )
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
      <img src={icon.value} alt="" className="h-9 w-9 rounded-xl object-cover" />
    </div>
  )
}

export default function PluginManagerView({ onBack, onOpenPluginDetails }: PluginManagerViewProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginFilter, setPluginFilter] = useState<(typeof FILTERS)[number]>('all')
  const [pluginLoading, setPluginLoading] = useState(false)

  const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white/80 p-6 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/70'
  const cardClassTight = 'rounded-[24px] border border-slate-200/80 bg-white/80 p-5 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/70'
  const pillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white'
  const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'

  useEffect(() => {
    void refreshPlugins()
  }, [])

  const refreshPlugins = async () => {
    setPluginLoading(true)
    try {
      const list = await window.intools.plugin.getAll()
      setPlugins(list)
    } finally {
      setPluginLoading(false)
    }
  }

  const handleTogglePlugin = async (plugin: PluginInfo) => {
    if (plugin.builtin) {
      window.intools.notification.show('内置插件不可禁用', 'error')
      return
    }
    const result = plugin.enabled
      ? await window.intools.plugin.disable(plugin.name)
      : await window.intools.plugin.enable(plugin.name)
    if (result.success) {
      setPlugins((prev) =>
        prev.map((item) =>
          item.name === plugin.name ? { ...item, enabled: !plugin.enabled } : item
        )
      )
    } else {
      window.intools.notification.show(result.error || '操作失败', 'error')
    }
  }

  const handleUninstallPlugin = async (plugin: PluginInfo) => {
    if (plugin.builtin) {
      window.intools.notification.show('内置插件不可卸载', 'error')
      return
    }
    const confirmed = confirm(`确定要卸载插件 ${plugin.displayName} 吗？`)
    if (!confirmed) return
    const result = await window.intools.plugin.uninstall(plugin.name)
    if (result.success) {
      setPlugins((prev) => prev.filter((item) => item.name !== plugin.name))
    } else {
      window.intools.notification.show(result.error || '卸载失败', 'error')
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

  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-500/20" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-400/10" />
        <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white/70 px-6 py-4 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/60">
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
          <button className={actionButtonClass} onClick={refreshPlugins} disabled={pluginLoading}>
            {pluginLoading ? '刷新中...' : '刷新'}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto no-drag">
          <div className="mx-auto max-w-6xl px-6 pb-16 pt-8">
            <div className={`${cardClass} space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">插件概览</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    共 {plugins.length} 个插件 · 已启用 {plugins.filter(p => p.enabled).length} 个
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map((key) => (
                    <button
                      key={key}
                      className={pluginFilter === key ? primaryPillClass : pillClass}
                      onClick={() => setPluginFilter(key)}
                    >
                      {key === 'all' ? '全部' : key === 'enabled' ? '已启用' : '已禁用'}
                    </button>
                  ))}
                </div>
              </div>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                placeholder="搜索插件名称或描述..."
                value={pluginQuery}
                onChange={(e) => setPluginQuery(e.target.value)}
              />
              <div className="text-xs text-slate-500 dark:text-slate-400">
                当前 {filteredPlugins.length} 个插件
              </div>
            </div>

            {filteredPlugins.length === 0 ? (
              <div className={`${cardClass} mt-6 text-sm text-slate-500 dark:text-slate-400`}>
                没有匹配的插件。
              </div>
            ) : (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {filteredPlugins.map((plugin) => (
                  <div key={plugin.id} className={`${cardClassTight} flex flex-col gap-4`}>
                    <div className="flex items-start gap-3">
                      <PluginIcon icon={plugin.icon} name={plugin.displayName} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            {plugin.displayName}
                          </div>
                          {plugin.builtin && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              内置
                            </span>
                          )}
                          {!plugin.enabled && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              已停用
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                          {plugin.description}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
                          <span>
                            {plugin.name}
                            {plugin.version ? ` · v${plugin.version}` : ''}
                          </span>
                          {plugin.author && <span>作者：{plugin.author}</span>}
                          {plugin.homepage && (
                            <button
                              className="text-xs text-slate-700 hover:underline dark:text-slate-200"
                              onClick={() => window.intools.shell.openExternal(plugin.homepage!)}
                            >
                              打开主页
                            </button>
                          )}
                        </div>
                      </div>
                      <button
                        className={plugin.enabled ? primaryPillClass : pillClass}
                        onClick={() => handleTogglePlugin(plugin)}
                        disabled={plugin.builtin}
                      >
                        {plugin.enabled ? '已启用' : '已禁用'}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className={actionButtonClass}
                        onClick={() => onOpenPluginDetails(plugin.name)}
                      >
                        详情
                      </button>
                      <button
                        className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs text-red-600 transition hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:bg-slate-950 dark:text-red-400"
                        onClick={() => handleUninstallPlugin(plugin)}
                        disabled={plugin.builtin}
                      >
                        卸载
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
