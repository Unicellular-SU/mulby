import type { UpdateCenterState } from '../../../../shared/types/electron'
import AboutIconGallery from './AboutIconGallery'
import { formatCheckedAt, formatUpdateStatus } from '../utils'

interface AboutSectionProps {
  appInfo: { name: string; version: string; userDataPath: string } | null
  updateCenterState: UpdateCenterState | null
  updateBusy: boolean
  onCheckAppUpdates: () => Promise<void> | void
  onOpenUpdateReleasePage: () => Promise<void> | void
  onDownloadUpdate: () => Promise<void> | void
  onInstallUpdate: () => void
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
  onDownloadUpdate,
  onInstallUpdate,
  cardClass,
  primaryPillClass,
  actionButtonClass
}: AboutSectionProps) {
  const status = updateCenterState?.status || 'idle'
  const progress = updateCenterState?.downloadProgress

  return (
    <div className={`${cardClass} space-y-6 text-sm text-slate-600 dark:text-slate-300`}>
      <AboutIconGallery />

      <div className="space-y-2">
        <div className="font-medium text-slate-900 dark:text-white">应用信息</div>
        <div>名称：{appInfo?.name || '-'}</div>
        <div>版本：{updateCenterState?.currentVersion || appInfo?.version || '-'}</div>
        <div>最新版本：{updateCenterState?.latestVersion || '未检查'}</div>
        <div>更新状态：{formatUpdateStatus(status)}</div>
        <div>最近检查：{formatCheckedAt(updateCenterState?.lastCheckedAt)}</div>
        <div className="break-all">发布页：{updateCenterState?.releasePageUrl || '未配置'}</div>
        <div className="break-all">数据目录：{appInfo?.userDataPath || '-'}</div>
        {updateCenterState?.message && (
          <div>{updateCenterState.message}</div>
        )}
      </div>

      {/* 下载进度条 */}
      {status === 'downloading' && progress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span>下载中...</span>
            <span>{Math.round(progress.percent)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.min(100, progress.percent)}%` }}
            />
          </div>
          {progress.bytesPerSecond > 0 && (
            <div className="text-xs text-slate-400">
              {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
              {' · '}
              {formatBytes(progress.bytesPerSecond)}/s
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* 根据状态显示不同的主操作按钮 */}
        {status === 'downloaded' ? (
          <button
            className={primaryPillClass}
            onClick={() => onInstallUpdate()}
          >
            安装并重启
          </button>
        ) : status === 'update-available' ? (
          <button
            className={primaryPillClass}
            disabled={updateBusy}
            onClick={() => void onDownloadUpdate()}
          >
            {updateBusy ? '准备中...' : '下载更新'}
          </button>
        ) : status === 'downloading' ? (
          <button
            className={primaryPillClass}
            disabled
          >
            下载中...
          </button>
        ) : (
          <button
            className={primaryPillClass}
            disabled={updateBusy || status === 'checking'}
            onClick={() => void onCheckAppUpdates()}
          >
            {updateBusy || status === 'checking' ? '检查中...' : '检查更新'}
          </button>
        )}
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

/** 格式化字节数 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
