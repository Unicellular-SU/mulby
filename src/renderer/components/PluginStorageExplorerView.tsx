import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import type { PluginInfo } from '../../shared/types/electron'
import {
  SettingsLikePageShell,
  SettingsLikePageHeader
} from './SettingsLikePageChrome'

// ====== 类型 ======


interface StorageEntry {
  key: string
  value: unknown
  rawValue: string
  updatedAt: number
}

/** 合并后的插件存储视图模型 */
interface PluginStorageItem {
  /** 存储命名空间 (plugin:xxx) */
  namespace: string
  /** 插件名称 (去掉 plugin: 前缀) */
  pluginName: string
  /** 插件显示名 */
  displayName: string
  /** 插件图标 */
  icon?: PluginInfo['icon']
  /** 键数量 */
  count: number
  /** 最后更新时间 */
  lastUpdated: number
  /** 插件版本 */
  version?: string
  /** 是否已安装 */
  installed: boolean
}

// ====== 脱敏工具 ======

const SENSITIVE_PATTERNS = [
  /token/i, /secret/i, /password/i, /passwd/i,
  /api[_-]?key/i, /auth/i, /credential/i,
  /private[_-]?key/i, /access[_-]?key/i,
  /bearer/i, /jwt/i, /session/i, /cookie/i,
  /^sk-/i, /^pk-/i
]

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(key))
}

function maskSensitiveValue(value: unknown, key: string): { display: string; masked: boolean } {
  if (!isSensitiveKey(key)) {
    return { display: formatValue(value), masked: false }
  }
  // 字符串：展示前几位 + 掩码
  if (typeof value === 'string' && value.length > 0) {
    const visible = Math.min(4, Math.floor(value.length / 4))
    return {
      display: value.slice(0, visible) + '•'.repeat(Math.min(12, value.length - visible)),
      masked: true
    }
  }
  // 对象/数组等结构化值：完全掩码，防止凭据以 JSON 形式泄露
  if (value !== null && value !== undefined && typeof value === 'object') {
    const hint = Array.isArray(value) ? `[Array(${value.length})]` : `{Object}`
    return { display: `${hint} ••••••••`, masked: true }
  }
  return { display: formatValue(value), masked: false }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(timestamp).toLocaleDateString()
}

// ====== 子组件 ======

/** 插件图标渲染 */
function PluginIcon({ icon, name, size = 'md' }: { icon?: PluginInfo['icon']; name: string; size?: 'sm' | 'md' }) {
  const sizeClasses = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
  const iconSizeClasses = size === 'sm' ? '[&>svg]:h-4 [&>svg]:w-4' : '[&>svg]:h-5 [&>svg]:w-5'
  const imgSizeClasses = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6'
  const textSizeClasses = size === 'sm' ? 'text-xs' : 'text-sm'

  if (!icon) {
    return (
      <div className={`flex ${sizeClasses} items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600 dark:from-slate-800 dark:to-slate-700 dark:text-slate-200`}>
        <span className={`${textSizeClasses} font-bold`}>{name.slice(0, 1).toUpperCase()}</span>
      </div>
    )
  }

  if (icon.type === 'emoji') {
    return (
      <div className={`flex ${sizeClasses} items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800`}>
        <span className={textSizeClasses}>{icon.value}</span>
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

/** 搜索框 */
function FilterInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <input
        className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-xs text-slate-700 placeholder-slate-400 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-blue-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300"
          onClick={() => onChange('')}
          title="清除"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** 确认对话框 */
function ConfirmDialog({
  open, title, message, confirmLabel, onConfirm, onCancel
}: {
  open: boolean; title: string; message: string; confirmLabel: string
  onConfirm: () => void; onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[360px] rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="text-base font-semibold text-slate-900 dark:text-white">{title}</div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ====== 主组件 ======

interface PluginStorageExplorerViewProps {
  onBack: () => void
}

export default function PluginStorageExplorerView({ onBack }: PluginStorageExplorerViewProps) {
  // 数据状态
  const [pluginItems, setPluginItems] = useState<PluginStorageItem[]>([])
  const [selectedNs, setSelectedNs] = useState<string | null>(null)
  const [entries, setEntries] = useState<StorageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [entriesLoading, setEntriesLoading] = useState(false)

  // UI 状态
  const [nsFilter, setNsFilter] = useState('')
  const [keyFilter, setKeyFilter] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  // 确认对话框
  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; message: string; confirmLabel: string
    action: (() => Promise<void>) | null
  }>({ open: false, title: '', message: '', confirmLabel: '', action: null })

  // 用于取消过期请求
  const loadIdRef = useRef(0)

  // ---- 加载插件列表 + 存储命名空间，合并为视图模型 ----
  const loadPluginItems = useCallback(async () => {
    setLoading(true)
    try {
      const [namespaces, plugins] = await Promise.all([
        window.mulby.storage.listNamespaces(),
        window.mulby.plugin.getAll()
      ])

      // 构建 pluginName → PluginInfo 映射
      const pluginMap = new Map<string, PluginInfo>()
      for (const p of plugins) {
        pluginMap.set(p.name, p)
      }

      // 排除系统命名空间，兼容两种 plugin_id 格式：
      // 1. 带 plugin: 前缀（如 plugin:my-plugin）—— 新版 PluginStorage
      // 2. 直接插件名（如 my-plugin）—— 旧版或 IPC 直接调用
      const SYSTEM_NAMESPACES = new Set(['global', 'app', 'system', 'settings'])

      const items: PluginStorageItem[] = (namespaces || [])
        .filter(ns => !SYSTEM_NAMESPACES.has(ns.plugin_id))
        .map(ns => {
          // 尝试匹配插件：先去掉 plugin: 前缀再匹配，否则直接用 plugin_id 匹配
          const hasPrefix = ns.plugin_id.startsWith('plugin:')
          const pluginName = hasPrefix ? ns.plugin_id.slice(7) : ns.plugin_id
          const plugin = pluginMap.get(pluginName)
          return {
            namespace: ns.plugin_id,
            pluginName,
            displayName: plugin?.displayName || pluginName,
            icon: plugin?.icon,
            count: ns.count,
            lastUpdated: ns.lastUpdated,
            version: plugin?.version,
            installed: !!plugin
          }
        })
        .sort((a, b) => b.lastUpdated - a.lastUpdated) // 按最近更新排序

      setPluginItems(items)
    } catch (err) {
      console.error('[StorageExplorer] 加载插件数据失败:', err)
      setPluginItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPluginItems()
  }, [loadPluginItems])

  // ---- 加载指定命名空间的具体数据 ----
  const loadEntries = useCallback(async (ns: string) => {
    const id = ++loadIdRef.current
    setEntriesLoading(true)
    try {
      const result = await window.mulby.storage.getAllWithMeta(ns)
      // 仅在请求未过期时更新
      if (id === loadIdRef.current) {
        setEntries(result || [])
      }
    } catch (err) {
      console.error('[StorageExplorer] 加载数据失败:', err)
      if (id === loadIdRef.current) {
        setEntries([])
      }
    } finally {
      if (id === loadIdRef.current) {
        setEntriesLoading(false)
      }
    }
  }, [])

  // ---- 选择插件 ----
  const handleSelectPlugin = useCallback((ns: string) => {
    setSelectedNs(ns)
    setKeyFilter('')
    setExpandedKeys(new Set())
    setRevealedKeys(new Set())
    // 直接调用加载，避免 useEffect 间接触发可能的竞态问题
    void loadEntries(ns)
  }, [loadEntries])

  // 过滤后的插件列表
  const filteredPlugins = useMemo(() => {
    if (!nsFilter.trim()) return pluginItems
    const lower = nsFilter.toLowerCase()
    return pluginItems.filter(item =>
      item.displayName.toLowerCase().includes(lower) ||
      item.pluginName.toLowerCase().includes(lower)
    )
  }, [pluginItems, nsFilter])

  // 过滤后的条目列表
  const filteredEntries = useMemo(() => {
    if (!keyFilter.trim()) return entries
    const lower = keyFilter.toLowerCase()
    return entries.filter(e => e.key.toLowerCase().includes(lower))
  }, [entries, keyFilter])

  // 当前选中的插件信息
  const selectedPlugin = useMemo(
    () => pluginItems.find(item => item.namespace === selectedNs) || null,
    [pluginItems, selectedNs]
  )

  // 统计
  const totalKeys = useMemo(
    () => pluginItems.reduce((sum, item) => sum + item.count, 0),
    [pluginItems]
  )

  // ---- 操作回调 ----

  const copyValue = useCallback(async (entry: StorageEntry) => {
    try {
      const text = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2)
      await navigator.clipboard.writeText(text)
      setCopiedKey(entry.key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch { /* 静默 */ }
  }, [])

  const deleteKey = useCallback(async (ns: string, key: string) => {
    try {
      await window.mulby.storage.remove(key, ns)
      await Promise.all([loadEntries(ns), loadPluginItems()])
    } catch (err) {
      console.error('[StorageExplorer] 删除失败:', err)
    }
  }, [loadEntries, loadPluginItems])

  const clearNamespace = useCallback(async (ns: string) => {
    try {
      await window.mulby.storage.clear(ns)
      setEntries([])
      setSelectedNs(null)
      await loadPluginItems()
    } catch (err) {
      console.error('[StorageExplorer] 清空失败:', err)
    }
  }, [loadPluginItems])

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const toggleReveal = useCallback((key: string) => {
    setRevealedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const requestConfirm = useCallback(
    (title: string, message: string, confirmLabel: string, action: () => Promise<void>) => {
      setConfirmState({ open: true, title, message, confirmLabel, action })
    }, []
  )

  const handleConfirm = useCallback(async () => {
    if (confirmState.action) await confirmState.action()
    setConfirmState({ open: false, title: '', message: '', confirmLabel: '', action: null })
  }, [confirmState])

  const handleCancelConfirm = useCallback(() => {
    setConfirmState({ open: false, title: '', message: '', confirmLabel: '', action: null })
  }, [])

  // 骨架屏
  const Skeleton = ({ className = '' }: { className?: string }) => (
    <div className={`animate-pulse rounded-lg bg-slate-200/60 dark:bg-slate-800/60 ${className}`} />
  )

  return (
    <SettingsLikePageShell>
      <SettingsLikePageHeader
        eyebrow="开发者工具"
        title="插件数据浏览器"
        onBack={onBack}
        actions={
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {!loading && (
              <span>{pluginItems.length} 个插件 · {totalKeys} 条数据</span>
            )}
            <button
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
              onClick={() => {
                void loadPluginItems()
                if (selectedNs) void loadEntries(selectedNs)
              }}
              title="刷新"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
              </svg>
            </button>
          </div>
        }
      />

      <div className="flex flex-1 min-h-0 no-drag">
        {/* ========== 左侧：插件列表 ========== */}
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-slate-200/70 dark:border-slate-800/80">
          {/* 搜索框 */}
          <div className="px-3 py-3">
            <FilterInput value={nsFilter} onChange={setNsFilter} placeholder="搜索插件…" />
          </div>

          {/* 插件列表 */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {loading ? (
              <div className="space-y-1.5 px-1">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-[60px] w-full rounded-xl" />
                ))}
              </div>
            ) : filteredPlugins.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <svg className="mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
                <div className="text-xs text-slate-400 dark:text-slate-500">
                  {nsFilter ? '未找到匹配的插件' : '暂无插件存储数据'}
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredPlugins.map(item => {
                  const isSelected = selectedNs === item.namespace
                  return (
                    <button
                      key={item.namespace}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${
                        isSelected
                          ? 'bg-blue-50 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:ring-blue-800/50'
                          : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/40'
                      }`}
                      onClick={() => handleSelectPlugin(item.namespace)}
                    >
                      {/* 插件图标 */}
                      <div className="shrink-0">
                        <PluginIcon icon={item.icon} name={item.displayName} size="sm" />
                      </div>

                      {/* 插件信息 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`truncate text-sm font-medium ${
                            isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'
                          }`}>
                            {item.displayName}
                          </span>
                          {!item.installed && (
                            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                              未安装
                            </span>
                          )}
                        </div>
                        <div className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${
                          isSelected ? 'text-blue-500/70 dark:text-blue-400/60' : 'text-slate-400 dark:text-slate-500'
                        }`}>
                          <span>{item.count} 条</span>
                          <span>·</span>
                          <span>{formatRelativeTime(item.lastUpdated)}</span>
                        </div>
                      </div>

                      {/* 选中指示器 */}
                      {isSelected && (
                        <div className="h-5 w-1 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ========== 右侧：键值对详情 ========== */}
        <main className="flex flex-1 flex-col min-w-0 min-h-0">
          {!selectedNs || !selectedPlugin ? (
            /* 空状态 */
            <div className="flex flex-1 flex-col items-center justify-center text-center px-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800/60">
                <svg className="h-8 w-8 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                </svg>
              </div>
              <div className="text-sm font-medium text-slate-500 dark:text-slate-400">选择一个插件</div>
              <div className="mt-1 max-w-[240px] text-xs text-slate-400 dark:text-slate-500">
                从左侧列表中选择插件，查看其存储的键值对数据
              </div>
            </div>
          ) : (
            <>
              {/* 插件信息头部 + 工具栏 */}
              <div className="flex items-center gap-4 border-b border-slate-200/70 px-5 py-3 dark:border-slate-800/80">
                {/* 插件信息 */}
                <div className="flex items-center gap-3 min-w-0">
                  <PluginIcon icon={selectedPlugin.icon} name={selectedPlugin.displayName} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {selectedPlugin.displayName}
                      </span>
                      {selectedPlugin.version && (
                        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          v{selectedPlugin.version}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {selectedPlugin.pluginName}
                    </div>
                  </div>
                </div>

                {/* 搜索 + 工具 */}
                <div className="ml-auto flex items-center gap-2">
                  <div className="w-48">
                    <FilterInput value={keyFilter} onChange={setKeyFilter} placeholder="过滤 Key…" />
                  </div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                    {filteredEntries.length}/{entries.length}
                  </span>
                  <button
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                    onClick={() => void loadEntries(selectedNs)}
                    title="刷新数据"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
                    </svg>
                  </button>
                  {selectedPlugin.count > 0 && (
                    <button
                      className="rounded-lg border border-red-200 px-2.5 py-1 text-[11px] text-red-500 transition hover:border-red-300 hover:bg-red-50 dark:border-red-800/50 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-900/20"
                      onClick={() =>
                        requestConfirm(
                          '清空插件数据',
                          `确定要删除「${selectedPlugin.displayName}」的所有 ${selectedPlugin.count} 条存储数据吗？此操作不可撤销。`,
                          '确认清空',
                          () => clearNamespace(selectedNs)
                        )
                      }
                    >
                      清空全部
                    </button>
                  )}
                </div>
              </div>

              {/* 键值对列表 */}
              <div className="flex-1 overflow-y-auto">
                {entriesLoading ? (
                  <div className="space-y-1 p-4">
                    {[...Array(8)].map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-lg" />
                    ))}
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <svg className="mb-2 h-7 w-7 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      {keyFilter ? '未找到匹配的键' : '此插件暂无存储数据'}
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                    {filteredEntries.map(entry => {
                      const isExpanded = expandedKeys.has(entry.key)
                      const isRevealed = revealedKeys.has(entry.key)
                      const sensitive = isSensitiveKey(entry.key)
                      const { display, masked } = maskSensitiveValue(entry.value, entry.key)
                      const isMultiline =
                        typeof entry.value === 'object' ||
                        (typeof entry.value === 'string' && entry.value.length > 80)
                      const isCopied = copiedKey === entry.key

                      const displayContent = (sensitive && !isRevealed)
                        ? display
                        : formatValue(entry.value)

                      return (
                        <div
                          key={entry.key}
                          className="group px-5 py-3 transition-colors hover:bg-white/60 dark:hover:bg-slate-900/30"
                        >
                          <div className="flex items-start gap-3">
                            {/* Key + Value */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <code className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                                  {entry.key}
                                </code>
                                {sensitive && (
                                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                    敏感
                                  </span>
                                )}
                              </div>
                              {/* Value */}
                              <div className="mt-1">
                                {isMultiline && !isExpanded ? (
                                  <button className="text-left" onClick={() => toggleExpand(entry.key)}>
                                    <code className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                                      {displayContent.slice(0, 120)}{displayContent.length > 120 ? '…' : ''}
                                    </code>
                                    <span className="ml-1 text-[10px] text-blue-500 hover:text-blue-600">展开</span>
                                  </button>
                                ) : isMultiline && isExpanded ? (
                                  <div>
                                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100/80 p-3 text-xs text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                                      {displayContent}
                                    </pre>
                                    <button className="mt-1 text-[10px] text-blue-500 hover:text-blue-600" onClick={() => toggleExpand(entry.key)}>
                                      折叠
                                    </button>
                                  </div>
                                ) : (
                                  <code className="text-xs text-slate-500 dark:text-slate-400">
                                    {displayContent}
                                  </code>
                                )}
                              </div>
                            </div>

                            {/* 时间 + 操作按钮 */}
                            <div className="flex shrink-0 items-center gap-1">
                              <span className="text-[11px] text-slate-400 dark:text-slate-500 mr-1">
                                {formatRelativeTime(entry.updatedAt)}
                              </span>

                              {/* 敏感数据显隐 */}
                              {masked && (
                                <button
                                  className="rounded-md p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                                  onClick={() => toggleReveal(entry.key)}
                                  title={isRevealed ? '隐藏' : '显示'}
                                >
                                  {isRevealed ? (
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                                    </svg>
                                  ) : (
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                  )}
                                </button>
                              )}

                              {/* 复制 */}
                              <button
                                className="rounded-md p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                                onClick={() => void copyValue(entry)}
                                title="复制值"
                              >
                                {isCopied ? (
                                  <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                  </svg>
                                ) : (
                                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                                  </svg>
                                )}
                              </button>

                              {/* 删除 */}
                              <button
                                className="rounded-md p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                                onClick={() =>
                                  requestConfirm(
                                    '删除键值对',
                                    `确定要删除键「${entry.key}」吗？此操作不可撤销。`,
                                    '确认删除',
                                    () => deleteKey(selectedNs, entry.key)
                                  )
                                }
                                title="删除"
                              >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* 确认对话框 */}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        onConfirm={() => void handleConfirm()}
        onCancel={handleCancelConfirm}
      />
    </SettingsLikePageShell>
  )
}
