import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, CommandAuditItem } from '../../../../../shared/types/settings'
import { formatCommandAuditStatus } from '../../utils'

interface AuditPanelProps {
  settings: AppSettings
  commandAudit: CommandAuditItem[]
  setCommandAudit: Dispatch<SetStateAction<CommandAuditItem[]>>
  reloadSettings: () => Promise<void>
  cardClass: string
  actionButtonClass: string
}

export default function AuditPanel({
  settings,
  commandAudit,
  setCommandAudit,
  reloadSettings,
  cardClass,
  actionButtonClass
}: AuditPanelProps) {
  return (
    <div className={`${cardClass} space-y-4`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-900 dark:text-white">信任与审计</div>
        <div className="flex items-center gap-2">
          <button
            className={actionButtonClass}
            onClick={async () => {
              if (!window.mulby?.shell?.clearRunCommandTrusted) return
              await window.mulby.shell.clearRunCommandTrusted()
              await reloadSettings()
            }}
          >
            清空已信任命令
          </button>
          <button
            className={actionButtonClass}
            onClick={async () => {
              if (!window.mulby?.shell?.clearRunCommandAudit) return
              await window.mulby.shell.clearRunCommandAudit()
              await reloadSettings()
              setCommandAudit([])
            }}
          >
            清空审计
          </button>
          <button
            className={actionButtonClass}
            onClick={async () => {
              if (!window.mulby?.shell?.listRunCommandAudit) return
              const records = await window.mulby.shell.listRunCommandAudit(100)
              setCommandAudit(records)
            }}
          >
            刷新
          </button>
        </div>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        已信任命令前缀：{settings.commandRunner.trustedFingerprints.length} 条
        {settings.commandRunner.trustedFingerprints.length > 0 && (
          <span className="ml-1">
            ({settings.commandRunner.trustedFingerprints.map((item) => item.prefix).join(', ')})
          </span>
        )}
      </div>
      <div className="max-h-72 space-y-2 overflow-auto">
        {(commandAudit.length > 0 ? commandAudit : [...settings.commandRunner.audit.records].reverse()).slice(0, 100).map((item) => (
          <div key={item.id} className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800 dark:text-slate-100">{item.command}</span>
              <span className={`rounded-full px-2 py-0.5 ${item.status === 'allowed'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : item.status === 'blocked'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  : item.status === 'timeout'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                }`}>
                {formatCommandAuditStatus(item.status)}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {item.source === 'plugin' ? `插件: ${item.pluginId || 'unknown'}` : '来源: 应用'}
              {' | 退出码: '}
              {item.exitCode ?? 'null'}
              {' | 耗时: '}
              {item.durationMs || 0}
              ms
            </div>
            {item.reason && (
              <div className="mt-1 text-[11px] text-red-500 dark:text-red-300">{item.reason}</div>
            )}
          </div>
        ))}
        {(commandAudit.length === 0 && settings.commandRunner.audit.records.length === 0) && (
          <div className="text-xs text-slate-500 dark:text-slate-400">暂无审计记录</div>
        )}
      </div>
    </div>
  )
}
