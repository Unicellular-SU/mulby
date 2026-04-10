import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, CommandAuditItem, CommandRule } from '../../../../shared/types/settings'
import type { RuleDraft } from './security/types'
import CommandRules from './security/CommandRules'
import AuditPanel from './security/AuditPanel'

interface SecuritySectionProps {
  settings: AppSettings
  commandAudit: CommandAuditItem[]
  setCommandAudit: Dispatch<SetStateAction<CommandAuditItem[]>>
  allowRuleDraft: RuleDraft
  setAllowRuleDraft: Dispatch<SetStateAction<RuleDraft>>
  denyRuleDraft: RuleDraft
  setDenyRuleDraft: Dispatch<SetStateAction<RuleDraft>>
  reloadSettings: () => Promise<void>
  updateCommandRunner: (patch: Partial<AppSettings['commandRunner']>) => Promise<void>
  addCommandRule: (type: 'allowList' | 'denyList') => Promise<void>
  removeCommandRule: (type: 'allowList' | 'denyList', ruleId: string) => Promise<void>
  patchCommandRule: (type: 'allowList' | 'denyList', ruleId: string, patch: Partial<CommandRule>) => Promise<void>
  cardClass: string
  actionButtonClass: string
  pillClass: string
  primaryPillClass: string
}

export default function SecuritySection({
  settings,
  commandAudit,
  setCommandAudit,
  allowRuleDraft,
  setAllowRuleDraft,
  denyRuleDraft,
  setDenyRuleDraft,
  reloadSettings,
  updateCommandRunner,
  addCommandRule,
  removeCommandRule,
  patchCommandRule,
  cardClass,
  actionButtonClass,
  pillClass,
  primaryPillClass
}: SecuritySectionProps) {
  return (
<div className="space-y-5">
  <div className={`${cardClass} space-y-4`}>
    <div className="text-sm font-medium text-slate-900 dark:text-white">命令执行总开关</div>
    <div className="text-xs text-slate-500 dark:text-slate-400">
      这部分控制 `shell:runCommand` 的统一安全策略（独立于 Skill capability 授权层）。
    </div>
    <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800/80">
      <div>
        <div className="text-sm text-slate-900 dark:text-white">启用 runCommand</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">关闭后将拒绝所有命令执行请求</div>
      </div>
      <button
        className={`relative w-11 h-6 rounded-full transition-colors ${settings.commandRunner.enabled
          ? 'bg-blue-500'
          : 'bg-gray-300 dark:bg-gray-600'
          }`}
        onClick={() => void updateCommandRunner({ enabled: !settings.commandRunner.enabled })}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.commandRunner.enabled ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
    <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800/80">
      <div>
        <div className="text-sm text-slate-900 dark:text-white">首次启用确认</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">同一命令指纹首次执行时弹窗确认</div>
      </div>
      <button
        className={`relative w-11 h-6 rounded-full transition-colors ${settings.commandRunner.requireConsent
          ? 'bg-blue-500'
          : 'bg-gray-300 dark:bg-gray-600'
          }`}
        onClick={() => void updateCommandRunner({ requireConsent: !settings.commandRunner.requireConsent })}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.commandRunner.requireConsent ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm text-slate-900 dark:text-white">允许 shell=true</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">启用后可执行 shell 解析命令，风险更高</div>
      </div>
      <button
        className={`relative w-11 h-6 rounded-full transition-colors ${settings.commandRunner.allowShell
          ? 'bg-amber-500'
          : 'bg-gray-300 dark:bg-gray-600'
          }`}
        onClick={() => void updateCommandRunner({ allowShell: !settings.commandRunner.allowShell })}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.commandRunner.allowShell ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  </div>

  <div className={`${cardClass} space-y-4`}>
    <div className="text-sm font-medium text-slate-900 dark:text-white">执行限制</div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">默认超时（ms）</div>
        <input
          type="number"
          min={1000}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.commandRunner.defaultTimeoutMs}
          onChange={(e) => void updateCommandRunner({ defaultTimeoutMs: Number(e.target.value || 0) })}
        />
      </label>
      <label className="space-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">最大超时（ms）</div>
        <input
          type="number"
          min={1000}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.commandRunner.maxTimeoutMs}
          onChange={(e) => void updateCommandRunner({ maxTimeoutMs: Number(e.target.value || 0) })}
        />
      </label>
      <label className="space-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">最大输出（bytes）</div>
        <input
          type="number"
          min={8192}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.commandRunner.maxOutputBytes}
          onChange={(e) => void updateCommandRunner({ maxOutputBytes: Number(e.target.value || 0) })}
        />
      </label>
      <label className="space-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">最大并发</div>
        <input
          type="number"
          min={1}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.commandRunner.maxConcurrent}
          onChange={(e) => void updateCommandRunner({ maxConcurrent: Number(e.target.value || 0) })}
        />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">审计保留条数</div>
        <input
          type="number"
          min={50}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.commandRunner.audit.maxItems}
          onChange={(e) => void updateCommandRunner({
            audit: {
              ...settings.commandRunner.audit,
              maxItems: Number(e.target.value || 0)
            }
          })}
        />
      </label>
    </div>
  </div>

  <CommandRules
    settings={settings}
    allowRuleDraft={allowRuleDraft}
    setAllowRuleDraft={setAllowRuleDraft}
    denyRuleDraft={denyRuleDraft}
    setDenyRuleDraft={setDenyRuleDraft}
    addCommandRule={addCommandRule}
    removeCommandRule={removeCommandRule}
    patchCommandRule={patchCommandRule}
    cardClass={cardClass}
    actionButtonClass={actionButtonClass}
    pillClass={pillClass}
    primaryPillClass={primaryPillClass}
  />

  <AuditPanel
    settings={settings}
    commandAudit={commandAudit}
    setCommandAudit={setCommandAudit}
    reloadSettings={reloadSettings}
    cardClass={cardClass}
    actionButtonClass={actionButtonClass}
  />
</div>
  )
}
