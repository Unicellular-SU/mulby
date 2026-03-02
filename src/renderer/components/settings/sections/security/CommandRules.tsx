import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, CommandRule } from '../../../../../shared/types/settings'
import UnifiedSelect from '../../../UnifiedSelect'
import type { RuleDraft } from './types'

interface CommandRulesProps {
  settings: AppSettings
  allowRuleDraft: RuleDraft
  setAllowRuleDraft: Dispatch<SetStateAction<RuleDraft>>
  denyRuleDraft: RuleDraft
  setDenyRuleDraft: Dispatch<SetStateAction<RuleDraft>>
  addCommandRule: (type: 'allowList' | 'denyList') => Promise<void>
  removeCommandRule: (type: 'allowList' | 'denyList', ruleId: string) => Promise<void>
  patchCommandRule: (type: 'allowList' | 'denyList', ruleId: string, patch: Partial<CommandRule>) => Promise<void>
  cardClass: string
  actionButtonClass: string
  pillClass: string
  primaryPillClass: string
}

export default function CommandRules({
  settings,
  allowRuleDraft,
  setAllowRuleDraft,
  denyRuleDraft,
  setDenyRuleDraft,
  addCommandRule,
  removeCommandRule,
  patchCommandRule,
  cardClass,
  actionButtonClass,
  pillClass,
  primaryPillClass
}: CommandRulesProps) {
  return (
    <>
      <div className={`${cardClass} space-y-4`}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-900 dark:text-white">白名单规则（allowList）</div>
          <span className="text-xs text-slate-500 dark:text-slate-400">{settings.commandRunner.allowList.length}</span>
        </div>
        <div className="space-y-2">
          {settings.commandRunner.allowList.map((rule) => (
            <div key={rule.id} className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70 sm:grid-cols-[110px_minmax(0,1fr)_80px_70px]">
              <UnifiedSelect
                className="rounded-xl px-2 py-1 pr-8 text-xs"
                value={rule.mode}
                onChange={(e) => void patchCommandRule('allowList', rule.id, { mode: e.target.value as 'exact' | 'prefix' })}
              >
                <option value="exact">exact（精确匹配）</option>
                <option value="prefix">prefix（前缀匹配）</option>
              </UnifiedSelect>
              <input
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                value={rule.value}
                onChange={(e) => void patchCommandRule('allowList', rule.id, { value: e.target.value })}
              />
              <button
                className={rule.enabled === false ? pillClass : primaryPillClass}
                onClick={() => void patchCommandRule('allowList', rule.id, { enabled: rule.enabled === false })}
              >
                {rule.enabled === false ? '启用' : '停用'}
              </button>
              <button className={actionButtonClass} onClick={() => void removeCommandRule('allowList', rule.id)}>删除</button>
            </div>
          ))}
          {settings.commandRunner.allowList.length === 0 && (
            <div className="text-xs text-slate-500 dark:text-slate-400">为空时表示不启用白名单强约束。</div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[110px_minmax(0,1fr)_100px]">
          <UnifiedSelect
            className="rounded-2xl px-3 py-2 pr-9 text-sm"
            value={allowRuleDraft.mode}
            onChange={(e) => setAllowRuleDraft((prev) => ({ ...prev, mode: e.target.value as 'exact' | 'prefix' }))}
          >
            <option value="exact">exact（精确匹配）</option>
            <option value="prefix">prefix（前缀匹配）</option>
          </UnifiedSelect>
          <input
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="命令或命令前缀（可包含参数）"
            value={allowRuleDraft.value}
            onChange={(e) => setAllowRuleDraft((prev) => ({ ...prev, value: e.target.value }))}
          />
          <button className={actionButtonClass} onClick={() => void addCommandRule('allowList')}>新增</button>
        </div>
      </div>

      <div className={`${cardClass} space-y-4`}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-900 dark:text-white">黑名单规则（denyList）</div>
          <span className="text-xs text-slate-500 dark:text-slate-400">{settings.commandRunner.denyList.length}</span>
        </div>
        <div className="space-y-2">
          {settings.commandRunner.denyList.map((rule) => (
            <div key={rule.id} className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70 sm:grid-cols-[110px_minmax(0,1fr)_80px_70px]">
              <UnifiedSelect
                className="rounded-xl px-2 py-1 pr-8 text-xs"
                value={rule.mode}
                onChange={(e) => void patchCommandRule('denyList', rule.id, { mode: e.target.value as 'exact' | 'prefix' })}
              >
                <option value="exact">exact（精确匹配）</option>
                <option value="prefix">prefix（前缀匹配）</option>
              </UnifiedSelect>
              <input
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                value={rule.value}
                onChange={(e) => void patchCommandRule('denyList', rule.id, { value: e.target.value })}
              />
              <button
                className={rule.enabled === false ? pillClass : primaryPillClass}
                onClick={() => void patchCommandRule('denyList', rule.id, { enabled: rule.enabled === false })}
              >
                {rule.enabled === false ? '启用' : '停用'}
              </button>
              <button className={actionButtonClass} onClick={() => void removeCommandRule('denyList', rule.id)}>删除</button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[110px_minmax(0,1fr)_100px]">
          <UnifiedSelect
            className="rounded-2xl px-3 py-2 pr-9 text-sm"
            value={denyRuleDraft.mode}
            onChange={(e) => setDenyRuleDraft((prev) => ({ ...prev, mode: e.target.value as 'exact' | 'prefix' }))}
          >
            <option value="exact">exact（精确匹配）</option>
            <option value="prefix">prefix（前缀匹配）</option>
          </UnifiedSelect>
          <input
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="命令或命令前缀（可包含参数）"
            value={denyRuleDraft.value}
            onChange={(e) => setDenyRuleDraft((prev) => ({ ...prev, value: e.target.value }))}
          />
          <button className={actionButtonClass} onClick={() => void addCommandRule('denyList')}>新增</button>
        </div>
      </div>
    </>
  )
}
