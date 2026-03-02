import { PERMISSIONS } from '../constants'
import { formatPermissionStatus } from '../utils'

interface PermissionsSectionProps {
  permissionStatus: Record<string, string>
  cardClassTight: string
  actionButtonClass: string
}

export default function PermissionsSection({
  permissionStatus,
  cardClassTight,
  actionButtonClass
}: PermissionsSectionProps) {
  return (
    <div className="space-y-3">
      {PERMISSIONS.map(item => (
        <div
          key={item.id}
          className={`${cardClassTight} flex items-center justify-between gap-4`}
        >
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {formatPermissionStatus(permissionStatus[item.id])}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={actionButtonClass}
              onClick={() => window.mulby.permission.openSystemSettings(item.id)}
            >
              打开系统设置
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
