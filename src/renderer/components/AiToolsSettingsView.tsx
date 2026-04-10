import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AiToolCapabilityGrant,
  AiToolWebSearchSettings,
  AppSettings,
  CustomSearchApiConfig
} from '../../shared/types/settings'
import type { PluginInfo } from '../../shared/types/electron'
import UnifiedSelect from './UnifiedSelect'
import {
  SettingsLikePageHeader,
  SettingsLikePageShell
} from './SettingsLikePageChrome'
import CapabilityPolicy from './settings/sections/security/CapabilityPolicy'
import RunScriptRegistry from './settings/sections/security/RunScriptRegistry'
import { DEFAULT_APP_CAPABILITIES } from './settings/constants'
import { parseListDraft } from './settings/utils'
import type { GrantDraft, RunScriptDraft } from './settings/sections/security/types'
import McpServerPanel from './ai-tools/McpServerPanel'

// ===================== 常量 =====================

/** 内置 API Provider 选项 */
const BUILTIN_API_PROVIDERS = [
  { id: 'tavily', label: 'Tavily', description: '推荐，免费 1000 次/月', keyPlaceholder: 'tvly-...', docsUrl: 'https://app.tavily.com/home', docsLabel: 'app.tavily.com' },
  { id: 'jina', label: 'Jina AI', description: '高质量页面抓取 + 搜索', keyPlaceholder: 's_...', docsUrl: 'https://jina.ai/api-dashboard/', docsLabel: 'jina.ai' }
] as const

/** 左侧列表 Section ID */
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
const pillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white'
const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white p-6 dark:border-slate-800/80 dark:bg-slate-900'

// ===================== 安全策略侧边栏 Section 定义 =====================

const SECURITY_SECTIONS = [
  { id: 'ai-general', label: '总开关 / 文件限制', icon: '⚡' },
  { id: 'ai-paths', label: '路径白名单', icon: '📁' },
  { id: 'ai-http', label: '网络请求', icon: '🌐' },
  { id: 'ai-scripts', label: '预置脚本', icon: '🔧' },
  { id: 'ai-capability', label: '能力授权', icon: '🛡' }
] as const

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

// ===================== 安全策略图标组件 =====================

function SecuritySectionIcon({ id }: { id: string }) {
  switch (id) {
    case 'ai-general':
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'ai-paths':
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'ai-http':
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'ai-scripts':
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'ai-capability':
      return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    default:
      return null
  }
}

// ===================== 主组件 =====================

interface AiToolsSettingsViewProps {
  onBack: () => void
}

export default function AiToolsSettingsView({ onBack }: AiToolsSettingsViewProps) {
  // ---- Web Search 设置 ----
  const [wsSettings, setWsSettings] = useState<AiToolWebSearchSettings | null>(null)
  // ---- 全量 AppSettings（用于 aiTooling 下非 webSearch 的配置） ----
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)

  const [loading, setLoading] = useState(true)
  const [activeTool, setActiveTool] = useState<ToolSectionId>('web-search')

  // 自定义 API 编辑态
  const [showAddCustomApi, setShowAddCustomApi] = useState(false)
  const [editingCustomApi, setEditingCustomApi] = useState<Partial<CustomSearchApiConfig>>({})

  // 插件工具数据
  const [pluginTools, setPluginTools] = useState<PluginToolInfo[]>([])
  // 用户禁用的插件工具 key 集合（格式 "pluginId:toolName"）
  const [disabledPluginToolKeys, setDisabledPluginToolKeys] = useState<Set<string>>(new Set())

  // ---- AI 安全策略 draft state ----
  const [filesystemRootDraft, setFilesystemRootDraft] = useState('')
  const [patchRootDraft, setPatchRootDraft] = useState('')
  const [gitRootDraft, setGitRootDraft] = useState('')
  const [denyHostDraft, setDenyHostDraft] = useState('')
  const [denyCidrDraft, setDenyCidrDraft] = useState('')
  const [denyPrefixDraft, setDenyPrefixDraft] = useState('')
  const [appCapabilityDraft, setAppCapabilityDraft] = useState('')
  const [grantDraft, setGrantDraft] = useState<GrantDraft>({
    capability: 'shell.exec',
    decision: 'deny',
    expiresAt: ''
  })
  const [runScriptDraft, setRunScriptDraft] = useState<RunScriptDraft>({
    id: '',
    command: '',
    args: '',
    cwd: '',
    timeoutMs: '',
    allowEnvKeys: ''
  })

  // 加载设置 + 插件列表 + 禁用列表 + AppSettings
  useEffect(() => {
    setLoading(true)
    const loadWebSearch = window.mulby?.ai?.tooling?.webSearch?.get?.()
      .then((data) => {
        setWsSettings(data as unknown as AiToolWebSearchSettings)
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

    const loadAppSettings = window.mulby.settings.get()
      .then(({ settings }) => {
        setAppSettings(settings)
      })
      .catch((err) => {
        console.error('加载 AppSettings 失败:', err)
      })

    Promise.all([loadWebSearch, loadPlugins, loadDisabled, loadAppSettings].filter(Boolean)).finally(() => {
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
  // 从后端刷新 appSettings 快照，确保与独立 IPC 通道的修改保持同步
  const refreshAppSettings = useCallback(async () => {
    try {
      const { settings } = await window.mulby.settings.get()
      setAppSettings(settings)
    } catch (err) {
      console.error('刷新 AppSettings 失败:', err)
    }
  }, [])

  const persistDisabledKeys = useCallback(async (nextSet: Set<string>) => {
    setDisabledPluginToolKeys(nextSet)
    try {
      const saved = await window.mulby?.ai?.tooling?.pluginTools?.setDisabled?.([...nextSet])
      if (saved) {
        setDisabledPluginToolKeys(new Set(saved))
      }
      // 刷新 appSettings 快照，防止后续 updateAiTooling 用过时的 disabledPluginTools 覆盖
      await refreshAppSettings()
    } catch (err) {
      console.error('保存禁用工具列表失败:', err)
    }
  }, [refreshAppSettings])

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

  // 保存 Web Search 设置
  const saveWsSettings = useCallback(async (patch: Partial<AiToolWebSearchSettings>) => {
    if (!wsSettings) return
    const next = { ...wsSettings, ...patch }
    setWsSettings(next)
    try {
      const result = await window.mulby?.ai?.tooling?.webSearch?.update?.(patch as unknown as Record<string, unknown>)
      if (result) {
        setWsSettings(result as unknown as AiToolWebSearchSettings)
      }
      // 刷新 appSettings 快照，防止后续 updateAiTooling 用过时的 webSearch 覆盖
      await refreshAppSettings()
    } catch (err) {
      console.error('保存 Web Search 设置失败:', err)
    }
  }, [wsSettings, refreshAppSettings])

  // ---- AppSettings 更新辅助函数 ----

  const updateAiTooling = useCallback(async (patch: Partial<AppSettings['aiTooling']>) => {
    // 总是从后端获取最新 settings 再 merge，避免用过时快照覆盖 webSearch/disabledPluginTools
    const { settings: latest } = await window.mulby.settings.get()
    const result = await window.mulby.settings.update({
      aiTooling: {
        ...latest.aiTooling,
        ...patch
      }
    })
    setAppSettings(result.settings)
  }, [])

  const updateAiFilesystem = useCallback(async (patch: Partial<AppSettings['aiTooling']['filesystem']>) => {
    if (!appSettings) return
    await updateAiTooling({
      filesystem: {
        ...appSettings.aiTooling.filesystem,
        ...patch
      }
    })
  }, [appSettings, updateAiTooling])

  const updateAiPatch = useCallback(async (patch: Partial<AppSettings['aiTooling']['patch']>) => {
    if (!appSettings) return
    await updateAiTooling({
      patch: {
        ...appSettings.aiTooling.patch,
        ...patch
      }
    })
  }, [appSettings, updateAiTooling])

  const updateAiGit = useCallback(async (patch: Partial<AppSettings['aiTooling']['git']>) => {
    if (!appSettings) return
    await updateAiTooling({
      git: {
        ...appSettings.aiTooling.git,
        ...patch
      }
    })
  }, [appSettings, updateAiTooling])

  const updateAiHttp = useCallback(async (patch: Partial<AppSettings['aiTooling']['http']>) => {
    if (!appSettings) return
    await updateAiTooling({
      http: {
        ...appSettings.aiTooling.http,
        ...patch
      }
    })
  }, [appSettings, updateAiTooling])

  const updateAiRunScript = useCallback(async (patch: Partial<AppSettings['aiTooling']['runScript']>) => {
    if (!appSettings) return
    await updateAiTooling({
      runScript: {
        ...appSettings.aiTooling.runScript,
        ...patch
      }
    })
  }, [appSettings, updateAiTooling])

  const updateAiCapabilityPolicy = useCallback(async (patch: Partial<AppSettings['aiTooling']['capabilityPolicy']>) => {
    if (!appSettings) return
    const current = appSettings.aiTooling.capabilityPolicy
    await updateAiTooling({
      capabilityPolicy: {
        defaultAppCapabilities: patch.defaultAppCapabilities ?? current.defaultAppCapabilities,
        globalGrants: patch.globalGrants ?? current.globalGrants
      }
    })
  }, [appSettings, updateAiTooling])

  // ---- 列表操作辅助 ----

  const addUniqueListItem = (list: string[], draft: string): string[] => {
    const parsed = parseListDraft(draft)
    if (parsed.length === 0) return list
    const next = [...list]
    const seen = new Set(list.map((item) => item.toLowerCase()))
    for (const item of parsed) {
      const token = item.toLowerCase()
      if (seen.has(token)) continue
      seen.add(token)
      next.push(item)
    }
    return next
  }

  // ---- 路径白名单操作 ----

  const addFilesystemRoot = async () => {
    if (!appSettings) return
    const next = addUniqueListItem(appSettings.aiTooling.filesystem.allowedRoots || [], filesystemRootDraft)
    if (next.length === appSettings.aiTooling.filesystem.allowedRoots.length) return
    await updateAiFilesystem({ allowedRoots: next })
    setFilesystemRootDraft('')
  }
  const removeFilesystemRoot = async (value: string) => {
    if (!appSettings) return
    const next = (appSettings.aiTooling.filesystem.allowedRoots || []).filter((item) => item !== value)
    await updateAiFilesystem({ allowedRoots: next })
  }

  const addPatchRoot = async () => {
    if (!appSettings) return
    const next = addUniqueListItem(appSettings.aiTooling.patch.allowedRoots || [], patchRootDraft)
    if (next.length === appSettings.aiTooling.patch.allowedRoots.length) return
    await updateAiPatch({ allowedRoots: next })
    setPatchRootDraft('')
  }
  const removePatchRoot = async (value: string) => {
    if (!appSettings) return
    const next = (appSettings.aiTooling.patch.allowedRoots || []).filter((item) => item !== value)
    await updateAiPatch({ allowedRoots: next })
  }

  const addGitRoot = async () => {
    if (!appSettings) return
    const next = addUniqueListItem(appSettings.aiTooling.git.allowedRepoRoots || [], gitRootDraft)
    if (next.length === appSettings.aiTooling.git.allowedRepoRoots.length) return
    await updateAiGit({ allowedRepoRoots: next })
    setGitRootDraft('')
  }
  const removeGitRoot = async (value: string) => {
    if (!appSettings) return
    const next = (appSettings.aiTooling.git.allowedRepoRoots || []).filter((item) => item !== value)
    await updateAiGit({ allowedRepoRoots: next })
  }

  // ---- HTTP 黑名单操作 ----

  const addHttpDenyHost = async () => {
    if (!appSettings) return
    const next = addUniqueListItem(appSettings.aiTooling.http.denyHosts || [], denyHostDraft)
    if (next.length === appSettings.aiTooling.http.denyHosts.length) return
    await updateAiHttp({ denyHosts: next })
    setDenyHostDraft('')
  }
  const removeHttpDenyHost = async (value: string) => {
    if (!appSettings) return
    const next = (appSettings.aiTooling.http.denyHosts || []).filter((item) => item !== value)
    await updateAiHttp({ denyHosts: next })
  }
  const addHttpDenyCidr = async () => {
    if (!appSettings) return
    const next = addUniqueListItem(appSettings.aiTooling.http.denyCidrs || [], denyCidrDraft)
    if (next.length === appSettings.aiTooling.http.denyCidrs.length) return
    await updateAiHttp({ denyCidrs: next })
    setDenyCidrDraft('')
  }
  const removeHttpDenyCidr = async (value: string) => {
    if (!appSettings) return
    const next = (appSettings.aiTooling.http.denyCidrs || []).filter((item) => item !== value)
    await updateAiHttp({ denyCidrs: next })
  }
  const addHttpDenyPrefix = async () => {
    if (!appSettings) return
    const next = addUniqueListItem(appSettings.aiTooling.http.denyUrlPrefixes || [], denyPrefixDraft)
    if (next.length === appSettings.aiTooling.http.denyUrlPrefixes.length) return
    await updateAiHttp({ denyUrlPrefixes: next })
    setDenyPrefixDraft('')
  }
  const removeHttpDenyPrefix = async (value: string) => {
    if (!appSettings) return
    const next = (appSettings.aiTooling.http.denyUrlPrefixes || []).filter((item) => item !== value)
    await updateAiHttp({ denyUrlPrefixes: next })
  }

  // ---- 能力策略操作 ----

  const visibleCapabilityGrants = useMemo(() => {
    if (!appSettings) return []
    return appSettings.aiTooling.capabilityPolicy.globalGrants || []
  }, [appSettings])

  const isDefaultAppCapabilitiesAtDefault = useMemo(() => {
    if (!appSettings) return true
    const current = appSettings.aiTooling.capabilityPolicy.defaultAppCapabilities || []
    if (current.length !== DEFAULT_APP_CAPABILITIES.length) return false
    return DEFAULT_APP_CAPABILITIES.every((value, index) => current[index] === value)
  }, [appSettings])

  const restoreDefaultAppCapabilities = async () => {
    if (!appSettings) return
    await updateAiCapabilityPolicy({ defaultAppCapabilities: [...DEFAULT_APP_CAPABILITIES] })
  }

  const addCapabilityToPolicyList = async (
    key: 'defaultAppCapabilities',
    draft: string,
    reset: () => void
  ) => {
    if (!appSettings) return
    const next = addUniqueListItem(appSettings.aiTooling.capabilityPolicy[key] || [], draft)
    if (next.length === appSettings.aiTooling.capabilityPolicy[key].length) return
    await updateAiCapabilityPolicy({ [key]: next })
    reset()
  }

  const removeCapabilityFromPolicyList = async (
    key: 'defaultAppCapabilities',
    capability: string
  ) => {
    if (!appSettings) return
    const next = (appSettings.aiTooling.capabilityPolicy[key] || []).filter((item) => item !== capability)
    await updateAiCapabilityPolicy({ [key]: next })
  }

  const addCapabilityGrant = async () => {
    if (!appSettings) return
    const capability = grantDraft.capability.trim()
    if (!capability) return
    const exists = (appSettings.aiTooling.capabilityPolicy.globalGrants || []).some((item) =>
      item.capability === capability && item.decision === grantDraft.decision
    )
    if (exists) return
    const now = Date.now()
    const expiresAtMs = grantDraft.expiresAt ? Date.parse(grantDraft.expiresAt) : undefined
    const expiresAt = Number.isFinite(expiresAtMs || NaN) ? expiresAtMs : undefined
    const nextGrant: AiToolCapabilityGrant = {
      id: `grant-${now}-${Math.random().toString(36).slice(2, 8)}`,
      capability,
      decision: grantDraft.decision,
      createdAt: now,
      updatedAt: now,
      expiresAt
    }
    await updateAiCapabilityPolicy({
      globalGrants: [...(appSettings.aiTooling.capabilityPolicy.globalGrants || []), nextGrant]
    })
    setGrantDraft((prev) => ({ ...prev, expiresAt: '' }))
  }

  const removeCapabilityGrant = async (grantId: string) => {
    if (!appSettings) return
    const next = (appSettings.aiTooling.capabilityPolicy.globalGrants || []).filter((item) => item.id !== grantId)
    await updateAiCapabilityPolicy({ globalGrants: next })
  }

  const patchCapabilityGrant = async (grantId: string, patch: Partial<AiToolCapabilityGrant>) => {
    if (!appSettings) return
    const now = Date.now()
    const next = (appSettings.aiTooling.capabilityPolicy.globalGrants || []).map((item) => (
      item.id === grantId ? { ...item, ...patch, updatedAt: now } : item
    ))
    await updateAiCapabilityPolicy({ globalGrants: next })
  }

  // ---- 预置脚本操作 ----

  const updateRunScriptEntry = async (
    index: number,
    patch: Partial<AppSettings['aiTooling']['runScript']['entries'][number]>
  ) => {
    if (!appSettings) return
    const entries = [...(appSettings.aiTooling.runScript.entries || [])]
    if (!entries[index]) return
    entries[index] = { ...entries[index], ...patch }
    await updateAiRunScript({ entries })
  }

  const removeRunScriptEntry = async (index: number) => {
    if (!appSettings) return
    const entries = (appSettings.aiTooling.runScript.entries || []).filter((_, i) => i !== index)
    await updateAiRunScript({ entries })
  }

  const addRunScriptEntry = async () => {
    if (!appSettings) return
    const id = runScriptDraft.id.trim()
    const command = runScriptDraft.command.trim()
    if (!id || !command) return
    const exists = (appSettings.aiTooling.runScript.entries || []).some((item) => item.id === id)
    if (exists) return
    const args = parseListDraft(runScriptDraft.args)
    const allowEnvKeys = parseListDraft(runScriptDraft.allowEnvKeys)
    const timeoutRaw = Number(runScriptDraft.timeoutMs)
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined
    const nextEntry: AppSettings['aiTooling']['runScript']['entries'][number] = {
      id,
      command,
      args: args.length > 0 ? args : undefined,
      cwd: runScriptDraft.cwd.trim() || undefined,
      timeoutMs,
      allowEnvKeys: allowEnvKeys.length > 0 ? allowEnvKeys : undefined
    }
    await updateAiRunScript({
      entries: [...(appSettings.aiTooling.runScript.entries || []), nextEntry]
    })
    setRunScriptDraft({ id: '', command: '', args: '', cwd: '', timeoutMs: '', allowEnvKeys: '' })
  }

  // 构建 Provider 选项列表
  const providerOptions = useMemo<ProviderOption[]>(() => {
    const list: ProviderOption[] = []

    // 本地引擎
    if (wsSettings?.localEngines) {
      for (const engine of wsSettings.localEngines) {
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
    if (wsSettings?.customApis) {
      for (const api of wsSettings.customApis) {
        list.push({ id: `custom-${api.id}`, label: api.name, description: api.apiHost, group: 'custom' })
      }
    }

    return list
  }, [wsSettings])

  const activeProvider = wsSettings?.activeProvider || 'local-bing'
  const activeBuiltinApi = BUILTIN_API_PROVIDERS.find((p) => p.id === activeProvider)
  const activeOption = providerOptions.find((p) => p.id === activeProvider)

  // 判断当前 activeTool 类别
  const isSecuritySection = activeTool.startsWith('ai-')

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
          <div className="relative min-h-0 flex-1 overflow-y-auto space-y-1">
            {/* ---- 工具分组 ---- */}
            <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 px-1">工具</div>

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

            {/* ---- 安全策略分组 ---- */}
            <div className="mt-4 mb-1 text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 px-1">安全策略</div>
            {SECURITY_SECTIONS.map((sec) => (
              <ToolSidebarItem
                key={sec.id}
                active={activeTool === sec.id}
                label={sec.label}
                onClick={() => setActiveTool(sec.id)}
                icon={<SecuritySectionIcon id={sec.id} />}
              />
            ))}

            {/* ---- 服务分组 ---- */}
            <div className="mt-4 mb-1 text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 px-1">服务</div>
            <ToolSidebarItem
              active={activeTool === 'mcp-server'}
              label="MCP Server"
              onClick={() => setActiveTool('mcp-server')}
              icon={
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="2" y="3" width="20" height="6" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="2" y="15" width="20" height="6" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="6" cy="6" r="1" fill="currentColor" />
                  <circle cx="6" cy="18" r="1" fill="currentColor" />
                </svg>
              }
            />

            {/* ---- 插件工具分组（动态列表，放在最下方） ---- */}
            {pluginTools.length > 0 && (
              <>
                <div className="mt-4 mb-1 text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 px-1">插件工具</div>
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
            ) : activeTool === 'mcp-server' ? (
              /* ==================== MCP Server 面板 ==================== */
              <McpServerPanel />
            ) : isSecuritySection && appSettings ? (
              /* ==================== 安全策略面板 ==================== */
              <div className="space-y-5">
                {activeTool === 'ai-general' && (
                  <>
                    {/* AI 内置工具总开关 */}
                    <div className={`${cardClass} space-y-4`}>
                      <div className="text-sm font-medium text-slate-900 dark:text-white">AI 内置工具总开关</div>
                      <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800/80">
                        <div>
                          <div className="text-sm text-slate-900 dark:text-white">启用 aiTooling</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">关闭后将拒绝所有内置工具（read/list/search/patch/http/script/git）</div>
                        </div>
                        <button
                          className={`relative w-11 h-6 rounded-full transition-colors ${appSettings.aiTooling.enabled
                            ? 'bg-blue-500'
                            : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                          onClick={() => void updateAiTooling({ enabled: !appSettings.aiTooling.enabled })}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${appSettings.aiTooling.enabled ? 'translate-x-5' : ''}`}
                          />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                          <div className="text-xs text-slate-500 dark:text-slate-400">filesystem 最大读取（bytes）</div>
                          <input
                            type="number"
                            min={1024}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                            value={appSettings.aiTooling.filesystem.maxReadBytes}
                            onChange={(e) => void updateAiFilesystem({ maxReadBytes: Number(e.target.value || 0) })}
                          />
                        </label>
                        <label className="space-y-1">
                          <div className="text-xs text-slate-500 dark:text-slate-400">filesystem 搜索命中上限</div>
                          <input
                            type="number"
                            min={10}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                            value={appSettings.aiTooling.filesystem.maxSearchHits}
                            onChange={(e) => void updateAiFilesystem({ maxSearchHits: Number(e.target.value || 0) })}
                          />
                        </label>
                      </div>
                    </div>
                  </>
                )}

                {activeTool === 'ai-paths' && (
                  <div className={`${cardClass} space-y-4`}>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">路径白名单（allowedRoots / allowedRepoRoots）</div>
                    <div className="space-y-4">
                      {/* filesystem */}
                      <div className="space-y-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">filesystem.allowedRoots（文件读取/检索范围）</div>
                        <div className="space-y-2">
                          {(appSettings.aiTooling.filesystem.allowedRoots || []).map((item) => (
                            <div key={`fs-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                              <div className="truncate">{item}</div>
                              <button className={actionButtonClass} onClick={() => void removeFilesystemRoot(item)}>删除</button>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                          <input
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                            placeholder="新增路径，支持逗号或换行批量"
                            value={filesystemRootDraft}
                            onChange={(e) => setFilesystemRootDraft(e.target.value)}
                          />
                          <button className={actionButtonClass} onClick={() => void addFilesystemRoot()}>新增</button>
                        </div>
                      </div>

                      {/* patch */}
                      <div className="space-y-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">patch.allowedRoots（补丁应用范围）</div>
                        <div className="space-y-2">
                          {(appSettings.aiTooling.patch.allowedRoots || []).map((item) => (
                            <div key={`patch-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                              <div className="truncate">{item}</div>
                              <button className={actionButtonClass} onClick={() => void removePatchRoot(item)}>删除</button>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                          <input
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                            placeholder="新增路径，支持逗号或换行批量"
                            value={patchRootDraft}
                            onChange={(e) => setPatchRootDraft(e.target.value)}
                          />
                          <button className={actionButtonClass} onClick={() => void addPatchRoot()}>新增</button>
                        </div>
                      </div>

                      {/* git */}
                      <div className="space-y-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">git.allowedRepoRoots（Git 仓库范围）</div>
                        <div className="space-y-2">
                          {(appSettings.aiTooling.git.allowedRepoRoots || []).map((item) => (
                            <div key={`git-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                              <div className="truncate">{item}</div>
                              <button className={actionButtonClass} onClick={() => void removeGitRoot(item)}>删除</button>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                          <input
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                            placeholder="新增路径，支持逗号或换行批量"
                            value={gitRootDraft}
                            onChange={(e) => setGitRootDraft(e.target.value)}
                          />
                          <button className={actionButtonClass} onClick={() => void addGitRoot()}>新增</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTool === 'ai-http' && (
                  <div className={`${cardClass} space-y-4`}>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">HTTP 黑名单与限制</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">超时（ms）</div>
                        <input
                          type="number"
                          min={1000}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={appSettings.aiTooling.http.timeoutMs}
                          onChange={(e) => void updateAiHttp({ timeoutMs: Number(e.target.value || 0) })}
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">响应体上限（bytes）</div>
                        <input
                          type="number"
                          min={1024}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={appSettings.aiTooling.http.maxResponseBytes}
                          onChange={(e) => void updateAiHttp({ maxResponseBytes: Number(e.target.value || 0) })}
                        />
                      </label>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">denyHosts（拒绝访问的域名）</div>
                      {(appSettings.aiTooling.http.denyHosts || []).map((item) => (
                        <div key={`deny-host-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="truncate">{item}</div>
                          <button className={actionButtonClass} onClick={() => void removeHttpDenyHost(item)}>删除</button>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                        <input
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                          placeholder="例如 localhost, example.com"
                          value={denyHostDraft}
                          onChange={(e) => setDenyHostDraft(e.target.value)}
                        />
                        <button className={actionButtonClass} onClick={() => void addHttpDenyHost()}>新增</button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">denyCidrs（拒绝访问的网段）</div>
                      {(appSettings.aiTooling.http.denyCidrs || []).map((item) => (
                        <div key={`deny-cidr-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="truncate">{item}</div>
                          <button className={actionButtonClass} onClick={() => void removeHttpDenyCidr(item)}>删除</button>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                        <input
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                          placeholder="例如 127.0.0.0/8"
                          value={denyCidrDraft}
                          onChange={(e) => setDenyCidrDraft(e.target.value)}
                        />
                        <button className={actionButtonClass} onClick={() => void addHttpDenyCidr()}>新增</button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">denyUrlPrefixes（拒绝访问的 URL 前缀）</div>
                      {(appSettings.aiTooling.http.denyUrlPrefixes || []).map((item) => (
                        <div key={`deny-prefix-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="truncate">{item}</div>
                          <button className={actionButtonClass} onClick={() => void removeHttpDenyPrefix(item)}>删除</button>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                        <input
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                          placeholder="例如 https://internal.example.com/"
                          value={denyPrefixDraft}
                          onChange={(e) => setDenyPrefixDraft(e.target.value)}
                        />
                        <button className={actionButtonClass} onClick={() => void addHttpDenyPrefix()}>新增</button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTool === 'ai-scripts' && (
                  <RunScriptRegistry
                    settings={appSettings}
                    runScriptDraft={runScriptDraft}
                    setRunScriptDraft={setRunScriptDraft}
                    updateAiRunScript={updateAiRunScript}
                    updateRunScriptEntry={updateRunScriptEntry}
                    removeRunScriptEntry={removeRunScriptEntry}
                    addRunScriptEntry={addRunScriptEntry}
                    cardClass={cardClass}
                    actionButtonClass={actionButtonClass}
                  />
                )}

                {activeTool === 'ai-capability' && (
                  <CapabilityPolicy
                    settings={appSettings}
                    visibleCapabilityGrants={visibleCapabilityGrants}
                    isDefaultAppCapabilitiesAtDefault={isDefaultAppCapabilitiesAtDefault}
                    appCapabilityDraft={appCapabilityDraft}
                    setAppCapabilityDraft={setAppCapabilityDraft}
                    grantDraft={grantDraft}
                    setGrantDraft={setGrantDraft}
                    restoreDefaultAppCapabilities={restoreDefaultAppCapabilities}
                    removeCapabilityFromPolicyList={removeCapabilityFromPolicyList}
                    addCapabilityToPolicyList={addCapabilityToPolicyList}
                    addCapabilityGrant={addCapabilityGrant}
                    removeCapabilityGrant={removeCapabilityGrant}
                    patchCapabilityGrant={patchCapabilityGrant}
                    cardClass={cardClass}
                    actionButtonClass={actionButtonClass}
                    pillClass={pillClass}
                  />
                )}
              </div>
            ) : !wsSettings ? (
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
                        onActivate={() => saveWsSettings({ activeProvider: option.id })}
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
                          value={wsSettings.providerKeys?.[activeProvider as 'tavily' | 'jina'] || ''}
                          onChange={(e) => {
                            const key = activeProvider as 'tavily' | 'jina'
                            saveWsSettings({
                              providerKeys: {
                                ...wsSettings.providerKeys,
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
                            value={wsSettings.tavilyApiHost || ''}
                            onChange={(e) => saveWsSettings({ tavilyApiHost: e.target.value || undefined })}
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
                      const hasKey = !!wsSettings.providerKeys?.[api.id]
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
                        value={wsSettings.maxResults}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(20, parseInt(e.target.value) || 5))
                          saveWsSettings({ maxResults: v })
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
                        value={wsSettings.maxContentLength}
                        onChange={(e) => {
                          const v = Math.max(1000, Math.min(50000, parseInt(e.target.value) || 8000))
                          saveWsSettings({ maxContentLength: v })
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
                        value={Math.round(wsSettings.timeoutMs / 1000)}
                        onChange={(e) => {
                          const v = Math.max(5, Math.min(120, parseInt(e.target.value) || 30))
                          saveWsSettings({ timeoutMs: v * 1000 })
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
                    {(wsSettings.customApis || []).length === 0 && !showAddCustomApi && (
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
                    {(wsSettings.customApis || []).map((api) => (
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
                            const filtered = (wsSettings.customApis || []).filter((a) => a.id !== api.id)
                            const patch: Partial<AiToolWebSearchSettings> = { customApis: filtered }
                            if (activeProvider === `custom-${api.id}`) {
                              patch.activeProvider = 'local-bing'
                            }
                            saveWsSettings(patch)
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
                  const existing = wsSettings?.customApis || []
                  saveWsSettings({ customApis: [...existing, api] })
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
