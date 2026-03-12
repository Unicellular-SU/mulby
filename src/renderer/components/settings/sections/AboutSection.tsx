import type { UpdateCenterState } from '../../../../shared/types/electron'
import AboutIconGallery from './AboutIconGallery'
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
    <div className={`${cardClass} space-y-6 text-sm text-slate-600 dark:text-slate-300`}>
      <AboutIconGallery />

      <div className="space-y-2">
        <div className="font-medium text-slate-900 dark:text-white">应用信息</div>
        <div>名称：{appInfo?.name || '-'}</div>
        <div>版本：{updateCenterState?.currentVersion || appInfo?.version || '-'}</div>
        <div>最新版本：{updateCenterState?.latestVersion || '未检查'}</div>
        <div>更新状态：{formatUpdateStatus(updateCenterState?.status || 'idle')}</div>
        <div>最近检查：{formatCheckedAt(updateCenterState?.lastCheckedAt)}</div>
        <div className="break-all">发布页：{updateCenterState?.releasePageUrl || '未配置'}</div>
        <div className="break-all">数据目录：{appInfo?.userDataPath || '-'}</div>
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
        <button
          className={actionButtonClass}
          onClick={() => appInfo?.userDataPath && window.mulby.shell.openFolder(appInfo.userDataPath)}
        >
          打开数据目录
        </button>
      </div>
    </div>
  )
}
