import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings } from '../../../../shared/types/settings'

interface DeveloperSectionProps {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings | null>>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  notice: {
    success: (message: string) => void
    error: (message: string) => void
  }
  onOpenLogViewer?: () => void
  cardClass: string
  actionButtonClass: string
  pillClass: string
  primaryPillClass: string
}

export default function DeveloperSection({
  settings,
  setSettings,
  updateSettings,
  notice,
  onOpenLogViewer,
  cardClass,
  actionButtonClass,
  pillClass,
  primaryPillClass
}: DeveloperSectionProps) {
  return (
<div className="space-y-5">
  {/* 开发者模式开关 */}
  <div className={`${cardClass} space-y-4`}>
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium text-slate-900 dark:text-white">
          启用开发者模式
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          开启后可从外部目录加载开发中的插件
        </div>
      </div>
      <button
        className={`relative w-11 h-6 rounded-full transition-colors ${settings.developer.enabled
          ? 'bg-blue-500'
          : 'bg-gray-300 dark:bg-gray-600'
          }`}
        onClick={() => {
          updateSettings({
            developer: {
              ...settings.developer,
              enabled: !settings.developer.enabled
            }
          })
        }}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.developer.enabled ? 'translate-x-5' : ''
            }`}
        />
      </button>
    </div>
  </div>

  {/* 插件开发目录 */}
  {settings.developer.enabled && (
    <div className={`${cardClass} space-y-4`}>
      <div className="text-sm font-medium text-slate-900 dark:text-white">
        插件开发目录
      </div>

      {settings.developer.pluginPaths.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">
          还没有添加任何开发目录。
        </div>
      ) : (
        <div className="space-y-2">
          {settings.developer.pluginPaths.map((path) => (
            <div
              key={path}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            >
              <div className="truncate flex-1">
                {path}
              </div>
              <button
                className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                onClick={async () => {
                  await window.mulby.developer.removePluginPath(path)
                  const result = await window.mulby.settings.get()
                  setSettings(result.settings)
                }}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          className={actionButtonClass}
          onClick={async () => {
            const path = await window.mulby.developer.selectDirectory()
            if (path) {
              const result = await window.mulby.developer.addPluginPath(path)
              if (result.success) {
                const settingsResult = await window.mulby.settings.get()
                setSettings(settingsResult.settings)
              } else {
                notice.error(result.error || '添加失败')
              }
            }
          }}
        >
          + 添加目录
        </button>
        <button
          className={actionButtonClass}
          onClick={async () => {
            await window.mulby.developer.reloadPlugins()
            notice.success('插件已刷新')
          }}
        >
          刷新插件
        </button>
      </div>
    </div>
  )}

  {/* 调试选项 */}
  {settings.developer.enabled && (
    <div className={`${cardClass} space-y-4`}>
      <div className="text-sm font-medium text-slate-900 dark:text-white">
        调试选项
      </div>

      {/* 自动热重载 */}
      <div className="flex items-center justify-between border-b border-slate-200/80 py-2 dark:border-slate-800/80">
        <div>
          <div className="text-sm text-slate-900 dark:text-white">
            自动热重载
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            检测文件变化时自动重新加载插件
          </div>
        </div>
        <button
          className={`relative w-11 h-6 rounded-full transition-colors ${settings.developer.autoReload
            ? 'bg-blue-500'
            : 'bg-gray-300 dark:bg-gray-600'
            }`}
          onClick={() => {
            updateSettings({
              developer: {
                ...settings.developer,
                autoReload: !settings.developer.autoReload
              }
            })
          }}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.developer.autoReload ? 'translate-x-5' : ''
              }`}
          />
        </button>
      </div>

      {/* 自动打开 DevTools */}
      <div className="flex items-center justify-between border-b border-slate-200/80 py-2 dark:border-slate-800/80">
        <div>
          <div className="text-sm text-slate-900 dark:text-white">
            自动打开开发者工具
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            打开插件窗口时自动打开 DevTools
          </div>
        </div>
        <button
          className={`relative w-11 h-6 rounded-full transition-colors ${settings.developer.showDevTools
            ? 'bg-blue-500'
            : 'bg-gray-300 dark:bg-gray-600'
            }`}
          onClick={() => {
            updateSettings({
              developer: {
                ...settings.developer,
                showDevTools: !settings.developer.showDevTools
              }
            })
          }}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.developer.showDevTools ? 'translate-x-5' : ''
              }`}
          />
        </button>
      </div>

      {/* 日志级别 */}
      <div className="py-2">
        <div className="mb-2 text-sm text-slate-900 dark:text-white">
          日志级别
        </div>
        <div className="flex flex-wrap gap-2">
          {(['debug', 'info', 'warn', 'error'] as const).map((level) => (
            <button
              key={level}
              className={settings.developer.logLevel === level ? primaryPillClass : pillClass}
              onClick={() => {
                updateSettings({
                  developer: {
                    ...settings.developer,
                    logLevel: level
                  }
                })
              }}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )}

  {/* 日志查看器入口 */}
  {settings.developer.enabled && onOpenLogViewer && (
    <div className={`${cardClass}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-900 dark:text-white">
            开发者日志
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            查看插件日志和崩溃报告
          </div>
        </div>
        <button
          className={primaryPillClass}
          onClick={onOpenLogViewer}
        >
          打开日志查看器
        </button>
      </div>
    </div>
  )}

  {/* 提示信息 */}
  <div className={`${cardClass} space-y-2 text-sm text-slate-600 dark:text-slate-300`}>
    <div className="font-medium text-slate-900 dark:text-white">使用提示</div>
    <ul className="list-disc list-inside text-xs space-y-1">
      <li>添加的开发目录应该包含插件文件夹（每个文件夹包含 manifest.json）</li>
      <li>开发目录的插件将显示「开发中」标记</li>
      <li>修改插件代码后，点击「刷新插件」或重启应用</li>
      <li>使用 <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">npm run dev</code> 启动 Vite 开发服务器支持 UI 热重载</li>
    </ul>
  </div>
</div>
  )
}
