import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
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

function formatTrustMode(mode: string | undefined): string {
  return mode === 'commandLineExact' ? '完整命令' : '可执行文件'
}

function formatTrustSource(source: string, pluginId?: string): string {
  return source === 'plugin' ? `插件：${pluginId || 'unknown'}` : '主应用'
}

function formatAuditTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

export default function AuditPanel({
  settings,
  commandAudit,
  setCommandAudit,
  reloadSettings,
  cardClass,
  actionButtonClass
}: AuditPanelProps) {
  const [trustedQuery, setTrustedQuery] = useState('')
  const [trustedMode, setTrustedMode] = useState<'all' | 'executable' | 'commandLineExact'>('all')
  const [trustedSource, setTrustedSource] = useState<'all' | 'app' | 'plugin'>('all')
  const trustedRecords = settings.commandRunner.trustedFingerprints
  const auditRecords = commandAudit.length > 0 ? commandAudit : [...settings.commandRunner.audit.records].reverse()
  const filteredTrustedRecords = useMemo(() => {
    const query = trustedQuery.trim().toLowerCase()
    return trustedRecords
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const mode = item.matchMode || 'executable'
        if (trustedMode !== 'all' && mode !== trustedMode) return false
        if (trustedSource !== 'all' && item.source !== trustedSource) return false
        if (!query) return true
        return [
          item.prefix,
          item.command,
          ...(item.args || []),
          item.source,
          item.pluginId || '',
          formatTrustMode(mode)
        ].some((value) => String(value || '').toLowerCase().includes(query))
      })
  }, [trustedMode, trustedQuery, trustedRecords, trustedSource])

  const removeTrustedRecord = async (index: number) => {
    if (!window.mulby?.shell?.updateRunCommandPolicy) return
    const nextTrusted = trustedRecords.filter((_, itemIndex) => itemIndex !== index)
    await window.mulby.shell.updateRunCommandPolicy({ trustedFingerprints: nextTrusted })
    await reloadSettings()
  }

  return (
    <div className={`${cardClass} space-y-4`}>
      <div>
        <div className="text-sm font-medium text-slate-900 dark:text-white">信任与审计</div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">管理命令免确认范围，并查看命令执行历史。</div>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">已信任命令</div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              共 {trustedRecords.length} 条
              {filteredTrustedRecords.length !== trustedRecords.length && `，当前显示 ${filteredTrustedRecords.length} 条`}
            </div>
          </div>
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
        </div>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_132px_120px]">
          <input
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-slate-600"
            placeholder="搜索命令、来源或插件"
            value={trustedQuery}
            onChange={(event) => setTrustedQuery(event.target.value)}
          />
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-slate-600"
            value={trustedMode}
            onChange={(event) => setTrustedMode(event.target.value as typeof trustedMode)}
          >
            <option value="all">全部范围</option>
            <option value="executable">可执行文件</option>
            <option value="commandLineExact">完整命令</option>
          </select>
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-slate-600"
            value={trustedSource}
            onChange={(event) => setTrustedSource(event.target.value as typeof trustedSource)}
          >
            <option value="all">全部来源</option>
            <option value="app">主应用</option>
            <option value="plugin">插件</option>
          </select>
        </div>
        {trustedRecords.length > 0 ? (
          <div className="max-h-56 overflow-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
            {filteredTrustedRecords.length > 0 ? (
              <div className="divide-y divide-slate-200/80 dark:divide-slate-800">
                {filteredTrustedRecords.map(({ item, index }) => (
                  <div
                    key={`${index}:${item.source}:${item.pluginId || 'app'}:${item.matchMode || 'executable'}:${item.prefix}`}
                    className="grid grid-cols-1 gap-2 bg-white/60 px-3 py-2 text-xs dark:bg-slate-950/50 sm:grid-cols-[88px_minmax(0,1fr)_132px_64px] sm:items-center"
                  >
                    <span className="w-fit rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      {formatTrustMode(item.matchMode)}
                    </span>
                    <div className="min-w-0">
                      <code className="block truncate font-mono text-[11px] text-slate-800 dark:text-slate-100" title={item.prefix}>
                        {item.prefix}
                      </code>
                      {item.command && item.command !== item.prefix && (
                        <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500" title={[item.command, ...(item.args || [])].join(' ')}>
                          {[item.command, ...(item.args || [])].join(' ')}
                        </div>
                      )}
                    </div>
                    <span className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={formatTrustSource(item.source, item.pluginId)}>
                      {formatTrustSource(item.source, item.pluginId)}
                    </span>
                    <button className={actionButtonClass} onClick={() => void removeTrustedRecord(index)}>删除</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-4 text-xs text-slate-500 dark:text-slate-400">没有匹配的信任记录</div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-500 dark:text-slate-400">暂无已信任命令</div>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">审计记录</div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{auditRecords.length} 条</div>
          </div>
          <div className="flex items-center gap-2">
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
        <div className="max-h-72 space-y-2 overflow-auto">
          {auditRecords.slice(0, 100).map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-slate-800 dark:text-slate-100" title={[item.command, ...(item.args || [])].join(' ')}>
                  {item.command}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 ${item.status === 'allowed'
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
              <div className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 sm:grid-cols-[150px_minmax(0,1fr)_88px_88px]">
                <span>时间：{formatAuditTime(item.timestamp)}</span>
                <span className="truncate" title={formatTrustSource(item.source, item.pluginId)}>来源：{formatTrustSource(item.source, item.pluginId)}</span>
                <span>退出码：{item.exitCode ?? 'null'}</span>
                <span>耗时：{item.durationMs || 0}ms</span>
              </div>
              {item.reason && (
                <div className="mt-1 text-[11px] text-red-500 dark:text-red-300">{item.reason}</div>
              )}
            </div>
          ))}
          {auditRecords.length === 0 && (
            <div className="text-xs text-slate-500 dark:text-slate-400">暂无审计记录</div>
          )}
        </div>
      </section>
    </div>
  )
}
