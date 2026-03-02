import type { Dispatch, SetStateAction } from 'react'
import type { AiToolCapabilityGrant, AppSettings } from '../../../../../shared/types/settings'
import UnifiedSelect from '../../../UnifiedSelect'
import { TOOL_CAPABILITY_OPTIONS } from '../../constants'
import { formatCapabilityLabel, toDateTimeLocalValue } from '../../utils'
import type { GrantDraft } from './types'

interface CapabilityPolicyProps {
  settings: AppSettings
  visibleCapabilityGrants: AiToolCapabilityGrant[]
  isDefaultAppCapabilitiesAtDefault: boolean
  appCapabilityDraft: string
  setAppCapabilityDraft: Dispatch<SetStateAction<string>>
  grantDraft: GrantDraft
  setGrantDraft: Dispatch<SetStateAction<GrantDraft>>
  restoreDefaultAppCapabilities: () => Promise<void>
  removeCapabilityFromPolicyList: (key: 'defaultAppCapabilities', capability: string) => Promise<void>
  addCapabilityToPolicyList: (key: 'defaultAppCapabilities', draft: string, reset: () => void) => Promise<void>
  addCapabilityGrant: () => Promise<void>
  removeCapabilityGrant: (grantId: string) => Promise<void>
  patchCapabilityGrant: (grantId: string, patch: Partial<AiToolCapabilityGrant>) => Promise<void>
  cardClass: string
  actionButtonClass: string
  pillClass: string
}

export default function CapabilityPolicy({
  settings,
  visibleCapabilityGrants,
  isDefaultAppCapabilitiesAtDefault,
  appCapabilityDraft,
  setAppCapabilityDraft,
  grantDraft,
  setGrantDraft,
  restoreDefaultAppCapabilities,
  removeCapabilityFromPolicyList,
  addCapabilityToPolicyList,
  addCapabilityGrant,
  removeCapabilityGrant,
  patchCapabilityGrant,
  cardClass,
  actionButtonClass,
  pillClass
}: CapabilityPolicyProps) {
  return (
    <div className={`${cardClass} space-y-4`}>
      <div className="space-y-1">
        <div className="text-sm font-medium text-slate-900 dark:text-white">能力授权策略（Capability Policy）</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          工具能力属于 AI 全局底层能力，优先级：会话策略 &gt; grant &gt; 默认能力。
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200">defaultAppCapabilities（AI 全局默认能力）</div>
          <button
            className={actionButtonClass}
            disabled={isDefaultAppCapabilitiesAtDefault}
            onClick={() => void restoreDefaultAppCapabilities()}
          >
            恢复默认能力
          </button>
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          {(settings.aiTooling.capabilityPolicy.defaultAppCapabilities || []).map((item) => (
            <button
              key={`default-app-cap-${item}`}
              className={pillClass}
              onClick={() => void removeCapabilityFromPolicyList('defaultAppCapabilities', item)}
              title="点击删除"
            >
              {formatCapabilityLabel(item)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
          <input
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="输入 capability，支持逗号或换行批量"
            value={appCapabilityDraft}
            onChange={(e) => setAppCapabilityDraft(e.target.value)}
          />
          <button
            className={actionButtonClass}
            onClick={() => void addCapabilityToPolicyList('defaultAppCapabilities', appCapabilityDraft, () => setAppCapabilityDraft(''))}
          >
            新增
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70">
        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
          globalGrants（全局能力放权规则）
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          仅管理 AI 全局能力规则。
        </div>

        <div className="space-y-2">
          {(visibleCapabilityGrants || []).map((grant) => (
            <div
              key={grant.id}
              className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950 sm:grid-cols-[minmax(0,1fr)_120px_160px_70px]"
            >
              <div className="truncate text-slate-700 dark:text-slate-200">
                {formatCapabilityLabel(grant.capability)}
              </div>
              <UnifiedSelect
                className="rounded-xl px-2 py-1 pr-8 text-xs"
                value={grant.decision}
                onChange={(e) => void patchCapabilityGrant(grant.id, { decision: e.target.value as 'allow' | 'deny' })}
              >
                <option value="allow">allow（允许）</option>
                <option value="deny">deny（拒绝）</option>
              </UnifiedSelect>
              <input
                type="datetime-local"
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                value={toDateTimeLocalValue(grant.expiresAt)}
                onChange={(e) => {
                  const text = e.target.value
                  const parsed = text ? Date.parse(text) : undefined
                  void patchCapabilityGrant(grant.id, { expiresAt: Number.isFinite(parsed || Number.NaN) ? parsed : undefined })
                }}
              />
              <button className={actionButtonClass} onClick={() => void removeCapabilityGrant(grant.id)}>删除</button>
            </div>
          ))}
          {(visibleCapabilityGrants || []).length === 0 && (
            <div className="text-xs text-slate-500 dark:text-slate-400">暂无 global grant 规则。</div>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200">新增 global grant</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <UnifiedSelect
              className="rounded-xl px-2 py-1 pr-8 text-xs"
              value={grantDraft.capability}
              onChange={(e) => setGrantDraft((prev) => ({ ...prev, capability: e.target.value }))}
            >
              {TOOL_CAPABILITY_OPTIONS.map((item) => (
                <option key={`cap-option-${item.value}`} value={item.value}>{item.label}</option>
              ))}
            </UnifiedSelect>
            <UnifiedSelect
              className="rounded-xl px-2 py-1 pr-8 text-xs"
              value={grantDraft.decision}
              onChange={(e) => setGrantDraft((prev) => ({ ...prev, decision: e.target.value as 'allow' | 'deny' }))}
            >
              <option value="allow">allow（允许）</option>
              <option value="deny">deny（拒绝）</option>
            </UnifiedSelect>
            <input
              type="datetime-local"
              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950 sm:col-span-2"
              placeholder="过期时间（可选）"
              value={grantDraft.expiresAt}
              onChange={(e) => setGrantDraft((prev) => ({ ...prev, expiresAt: e.target.value }))}
            />
          </div>
          <div className="flex justify-end">
            <button className={actionButtonClass} onClick={() => void addCapabilityGrant()}>新增 grant</button>
          </div>
        </div>
      </div>
    </div>
  )
}
