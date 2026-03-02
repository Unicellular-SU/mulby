import type { StartupOpenAtLoginState } from '../../../../shared/types/electron'

interface GeneralSectionProps {
  themeMode: 'light' | 'dark' | 'system'
  onThemeModeChange: (mode: 'light' | 'dark' | 'system') => Promise<void> | void
  openAtLoginState: StartupOpenAtLoginState
  startupBusy: boolean
  onToggleOpenAtLogin: () => Promise<void> | void
  onOpenAiSettings?: () => void
  onOpenPluginManager: (section?: 'installed' | 'store') => void
  onOpenBackgroundPluginManager?: () => void
  onOpenTaskScheduler?: () => void
  cardClass: string
  primaryPillClass: string
}

export default function GeneralSection({
  themeMode,
  onThemeModeChange,
  openAtLoginState,
  startupBusy,
  onToggleOpenAtLogin,
  onOpenAiSettings,
  onOpenPluginManager,
  onOpenBackgroundPluginManager,
  onOpenTaskScheduler,
  cardClass,
  primaryPillClass
}: GeneralSectionProps) {
  return (
    <div className="space-y-4">
      <div className={`${cardClass} space-y-4`}>
        <div className="text-sm font-medium text-slate-900 dark:text-white">主题模式</div>
        <div className="flex flex-wrap gap-3">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <button
              key={mode}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${themeMode === mode
                ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                }`}
              onClick={() => void onThemeModeChange(mode)}
            >
              {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}
            </button>
          ))}
        </div>
      </div>
      <div className={`${cardClass} space-y-4`}>
        <div className="text-sm font-medium text-slate-900 dark:text-white">开机自启动</div>
        {!openAtLoginState.supported && (
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            当前平台暂不支持开机自启动管理（仅支持 macOS / Windows）。
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              状态：{openAtLoginState.enabled ? '已开启' : '已关闭'}
            </div>
          </div>
          <button
            disabled={!openAtLoginState.supported || startupBusy}
            className={`relative h-6 w-11 rounded-full transition-colors ${openAtLoginState.enabled
              ? 'bg-blue-500'
              : 'bg-gray-300 dark:bg-gray-600'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={() => void onToggleOpenAtLogin()}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${openAtLoginState.enabled ? 'translate-x-5' : ''}`}
            />
          </button>
        </div>
      </div>
      {onOpenAiSettings && (
        <div className={`${cardClass} flex items-center justify-between gap-4`}>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">AI 设置中心</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">配置 Provider、模型与默认策略</div>
          </div>
          <button className={primaryPillClass} onClick={onOpenAiSettings}>
            打开 AI 设置
          </button>
        </div>
      )}
      <div className={`${cardClass} flex items-center justify-between gap-4`}>
        <div>
          <div className="text-sm font-medium text-slate-900 dark:text-white">插件管理</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">管理插件启用状态、更新与卸载</div>
        </div>
        <button className={primaryPillClass} onClick={() => onOpenPluginManager('installed')}>
          打开插件管理
        </button>
      </div>
      {onOpenBackgroundPluginManager && (
        <div className={`${cardClass} flex items-center justify-between gap-4`}>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">运行中的插件</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">查看和管理所有正在运行的插件</div>
          </div>
          <button className={primaryPillClass} onClick={onOpenBackgroundPluginManager}>
            打开任务管理器
          </button>
        </div>
      )}
      {onOpenTaskScheduler && (
        <div className={`${cardClass} flex items-center justify-between gap-4`}>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">任务调度器</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">查看和管理所有定时任务</div>
          </div>
          <button className={primaryPillClass} onClick={onOpenTaskScheduler}>
            打开任务调度器
          </button>
        </div>
      )}
    </div>
  )
}
