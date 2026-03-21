import type { StartupOpenAtLoginState } from '../../../../shared/types/electron'
import type { AppSettings, SearchSettings, ShortcutStatusMap } from '../../../../shared/types/settings'
import { SHORTCUTS } from '../constants'
import ShortcutInput from '../ShortcutInput'

interface GeneralSectionProps {
  themeMode: 'light' | 'dark' | 'system'
  onThemeModeChange: (mode: 'light' | 'dark' | 'system') => Promise<void> | void
  openAtLoginState: StartupOpenAtLoginState
  startupBusy: boolean
  onToggleOpenAtLogin: () => Promise<void> | void
  searchSettings: SearchSettings
  onSearchSettingsChange: (patch: Partial<SearchSettings>) => Promise<void> | void
  settings: AppSettings | null
  shortcutStatus: ShortcutStatusMap | null
  onShortcutChange: (action: keyof AppSettings['shortcuts'], accelerator: string) => Promise<void> | void
  onRecordStart: () => Promise<void> | void
  onRecordEnd: () => Promise<void> | void
  cardClass: string
}

export default function GeneralSection({
  themeMode,
  onThemeModeChange,
  openAtLoginState,
  startupBusy,
  onToggleOpenAtLogin,
  searchSettings,
  onSearchSettingsChange,
  settings,
  shortcutStatus,
  onShortcutChange,
  onRecordStart,
  onRecordEnd,
  cardClass
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
            当前平台暂不支持开机自启动管理，仅支持 macOS 和 Windows。
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            状态：{openAtLoginState.enabled ? '已开启' : '已关闭'}
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

      <div className={`${cardClass} space-y-4`}>
        <div className="text-sm font-medium text-slate-900 dark:text-white">搜索设置</div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-700 dark:text-slate-200">搜索本机应用</div>
          </div>
          <button
            className={`relative h-6 w-11 rounded-full transition-colors ${searchSettings.enableApps
              ? 'bg-blue-500'
              : 'bg-gray-300 dark:bg-gray-600'
              }`}
            onClick={() => void onSearchSettingsChange({ enableApps: !searchSettings.enableApps })}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${searchSettings.enableApps ? 'translate-x-5' : ''}`}
            />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-700 dark:text-slate-200">搜索本机文件</div>
          </div>
          <button
            className={`relative h-6 w-11 rounded-full transition-colors ${searchSettings.enableFiles
              ? 'bg-blue-500'
              : 'bg-gray-300 dark:bg-gray-600'
              }`}
            onClick={() => void onSearchSettingsChange({ enableFiles: !searchSettings.enableFiles })}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${searchSettings.enableFiles ? 'translate-x-5' : ''}`}
            />
          </button>
        </div>
      </div>

      {settings && (
        <div className={`${cardClass} space-y-3`}>
          <div className="text-sm font-medium text-slate-900 dark:text-white">全局快捷键</div>
          {SHORTCUTS.map(item => (
            <ShortcutInput
              key={item.id}
              label={item.label}
              description={item.description}
              value={settings.shortcuts[item.id]}
              status={shortcutStatus?.[item.id]}
              onChange={(accelerator) => onShortcutChange(item.id, accelerator)}
              onRecordStart={onRecordStart}
              onRecordEnd={onRecordEnd}
            />
          ))}
        </div>
      )}
    </div>
  )
}
