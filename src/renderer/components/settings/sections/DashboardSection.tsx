import { useEffect, useState } from 'react'
import type { PluginInfo, UpdateCenterState, AppInfo, AppResourceUsage } from '../../../../shared/types/electron'
import type { BackgroundPluginInfo } from '../../../../shared/types/plugin'
import type { NodeStatusInfo } from '../../../../shared/types/openclaw-protocol'

// 快捷入口定义
const QUICK_ENTRIES = [
  {
    id: 'plugin-manager',
    label: '插件管理',
    description: '管理启用状态、更新与卸载',
    // Heroicons: puzzle-piece (outline)
    icon: (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875S10.5 3.089 10.5 4.125c0 .369.128.713.349 1.003.215.283.401.604.401.959V6a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 0-.75.75v3.087c0 .355.186.676.401.959.221.29.349.634.349 1.003 0 1.036-1.007 1.875-2.25 1.875S3 13.661 3 12.625c0-.369.128-.713.349-1.003.215-.283.401-.604.401-.959V7.5a2.25 2.25 0 0 1 2.25-2.25h3.276a.75.75 0 0 0 .75-.75v-.318c0-.424.225-.808.526-1.107A2.23 2.23 0 0 0 12 1.5a2.23 2.23 0 0 0 1.448 1.575c.301.299.526.683.526 1.107V4.5a.75.75 0 0 0 .75.75H18a2.25 2.25 0 0 1 2.25 2.25v3.276a.75.75 0 0 1-.75.75h-.318c-.424 0-.808.225-1.107.526A2.23 2.23 0 0 0 16.5 13.5c0 .57.267 1.088.575 1.448.299.301.683.526 1.107.526h.318a.75.75 0 0 1 .75.75V19.5a2.25 2.25 0 0 1-2.25 2.25h-3.276a.75.75 0 0 1-.75-.75v-.318c0-.424-.225-.808-.526-1.107A2.23 2.23 0 0 0 10.5 18c-.57 0-1.088.267-1.448.575-.301.299-.526.683-.526 1.107v.318a.75.75 0 0 1-.75.75H6a2.25 2.25 0 0 1-2.25-2.25V15.75a.75.75 0 0 0-.75-.75h-.087" />
      </svg>
    )
  },
  {
    id: 'plugin-store',
    label: '插件商店',
    description: '浏览并安装新插件',
    // Heroicons: shopping-bag (outline)
    icon: (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
      </svg>
    )
  },
  {
    id: 'ai-settings',
    label: 'AI 设置',
    description: '配置 Provider 与模型',
    // Heroicons: sparkles (outline)
    icon: (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
      </svg>
    )
  },
  {
    id: 'background-plugins',
    label: '运行中的插件',
    description: '查看正在运行的插件进程',
    // Heroicons: play-circle (outline)
    icon: (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z" />
      </svg>
    )
  },
  {
    id: 'task-scheduler',
    label: '任务调度器',
    description: '管理定时任务',
    // Heroicons: clock (outline)
    icon: (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    )
  },
  {
    id: 'storage-explorer',
    label: '数据浏览器',
    description: '查看插件存储的键值对',
    // Heroicons: circle-stack (outline)
    icon: (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    )
  }
] as const

// Dashboard 统计数据
interface DashboardStats {
  installedPlugins: number
  enabledPlugins: number
  backgroundPlugins: number
  scheduledTasks: number
  updatablePlugins: number
}

interface DashboardSectionProps {
  onOpenPluginManager: (section?: 'installed' | 'store') => void
  onOpenBackgroundPluginManager?: () => void
  onOpenTaskScheduler?: () => void
  onOpenStorageExplorer?: () => void
  onOpenAiSettings?: () => void
  onNavigateTo?: (section: string) => void
  cardClass: string
  primaryPillClass: string
}

export default function DashboardSection({
  onOpenPluginManager,
  onOpenBackgroundPluginManager,
  onOpenTaskScheduler,
  onOpenStorageExplorer,
  onOpenAiSettings,
  onNavigateTo,
  cardClass
}: DashboardSectionProps) {
  const [stats, setStats] = useState<DashboardStats>({
    installedPlugins: 0,
    enabledPlugins: 0,
    backgroundPlugins: 0,
    scheduledTasks: 0,
    updatablePlugins: 0
  })
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [resourceUsage, setResourceUsage] = useState<AppResourceUsage | null>(null)
  const [updateState, setUpdateState] = useState<UpdateCenterState | null>(null)
  const [openclawStatus, setOpenclawStatus] = useState<NodeStatusInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const loadDashboardData = async () => {
      try {
        // 并行加载所有本地数据（不含网络请求）
        const [
          plugins,
          backgroundPlugins,
          taskCount,
          appInfoResult,
          updateCenterState,
          openclawStatusResult
        ] = await Promise.all([
          window.mulby.plugin.getAll().catch(() => [] as PluginInfo[]),
          window.mulby.plugin.listBackground().catch(() => [] as BackgroundPluginInfo[]),
          window.mulby.scheduler.getTaskCount().catch(() => 0),
          window.mulby.system.getAppInfo().catch(() => null),
          window.mulby.settings.getUpdateCenterState().catch(() => null),
          window.mulby.openclaw.getStatus().catch(() => null) as Promise<NodeStatusInfo | null>
        ])

        if (!mounted) return

        setStats({
          installedPlugins: plugins.length,
          enabledPlugins: plugins.filter((p) => p.enabled).length,
          backgroundPlugins: backgroundPlugins.length,
          scheduledTasks: taskCount,
          updatablePlugins: 0
        })
        setAppInfo(appInfoResult)
        setUpdateState(updateCenterState)
        setOpenclawStatus(openclawStatusResult)
      } finally {
        if (mounted) setLoading(false)
      }

      // 可更新插件数异步加载，不阻塞骨架屏消失
      try {
        const updateResult = await window.mulby.pluginStore.checkUpdatesInstalled()
        const count = (updateResult?.updates ?? []).filter((u) => u.status === 'updatable').length
        if (mounted) {
          setStats((prev) => ({ ...prev, updatablePlugins: count }))
        }
      } catch {
        // 网络不可用时忽略
      }
    }

    const loadResourceUsage = async () => {
      try {
        const resourceUsageResult = await window.mulby.system.getAppResourceUsage()
        if (mounted) setResourceUsage(resourceUsageResult)
      } catch {
        if (mounted) setResourceUsage(null)
      }
    }

    void loadDashboardData()
    void loadResourceUsage()

    const resourceUsageTimer = window.setInterval(() => {
      void loadResourceUsage()
    }, 5000)

    // 监听 OpenClaw 状态变化
    const unsubOpenClaw = window.mulby.openclaw.onStatusChanged((s: unknown) => {
      if (mounted) setOpenclawStatus(s as NodeStatusInfo)
    })

    return () => {
      mounted = false
      window.clearInterval(resourceUsageTimer)
      unsubOpenClaw()
    }
  }, [])

  // 快捷入口点击处理
  const handleEntryClick = (entryId: string) => {
    switch (entryId) {
      case 'plugin-manager':
        onOpenPluginManager('installed')
        break
      case 'plugin-store':
        onOpenPluginManager('store')
        break
      case 'ai-settings':
        onOpenAiSettings?.()
        break
      case 'background-plugins':
        onOpenBackgroundPluginManager?.()
        break
      case 'task-scheduler':
        onOpenTaskScheduler?.()
        break
      case 'storage-explorer':
        onOpenStorageExplorer?.()
        break
    }
  }

  // 格式化平台名称（支持 process.platform 和 navigator.platform 的值）
  const formatPlatform = (platform: string): string => {
    const lower = platform.toLowerCase()
    if (lower === 'darwin' || lower.startsWith('mac')) return 'macOS'
    if (lower === 'win32' || lower.startsWith('win')) return 'Windows'
    if (lower === 'linux' || lower.startsWith('linux')) return 'Linux'
    return platform
  }

  const formatBytes = (bytes?: number): string => {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '-'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex += 1
    }
    const precision = unitIndex === 0 || value >= 100 ? 0 : 1
    return `${value.toFixed(precision)} ${units[unitIndex]}`
  }

  const formatCpuPercent = (value?: number): string => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-'
    return `${value.toFixed(value >= 10 ? 0 : 1)}%`
  }

  const formatSampleTime = (timestamp?: number): string => {
    if (!timestamp) return '采集中'
    return `刷新于 ${new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })}`
  }

  // 骨架屏
  const Skeleton = ({ className = '' }: { className?: string }) => (
    <div className={`animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800 ${className}`} />
  )

  return (
    <div className="space-y-6">
      {/* 区域一：快捷入口网格 */}
      <div>
        <div className="mb-3 text-sm font-medium text-slate-500 dark:text-slate-400">快捷入口</div>
        <div className="grid grid-cols-3 gap-3">
          {QUICK_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              className={`${cardClass} group flex cursor-pointer flex-col items-center gap-2.5 py-5 transition-all hover:border-blue-400/60 hover:shadow-md hover:shadow-blue-500/5 dark:hover:border-blue-500/40 dark:hover:shadow-blue-500/10`}
              onClick={() => handleEntryClick(entry.id)}
            >
              <div className="text-slate-500 transition-colors group-hover:text-blue-500 dark:text-slate-400 dark:group-hover:text-blue-400">
                {entry.icon}
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{entry.label}</div>
                <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{entry.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 区域二：状态统计栏 */}
      <div>
        <div className="mb-3 text-sm font-medium text-slate-500 dark:text-slate-400">系统状态</div>
        <div className="grid grid-cols-4 gap-3">
          {/* 已安装插件 */}
          <div className={`${cardClass} flex flex-col items-center gap-1 py-4`}>
            <div className="text-slate-400 dark:text-slate-500">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">已安装</div>
            {loading ? (
              <Skeleton className="h-6 w-8" />
            ) : (
              <div className="text-xl font-semibold text-slate-800 dark:text-white">{stats.installedPlugins}</div>
            )}
          </div>

          {/* 运行中 */}
          <div className={`${cardClass} flex flex-col items-center gap-1 py-4`}>
            <div className="text-emerald-500">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9" />
              </svg>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">运行中</div>
            {loading ? (
              <Skeleton className="h-6 w-8" />
            ) : (
              <div className="flex items-center gap-1.5">
                {stats.backgroundPlugins > 0 && (
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                )}
                <span className="text-xl font-semibold text-slate-800 dark:text-white">{stats.backgroundPlugins}</span>
              </div>
            )}
          </div>

          {/* 定时任务 */}
          <div className={`${cardClass} flex flex-col items-center gap-1 py-4`}>
            <div className="text-slate-400 dark:text-slate-500">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">定时任务</div>
            {loading ? (
              <Skeleton className="h-6 w-8" />
            ) : (
              <div className="text-xl font-semibold text-slate-800 dark:text-white">{stats.scheduledTasks}</div>
            )}
          </div>

          {/* 可更新 */}
          <div className={`${cardClass} flex flex-col items-center gap-1 py-4`}>
            <div className={stats.updatablePlugins > 0 ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'}>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">可更新</div>
            {loading ? (
              <Skeleton className="h-6 w-8" />
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-semibold text-slate-800 dark:text-white">{stats.updatablePlugins}</span>
                {stats.updatablePlugins > 0 && (
                  <span className="rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white">NEW</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 区域 2.5：当前应用资源占用 */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">资源占用</span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {formatSampleTime(resourceUsage?.sampledAt)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3" aria-live="polite">
          <div className={`${cardClass} overflow-hidden p-4`}>
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500 dark:text-slate-400">CPU</div>
              <div className="rounded-full bg-amber-500/10 p-1.5 text-amber-600 dark:text-amber-400">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3M8.25 6h7.5A2.25 2.25 0 0 1 18 8.25v7.5A2.25 2.25 0 0 1 15.75 18h-7.5A2.25 2.25 0 0 1 6 15.75v-7.5A2.25 2.25 0 0 1 8.25 6Zm1.5 3.75h4.5v4.5h-4.5v-4.5Z" />
                </svg>
              </div>
            </div>
            {resourceUsage ? (
              <>
                <div className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">
                  {formatCpuPercent(resourceUsage.cpuPercent)}
                </div>
                <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  {resourceUsage.processCount} 个进程汇总
                </div>
              </>
            ) : (
              <Skeleton className="mt-4 h-8 w-20" />
            )}
          </div>

          <div className={`${cardClass} overflow-hidden p-4`}>
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500 dark:text-slate-400">内存</div>
              <div className="rounded-full bg-blue-500/10 p-1.5 text-blue-600 dark:text-blue-400">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 4.5h9A3 3 0 0 1 19.5 7.5v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3ZM9 9h6v6H9V9Zm-6 1.5h1.5m-1.5 3h1.5m15-3H21m-1.5 3H21M10.5 3v1.5m3-1.5v1.5m-3 15V21m3-1.5V21" />
                </svg>
              </div>
            </div>
            {resourceUsage ? (
              <>
                <div className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">
                  {formatBytes(resourceUsage.memoryBytes)}
                </div>
                <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  工作集内存
                </div>
              </>
            ) : (
              <Skeleton className="mt-4 h-8 w-24" />
            )}
          </div>

          <div className={`${cardClass} overflow-hidden p-4`}>
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500 dark:text-slate-400">硬盘</div>
              <div className="rounded-full bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12c0 2.486-4.03 4.5-9 4.5S3 14.486 3 12m18 0c0-2.486-4.03-4.5-9-4.5S3 9.514 3 12m18 0v4.5c0 2.486-4.03 4.5-9 4.5s-9-2.014-9-4.5V12m18 4.5c0 2.486-4.03 4.5-9 4.5s-9-2.014-9-4.5" />
                </svg>
              </div>
            </div>
            {resourceUsage ? (
              <>
                <div className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">
                  {formatBytes(resourceUsage.disk.userDataBytes)}
                </div>
                <div className="mt-1 truncate text-[11px] text-slate-400 dark:text-slate-500" title={resourceUsage.disk.userDataPath}>
                  应用数据目录
                </div>
              </>
            ) : (
              <Skeleton className="mt-4 h-8 w-24" />
            )}
          </div>
        </div>
      </div>

      {/* 区域 2.6：OpenClaw 连接状态 */}
      {openclawStatus && openclawStatus.status !== 'disconnected' && (
        <div>
          <div className="mb-3 text-sm font-medium text-slate-500 dark:text-slate-400">OpenClaw</div>
          <button
            className={`${cardClass} w-full cursor-pointer text-left transition-all hover:border-blue-400/60 hover:shadow-md hover:shadow-blue-500/5 dark:hover:border-blue-500/40`}
            onClick={() => onNavigateTo?.('openclaw')}
          >
            <div className="flex items-center gap-3">
              {/* 状态指示灯 */}
              <div className={`h-3 w-3 rounded-full ${
                openclawStatus.status === 'connected' ? 'bg-emerald-500' :
                openclawStatus.status === 'connecting' || openclawStatus.status === 'pairing' ? 'bg-amber-500 animate-pulse' :
                openclawStatus.status === 'error' ? 'bg-red-500' :
                'bg-slate-400'
              }`} />
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {openclawStatus.status === 'connected' ? '已连接到 Gateway' :
                   openclawStatus.status === 'connecting' ? '正在连接…' :
                   openclawStatus.status === 'pairing' ? '等待配对…' :
                   openclawStatus.status === 'error' ? '连接错误' : '未连接'}
                </div>
                <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                  {openclawStatus.gatewayHost && `${openclawStatus.gatewayHost}:${openclawStatus.gatewayPort}`}
                  {openclawStatus.connectedAt && ` · 已连接 ${Math.floor((Date.now() - openclawStatus.connectedAt) / 60000)} 分钟`}
                  {openclawStatus.error && ` · ${openclawStatus.error}`}
                </div>
              </div>
              {/* 箭头 */}
              <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </button>
        </div>
      )}

      {/* 区域三：环境信息 */}
      <div>
        <div className="mb-3 text-sm font-medium text-slate-500 dark:text-slate-400">环境信息</div>
        <div className={cardClass}>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-36" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">版本</span>
                <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                  {appInfo ? `v${appInfo.version}` : '-'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">平台</span>
                <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                  {formatPlatform(navigator.platform)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400">更新</span>
                {updateState ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {updateState.status === 'update-available' && updateState.hasUpdate ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                        <span className="text-blue-600 dark:text-blue-400">
                          v{updateState.latestVersion} 可用
                        </span>
                      </>
                    ) : updateState.status === 'up-to-date' ? (
                      <>
                        <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-emerald-600 dark:text-emerald-400">已是最新</span>
                      </>
                    ) : updateState.status === 'checking' ? (
                      <span className="text-slate-500 dark:text-slate-400">检查中…</span>
                    ) : updateState.status === 'error' ? (
                      <span className="text-amber-600 dark:text-amber-400">检查失败</span>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">未检查</span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
