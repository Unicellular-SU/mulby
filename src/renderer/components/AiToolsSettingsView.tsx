import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiToolWebSearchSettings, CustomSearchApiConfig } from '../../shared/types/settings'
import type { PluginInfo } from '../../shared/types/electron'
import UnifiedSelect from './UnifiedSelect'
import {
  SettingsLikePageHeader,
  SettingsLikePageShell
} from './SettingsLikePageChrome'

// ===================== 常量 =====================

/** 内置 API Provider 选项 */
const BUILTIN_API_PROVIDERS = [
  { id: 'tavily', label: 'Tavily', description: '推荐，免费 1000 次/月', keyPlaceholder: 'tvly-...', docsUrl: 'https://app.tavily.com/home', docsLabel: 'app.tavily.com' },
  { id: 'jina', label: 'Jina AI', description: '高质量页面抓取 + 搜索', keyPlaceholder: 's_...', docsUrl: 'https://jina.ai/api-dashboard/', docsLabel: 'jina.ai' }
] as const

/** 左侧列表工具 ID: web-search 或 plugin:{pluginId} */
type ToolSectionId = string

/** 插件工具信息（从 PluginInfo 提取） */
interface PluginToolInfo {
  pluginId: string
  pluginName: string
  pluginIcon?: PluginInfo['icon']
  enabled: boolean
  tools: { name: string; description: string }[]
}

/** Provider 分组 */
interface ProviderOption {
  id: string
  label: string
  description: string
  group: 'local' | 'api' | 'custom'
}

// ===================== 工具函数 =====================

function isLocalProvider(id: string) {
  return id.startsWith('local-')
}

function isBuiltinApiProvider(id: string) {
  return BUILTIN_API_PROVIDERS.some((p) => p.id === id)
}

// ===================== 样式 =====================

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50'
const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryPillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

// ===================== 小型子组件 =====================

/** 通用 Section 标题 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
      {children}
    </div>
  )
}

/** 行内 Key-Value 对 */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-xs text-slate-800 dark:text-slate-200">{children}</span>
    </div>
  )
}

/** 工具侧栏列表项 */
function ToolSidebarItem({
  active,
  icon,
  label,
  badge,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  badge?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${
        active
          ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-800/60'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{label}</div>
        </div>
        {badge && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {badge}
          </span>
        )}
      </div>
    </button>
  )
}

// ===================== Provider 卡片（右侧详情面板使用） =====================

function ProviderCard({
  option,
  isActive,
  onActivate
}: {
  option: ProviderOption
  isActive: boolean
  onActivate: () => void
}) {
  const groupIcon = option.group === 'local' ? (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="3" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 21h8M12 17v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : option.group === 'api' ? (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  const groupLabel = option.group === 'local' ? '本地' : option.group === 'api' ? 'API' : '自定义'

  return (
    <button
      type="button"
      onClick={onActivate}
      className={`group w-full rounded-2xl border px-4 py-3 text-left transition ${
        isActive
          ? 'border-blue-300 bg-blue-50/60 ring-1 ring-blue-200/60 dark:border-blue-700 dark:bg-blue-900/20 dark:ring-blue-800/40'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
          isActive
            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300'
            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
        }`}>
          {groupIcon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{option.label}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
              option.group === 'local'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : option.group === 'api'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
            }`}>
              {groupLabel}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{option.description}</div>
        </div>
        {isActive && (
          <svg className="h-5 w-5 shrink-0 text-blue-500 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </button>
  )
}

// ===================== 主组件 =====================

interface AiToolsSettingsViewProps {
  onBack: () => void
}

export default function AiToolsSettingsView({ onBack }: AiToolsSettingsViewProps) {
  const [settings, setSettings] = useState<AiToolWebSearchSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTool, setActiveTool] = useState<ToolSectionId>('web-search')

  // 自定义 API 编辑态
  const [showAddCustomApi, setShowAddCustomApi] = useState(false)
  const [editingCustomApi, setEditingCustomApi] = useState<Partial<CustomSearchApiConfig>>({})

  // 插件工具数据
  const [pluginTools, setPluginTools] = useState<PluginToolInfo[]>([])
  // 用户禁用的插件工具 key 集合（格式 "pluginId:toolName"）
  const [disabledPluginToolKeys, setDisabledPluginToolKeys] = useState<Set<string>>(new Set())

  // 加载设置 + 插件列表 + 禁用列表
  useEffect(() => {
    setLoading(true)
    const loadWebSearch = window.mulby?.ai?.tooling?.webSearch?.get?.()
      .then((data) => {
        setSettings(data as unknown as AiToolWebSearchSettings)
      })
      .catch((err) => {
        console.error('加载 Web Search 设置失败:', err)
      })

    const loadPlugins = window.mulby?.plugin?.getAll?.()
      .then((plugins) => {
        const withTools = (plugins || []).filter((p) => p.tools && p.tools.length > 0)
        setPluginTools(withTools.map((p) => ({
          pluginId: p.id,
          pluginName: p.displayName || p.name,
          pluginIcon: p.icon,
          enabled: p.enabled,
          tools: p.tools || []
        })))
      })
      .catch((err) => {
        console.error('加载插件列表失败:', err)
      })

    const loadDisabled = window.mulby?.ai?.tooling?.pluginTools?.getDisabled?.()
      .then((list) => {
        setDisabledPluginToolKeys(new Set(list || []))
      })
      .catch((err) => {
        console.error('加载禁用工具列表失败:', err)
      })

    Promise.all([loadWebSearch, loadPlugins, loadDisabled].filter(Boolean)).finally(() => {
      setLoading(false)
    })
  }, [])

  // 当前选中的插件（从 activeTool 派生）
  const selectedPlugin = useMemo(() => {
    if (!activeTool.startsWith('plugin:')) return null
    const pluginId = activeTool.slice('plugin:'.length)
    return pluginTools.find((p) => p.pluginId === pluginId) || null
  }, [activeTool, pluginTools])

  // 持久化禁用列表
  const persistDisabledKeys = useCallback(async (nextSet: Set<string>) => {
    setDisabledPluginToolKeys(nextSet)
    try {
      const saved = await window.mulby?.ai?.tooling?.pluginTools?.setDisabled?.([...nextSet])
      if (saved) {
        setDisabledPluginToolKeys(new Set(saved))
      }
    } catch (err) {
      console.error('保存禁用工具列表失败:', err)
    }
  }, [])

  // 切换单个插件工具的启用/禁用状态
  const togglePluginTool = useCallback((toolKey: string) => {
    const next = new Set(disabledPluginToolKeys)
    if (next.has(toolKey)) {
      next.delete(toolKey)
    } else {
      next.add(toolKey)
    }
    void persistDisabledKeys(next)
  }, [disabledPluginToolKeys, persistDisabledKeys])

  // 切换某插件下全部工具
  const toggleAllPluginTools = useCallback((plugin: PluginToolInfo) => {
    const allKeys = plugin.tools.map((t) => `${plugin.pluginId}:${t.name}`)
    const allDisabled = allKeys.every((k) => disabledPluginToolKeys.has(k))
    const next = new Set(disabledPluginToolKeys)
    for (const key of allKeys) {
      if (allDisabled) {
        next.delete(key)
      } else {
        next.add(key)
      }
    }
    void persistDisabledKeys(next)
  }, [disabledPluginToolKeys, persistDisabledKeys])

  // 保存设置
  const saveSettings = useCallback(async (patch: Partial<AiToolWebSearchSettings>) => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      const result = await window.mulby?.ai?.tooling?.webSearch?.update?.(patch as unknown as Record<string, unknown>)
      if (result) {
        setSettings(result as unknown as AiToolWebSearchSettings)
      }
    } catch (err) {
      console.error('保存 Web Search 设置失败:', err)
    }
  }, [settings])

  // 构建 Provider 选项列表
  const providerOptions = useMemo<ProviderOption[]>(() => {
    const list: ProviderOption[] = []

    // 本地引擎
    if (settings?.localEngines) {
      for (const engine of settings.localEngines) {
        list.push({
          id: engine.id,
          label: engine.name,
          description: '浏览器引擎爬取，免费使用',
          group: 'local'
        })
      }
    }
    // 确保至少有 local-bing
    if (!list.some((p) => p.id === 'local-bing')) {
      list.unshift({ id: 'local-bing', label: 'Bing', description: '浏览器引擎爬取，免费使用', group: 'local' })
    }

    // 内置 API
    for (const api of BUILTIN_API_PROVIDERS) {
      list.push({ id: api.id, label: api.label, description: api.description, group: 'api' })
    }

    // 自定义 API
    if (settings?.customApis) {
      for (const api of settings.customApis) {
        list.push({ id: `custom-${api.id}`, label: api.name, description: api.apiHost, group: 'custom' })
      }
    }

    return list
  }, [settings])

  const activeProvider = settings?.activeProvider || 'local-bing'
  const activeBuiltinApi = BUILTIN_API_PROVIDERS.find((p) => p.id === activeProvider)
  const activeOption = providerOptions.find((p) => p.id === activeProvider)

  return (
    <SettingsLikePageShell>
      <SettingsLikePageHeader
        eyebrow="AI Settings"
        title="工具设置"
        onBack={onBack}
      />

      <div className="flex min-h-0 flex-1 no-drag">
        {/* ===================== 左侧工具列表 ===================== */}
        <aside className="flex min-h-0 w-[280px] shrink-0 flex-col border-r border-slate-200/70 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI 工具</h3>
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto space-y-1">
            {/* Web Search */}
            <ToolSidebarItem
              active={activeTool === 'web-search'}
              label="Web Search"
              badge={activeOption ? activeOption.label : undefined}
              onClick={() => setActiveTool('web-search')}
              icon={(
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            />

            {/* 插件工具分组 */}
            {pluginTools.length > 0 && (
              <>
                <div className="mt-3 mb-1 text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 px-1">Plugin Tools</div>
                {pluginTools.map((plugin) => {
                  const allKeys = plugin.tools.map((t) => `${plugin.pluginId}:${t.name}`)
                  const disabledCount = allKeys.filter((k) => disabledPluginToolKeys.has(k)).length
                  const enabledCount = plugin.tools.length - disabledCount
                  return (
                    <ToolSidebarItem
                      key={plugin.pluginId}
                      active={activeTool === `plugin:${plugin.pluginId}`}
                      label={plugin.pluginName}
                      badge={`${enabledCount}/${plugin.tools.length}`}
                      onClick={() => setActiveTool(`plugin:${plugin.pluginId}`)}
                      icon={
                        plugin.pluginIcon?.type === 'emoji' ? (
                          <span className="text-sm leading-none">{plugin.pluginIcon.value}</span>
                        ) : plugin.pluginIcon?.type === 'svg' ? (
                          <span dangerouslySetInnerHTML={{ __html: plugin.pluginIcon.value }} className="h-4 w-4 [&>svg]:h-full [&>svg]:w-full" />
                        ) : plugin.pluginIcon && (plugin.pluginIcon.type === 'url' || plugin.pluginIcon.type === 'data-url') ? (
                          <img src={plugin.pluginIcon.value} className="h-4 w-4 rounded" alt="" />
                        ) : (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )
                      }
                    />
                  )
                })}
              </>
            )}
          </div>
        </aside>

        {/* ===================== 右侧详情区 ===================== */}
        <main className="flex-1 min-h-0 overflow-y-auto p-6">
          <div className="mx-auto h-full max-w-4xl">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  加载中...
                </div>
              </div>
            ) : selectedPlugin ? (
              /* ==================== 选中插件的工具详情面板 ==================== */
              <div className="space-y-5">
                {/* 插件头部信息 + 全局开关 */}
                <section className="rounded-[24px] bg-white p-5 dark:bg-slate-900">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-base dark:bg-slate-800">
                      {selectedPlugin.pluginIcon?.type === 'emoji' ? (
                        selectedPlugin.pluginIcon.value
                      ) : selectedPlugin.pluginIcon?.type === 'svg' ? (
                        <span dangerouslySetInnerHTML={{ __html: selectedPlugin.pluginIcon.value }} className="h-5 w-5 [&>svg]:h-full [&>svg]:w-full" />
                      ) : selectedPlugin.pluginIcon && (selectedPlugin.pluginIcon.type === 'url' || selectedPlugin.pluginIcon.type === 'data-url') ? (
                        <img src={selectedPlugin.pluginIcon.value} className="h-6 w-6 rounded" alt="" />
                      ) : (
                        <svg className="h-5 w-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedPlugin.pluginName}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          selectedPlugin.enabled
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                        }`}>
                          {selectedPlugin.enabled ? '插件已启用' : '插件已禁用'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {(() => {
                          const allKeys = selectedPlugin.tools.map((t) => `${selectedPlugin.pluginId}:${t.name}`)
                          const enabledCount = allKeys.filter((k) => !disabledPluginToolKeys.has(k)).length
                          return `${enabledCount} / ${selectedPlugin.tools.length} 个工具已启用`
                        })()}
                      </div>
                    </div>
                    {/* 全部开关 */}
                    {(() => {
                      const allKeys = selectedPlugin.tools.map((t) => `${selectedPlugin.pluginId}:${t.name}`)
                      const allDisabled = allKeys.every((k) => disabledPluginToolKeys.has(k))
                      return (
                        <button
                          className={`${secondaryPillClass} no-drag`}
                          onClick={() => toggleAllPluginTools(selectedPlugin)}
                        >
                          {allDisabled ? '全部启用' : '全部禁用'}
                        </button>
                      )
                    })()}
                  </div>
                </section>

                {/* 工具列表 */}
                <section className="rounded-[24px] bg-white dark:bg-slate-900">
                  <div className="divide-y divide-slate-200/50 dark:divide-slate-800/50">
                    {selectedPlugin.tools.map((tool) => {
                      const toolKey = `${selectedPlugin.pluginId}:${tool.name}`
                      const isToolDisabled = disabledPluginToolKeys.has(toolKey)
                      return (
                        <div key={tool.name} className="flex items-center gap-3 px-5 py-3.5">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${
                            isToolDisabled
                              ? 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                              : 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300'
                          }`}>
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <div className="min-w-0 flex-1">
                            <code className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              isToolDisabled
                                ? 'bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                            }`}>
                              {tool.name}
                            </code>
                            {tool.description && (
                              <div className={`mt-1 text-[11px] leading-relaxed ${
                                isToolDisabled ? 'text-slate-400 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'
                              }`}>
                                {tool.description}
                              </div>
                            )}
                          </div>
                          {/* 开关 */}
                          <button
                            className={`no-drag relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                              isToolDisabled
                                ? 'bg-slate-200 dark:bg-slate-700'
                                : 'bg-emerald-500 dark:bg-emerald-600'
                            }`}
                            onClick={() => togglePluginTool(toolKey)}
                            title={isToolDisabled ? '点击启用此工具' : '点击禁用此工具'}
                          >
                            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                              isToolDisabled ? 'translate-x-[3px]' : 'translate-x-[19px]'
                            }`} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>
              </div>
            ) : !settings ? (
              <div className="flex h-full items-center justify-center">
                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  设置加载失败，请返回重试
                </div>
              </div>
            ) : (
              /* ==================== Web Search 详情面板 ==================== */
              <div className="space-y-6">
                {/* ---- 搜索引擎选择 ---- */}
                <section className="rounded-[24px] bg-white p-5 dark:bg-slate-900">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <SectionLabel>搜索引擎</SectionLabel>
                      <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                        选择用于 AI Web Search 工具的搜索引擎
                      </div>
                    </div>
                    {/* 当前激活状态标记 */}
                    {activeOption && (
                      <div className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {activeOption.label}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    {providerOptions.map((option) => (
                      <ProviderCard
                        key={option.id}
                        option={option}
                        isActive={activeProvider === option.id}
                        onActivate={() => saveSettings({ activeProvider: option.id })}
                      />
                    ))}
                  </div>
                </section>

                {/* ---- 当前 Provider 配置 ---- */}
                <section className="rounded-[24px] bg-white p-5 dark:bg-slate-900">
                  <SectionLabel>当前引擎配置</SectionLabel>

                  {/* 本地引擎提示 */}
                  {isLocalProvider(activeProvider) && (
                    <div className="mt-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-900/20">
                      <div className="flex items-start gap-2.5">
                        <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <div>
                          <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200">无需配置</div>
                          <div className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                            使用内置浏览器爬取搜索引擎结果页，无需 API Key，免费无限制使用
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 内置 API Key 配置 */}
                  {isBuiltinApiProvider(activeProvider) && activeBuiltinApi && (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
                        <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                          {activeBuiltinApi.label} API Key
                        </div>
                        <input
                          className={inputClass}
                          type="password"
                          placeholder={activeBuiltinApi.keyPlaceholder}
                          value={settings.providerKeys?.[activeProvider as 'tavily' | 'jina'] || ''}
                          onChange={(e) => {
                            const key = activeProvider as 'tavily' | 'jina'
                            saveSettings({
                              providerKeys: {
                                ...settings.providerKeys,
                                [key]: e.target.value
                              }
                            })
                          }}
                        />
                        <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                          前往{' '}
                          <a
                            href={activeBuiltinApi.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline dark:text-blue-400"
                          >
                            {activeBuiltinApi.docsLabel}
                          </a>
                          {' '}获取 API Key
                        </div>
                      </div>
                      {activeProvider === 'tavily' && (
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
                          <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                            API Host（可选）
                          </div>
                          <input
                            className={inputClass}
                            placeholder="https://api.tavily.com（默认）"
                            value={settings.tavilyApiHost || ''}
                            onChange={(e) => saveSettings({ tavilyApiHost: e.target.value || undefined })}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 自定义 API 占位/已选 */}
                  {activeProvider.startsWith('custom-') && (
                    <div className="mt-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/40 px-4 py-3 dark:border-indigo-900/60 dark:bg-indigo-900/20">
                      <div className="text-xs text-indigo-700 dark:text-indigo-300">
                        当前使用自定义搜索 API。如需修改参数，请删除后重新添加。
                      </div>
                    </div>
                  )}
                </section>

                {/* ---- API 密钥总览 ---- */}
                <section className="rounded-[24px] bg-white p-5 dark:bg-slate-900">
                  <SectionLabel>API 密钥概览</SectionLabel>
                  <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
                    {BUILTIN_API_PROVIDERS.map((api) => {
                      const hasKey = !!settings.providerKeys?.[api.id]
                      return (
                        <InfoRow key={api.id} label={api.label}>
                          <span className={`flex items-center gap-1 ${hasKey ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-500'}`}>
                            {hasKey ? (
                              <>
                                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                已配置
                              </>
                            ) : '未配置'}
                          </span>
                        </InfoRow>
                      )
                    })}
                  </div>
                </section>

                {/* ---- 搜索参数 ---- */}
                <section className="rounded-[24px] bg-white p-5 dark:bg-slate-900">
                  <SectionLabel>搜索参数</SectionLabel>
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
                      <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">最大结果数</label>
                      <input
                        className={inputClass}
                        type="number"
                        min={1}
                        max={20}
                        value={settings.maxResults}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(20, parseInt(e.target.value) || 5))
                          saveSettings({ maxResults: v })
                        }}
                      />
                      <div className="mt-1.5 text-[10px] text-slate-400">1 – 20</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
                      <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">内容截断长度</label>
                      <input
                        className={inputClass}
                        type="number"
                        min={1000}
                        max={50000}
                        step={1000}
                        value={settings.maxContentLength}
                        onChange={(e) => {
                          const v = Math.max(1000, Math.min(50000, parseInt(e.target.value) || 8000))
                          saveSettings({ maxContentLength: v })
                        }}
                      />
                      <div className="mt-1.5 text-[10px] text-slate-400">1,000 – 50,000 字符</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
                      <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">超时（秒）</label>
                      <input
                        className={inputClass}
                        type="number"
                        min={5}
                        max={120}
                        value={Math.round(settings.timeoutMs / 1000)}
                        onChange={(e) => {
                          const v = Math.max(5, Math.min(120, parseInt(e.target.value) || 30))
                          saveSettings({ timeoutMs: v * 1000 })
                        }}
                      />
                      <div className="mt-1.5 text-[10px] text-slate-400">5 – 120 秒</div>
                    </div>
                  </div>
                </section>

                {/* ---- 自定义 API 管理 ---- */}
                <section className="rounded-[24px] bg-white p-5 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <SectionLabel>自定义搜索 API</SectionLabel>
                    <button
                      className={secondaryPillClass}
                      onClick={() => {
                        setEditingCustomApi({
                          id: `api-${Date.now()}`,
                          name: '',
                          apiHost: '',
                          method: 'POST',
                          resultsPath: 'results',
                          titleField: 'title',
                          urlField: 'url',
                          contentField: 'content'
                        })
                        setShowAddCustomApi(true)
                      }}
                    >
                      + 添加
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(settings.customApis || []).length === 0 && !showAddCustomApi && (
                      <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-6 text-center dark:border-slate-800/80 dark:bg-slate-900/40">
                        <svg className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          暂无自定义 API，点击「添加」接入第三方搜索服务
                        </div>
                      </div>
                    )}
                    {(settings.customApis || []).map((api) => (
                      <div
                        key={api.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-900/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{api.name}</span>
                            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                              {api.method}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{api.apiHost}</div>
                        </div>
                        <button
                          className={actionButtonClass}
                          onClick={() => {
                            const filtered = (settings.customApis || []).filter((a) => a.id !== api.id)
                            const patch: Partial<AiToolWebSearchSettings> = { customApis: filtered }
                            if (activeProvider === `custom-${api.id}`) {
                              patch.activeProvider = 'local-bing'
                            }
                            saveSettings(patch)
                          }}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ===================== 添加自定义 API 弹窗 ===================== */}
      {showAddCustomApi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-drag">
          <div className="w-full max-w-xl rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">添加自定义搜索 API</h3>
              <button className={actionButtonClass} onClick={() => { setShowAddCustomApi(false); setEditingCustomApi({}) }}>
                关闭
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">显示名称 *</label>
                  <input
                    className={inputClass}
                    placeholder="如：SearXNG"
                    value={editingCustomApi.name || ''}
                    onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">API Base URL *</label>
                  <input
                    className={inputClass}
                    placeholder="https://..."
                    value={editingCustomApi.apiHost || ''}
                    onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, apiHost: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">API Key（可选）</label>
                  <input
                    className={inputClass}
                    placeholder="sk-..."
                    type="password"
                    value={editingCustomApi.apiKey || ''}
                    onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, apiKey: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">HTTP 方法</label>
                  <UnifiedSelect
                    value={editingCustomApi.method || 'POST'}
                    onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, method: e.target.value as 'GET' | 'POST' }))}
                  >
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </UnifiedSelect>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">响应结果路径</label>
                  <input
                    className={inputClass}
                    placeholder="如 results"
                    value={editingCustomApi.resultsPath || ''}
                    onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, resultsPath: e.target.value }))}
                  />
                </div>
                {editingCustomApi.method === 'GET' && (
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">查询参数名</label>
                    <input
                      className={inputClass}
                      placeholder="如 q"
                      value={editingCustomApi.queryParam || ''}
                      onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, queryParam: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className={secondaryPillClass}
                onClick={() => { setShowAddCustomApi(false); setEditingCustomApi({}) }}
              >
                取消
              </button>
              <button
                className={primaryPillClass}
                disabled={!editingCustomApi.name?.trim() || !editingCustomApi.apiHost?.trim()}
                onClick={() => {
                  const api = editingCustomApi as CustomSearchApiConfig
                  const existing = settings?.customApis || []
                  saveSettings({ customApis: [...existing, api] })
                  setShowAddCustomApi(false)
                  setEditingCustomApi({})
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsLikePageShell>
  )
}
