import type { UpdateCenterState } from '../../../../shared/types/electron'
import { formatCheckedAt, formatUpdateStatus } from '../utils'

interface AboutSectionProps {
  appInfo: { name: string; version: string; userDataPath: string } | null
  updateCenterState: UpdateCenterState | null
  updateBusy: boolean
  onCheckAppUpdates: () => Promise<void> | void
  onOpenUpdateReleasePage: () => Promise<void> | void
  cardClass: string
  primaryPillClass: string
  actionButtonClass: string
}

export default function AboutSection({
  appInfo,
  updateCenterState,
  updateBusy,
  onCheckAppUpdates,
  onOpenUpdateReleasePage,
  cardClass,
  primaryPillClass,
  actionButtonClass
}: AboutSectionProps) {
  return (
    <div className={`${cardClass} space-y-4 text-sm text-slate-600 dark:text-slate-300`}>
      <div>
        <div className="font-medium text-slate-900 dark:text-white">应用信息</div>
        <div>名称：{appInfo?.name}</div>
        <div>版本：{updateCenterState?.currentVersion || appInfo?.version}</div>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium text-slate-900 dark:text-white">更新中心</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              手动检查新版本并跳转发布页下载安装包。
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs ${updateCenterState?.status === 'update-available'
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
            : updateCenterState?.status === 'error'
              ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}>
            {formatUpdateStatus(updateCenterState?.status || 'idle')}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
            <div className="text-slate-500 dark:text-slate-400">当前版本</div>
            <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
              {updateCenterState?.currentVersion || appInfo?.version || '-'}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
            <div className="text-slate-500 dark:text-slate-400">最新版本</div>
            <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
              {updateCenterState?.latestVersion || '未检查'}
            </div>
          </div>
        </div>
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <div>最近检查：{formatCheckedAt(updateCenterState?.lastCheckedAt)}</div>
          <div className="break-all">发布页：{updateCenterState?.releasePageUrl || '未配置'}</div>
          {updateCenterState?.message && (
            <div>{updateCenterState.message}</div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={primaryPillClass}
            disabled={updateBusy}
            onClick={() => void onCheckAppUpdates()}
          >
            {updateBusy ? '检查中...' : '检查更新'}
          </button>
          <button
            className={actionButtonClass}
            disabled={!updateCenterState?.releasePageUrl}
            onClick={() => void onOpenUpdateReleasePage()}
          >
            打开发布页
          </button>
        </div>
      </div>
      <div>
        <div className="font-medium text-slate-900 dark:text-white">数据目录</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 break-all">{appInfo?.userDataPath}</div>
      </div>
      <button
        className={actionButtonClass}
        onClick={() => appInfo?.userDataPath && window.mulby.shell.openFolder(appInfo.userDataPath)}
      >
        打开数据目录
      </button>
    </div>
  )
}
