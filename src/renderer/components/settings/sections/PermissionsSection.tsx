import { useState, useMemo, useCallback } from 'react'
import { PERMISSIONS } from '../constants'
import { formatPermissionStatus } from '../utils'

interface PermissionsSectionProps {
  permissionStatus: Record<string, string>
  cardClassTight: string
  actionButtonClass: string
  onRefresh?: () => void
}

/** 当前平台名 */
const PLATFORM: 'darwin' | 'win32' | 'linux' =
  navigator.userAgent.includes('Macintosh') ? 'darwin'
    : navigator.userAgent.includes('Windows') ? 'win32'
      : 'linux'

/** 平台中文标签 */
const PLATFORM_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

/** 重要性标签样式 */
function ImportanceBadge({ importance }: { importance: 'required' | 'recommended' | 'optional' }) {
  const config = {
    required: { text: '必需', bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    recommended: { text: '推荐', bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    optional: { text: '可选', bg: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' }
  }
  const { text, bg } = config[importance]
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${bg}`}>{text}</span>
}

/** 权限状态指示器 */
function StatusIndicator({ status }: { status: string }) {
  const isGranted = status === 'granted' || status === 'authorized'
  const isDenied = status === 'denied' || status === 'restricted'
  const color = isGranted
    ? 'bg-emerald-500'
    : isDenied
      ? 'bg-red-500'
      : 'bg-amber-400'

  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2 w-2 rounded-full ${color}`} />
      <span className={`text-xs font-medium ${isGranted
        ? 'text-emerald-600 dark:text-emerald-400'
        : isDenied
          ? 'text-red-600 dark:text-red-400'
          : 'text-amber-600 dark:text-amber-400'
      }`}>
        {formatPermissionStatus(status)}
      </span>
    </div>
  )
}

export default function PermissionsSection({
  permissionStatus,
  cardClassTight,
  actionButtonClass,
  onRefresh
}: PermissionsSectionProps) {
  const [requesting, setRequesting] = useState<string | null>(null)

  // 过滤出当前平台适用的权限项
  const filteredPermissions = useMemo(
    () => PERMISSIONS.filter(item => !item.platforms || item.platforms.includes(PLATFORM)),
    []
  )

  // 请求权限
  const handleRequest = useCallback(async (id: typeof PERMISSIONS[number]['id']) => {
    setRequesting(id)
    try {
      await window.mulby.permission.request(id)
    } catch {
      // 忽略请求失败
    } finally {
      setRequesting(null)
      // 刷新父组件的权限状态
      onRefresh?.()
    }
  }, [onRefresh])

  // 统计
  const grantedCount = filteredPermissions.filter(
    item => permissionStatus[item.id] === 'granted' || permissionStatus[item.id] === 'authorized'
  ).length
  const totalCount = filteredPermissions.length

  return (
    <div className="space-y-5">
      {/* 平台信息与总览 */}
      <div className={`${cardClassTight} flex items-center justify-between`}>
        <div>
          <div className="text-sm font-medium text-slate-900 dark:text-white">
            系统权限 · {PLATFORM_LABEL[PLATFORM]}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            已授权 {grantedCount}/{totalCount} 项
            {PLATFORM === 'win32' && ' · Windows 下大部分权限由系统自动管理'}
            {PLATFORM === 'linux' && ' · Linux 下权限取决于桌面环境和发行版配置'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`h-2.5 w-20 rounded-full overflow-hidden ${
              grantedCount === totalCount
                ? 'bg-emerald-100 dark:bg-emerald-900/30'
                : 'bg-slate-100 dark:bg-slate-800'
            }`}
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                grantedCount === totalCount
                  ? 'bg-emerald-500'
                  : grantedCount > 0
                    ? 'bg-amber-400'
                    : 'bg-slate-300 dark:bg-slate-600'
              }`}
              style={{ width: `${totalCount > 0 ? (grantedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* 权限列表 */}
      <div className="space-y-2.5">
        {filteredPermissions.map(item => {
          const status = permissionStatus[item.id] || 'unknown'
          const isGranted = status === 'granted' || status === 'authorized'
          const canRequest = item.canRequestProgrammatically && !isGranted
          const isThisRequesting = requesting === item.id

          return (
            <div
              key={item.id}
              className={`${cardClassTight} flex items-center justify-between gap-4 transition-colors ${
                isGranted
                  ? 'border-emerald-200/50 dark:border-emerald-800/30'
                  : item.importance === 'required'
                    ? 'border-red-200/50 dark:border-red-800/30'
                    : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    {item.label}
                  </span>
                  <ImportanceBadge importance={item.importance} />
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  {item.description}
                </div>
                <div className="mt-1.5">
                  <StatusIndicator status={status} />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canRequest && (
                  <button
                    className={`${actionButtonClass} ${isThisRequesting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={isThisRequesting}
                    onClick={() => handleRequest(item.id)}
                  >
                    {isThisRequesting ? '请求中...' : '请求权限'}
                  </button>
                )}
                <button
                  className={actionButtonClass}
                  onClick={() => window.mulby.permission.openSystemSettings(item.id)}
                >
                  {PLATFORM === 'darwin' ? '打开系统设置' : PLATFORM === 'win32' ? '打开设置' : '手动配置'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 平台特定说明 */}
      {PLATFORM === 'darwin' && (
        <div className={`${cardClassTight} border-blue-200/50 dark:border-blue-800/30`}>
          <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            <span className="font-medium text-slate-700 dark:text-slate-300">提示：</span>
            「辅助功能」权限是 Mulby 的核心依赖，用于全局快捷键监听和原生文本选取。
            首次授权后如更新或重装应用，可能需要在「系统设置 → 隐私与安全性 → 辅助功能」中重新勾选 Mulby。
          </div>
        </div>
      )}
    </div>
  )
}
