import type { Dispatch, SetStateAction } from 'react'
import type { AiToolCapabilityGrant, AppSettings, CommandAuditItem, CommandRule } from '../../../../shared/types/settings'
import type { GrantDraft, RuleDraft, RunScriptDraft } from './security/types'
import CapabilityPolicy from './security/CapabilityPolicy'
import RunScriptRegistry from './security/RunScriptRegistry'
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
  filesystemRootDraft: string
  setFilesystemRootDraft: Dispatch<SetStateAction<string>>
  patchRootDraft: string
  setPatchRootDraft: Dispatch<SetStateAction<string>>
  gitRootDraft: string
  setGitRootDraft: Dispatch<SetStateAction<string>>
  denyHostDraft: string
  setDenyHostDraft: Dispatch<SetStateAction<string>>
  denyCidrDraft: string
  setDenyCidrDraft: Dispatch<SetStateAction<string>>
  denyPrefixDraft: string
  setDenyPrefixDraft: Dispatch<SetStateAction<string>>
  appCapabilityDraft: string
  setAppCapabilityDraft: Dispatch<SetStateAction<string>>
  grantDraft: GrantDraft
  setGrantDraft: Dispatch<SetStateAction<GrantDraft>>
  runScriptDraft: RunScriptDraft
  setRunScriptDraft: Dispatch<SetStateAction<RunScriptDraft>>
  visibleCapabilityGrants: AiToolCapabilityGrant[]
  isDefaultAppCapabilitiesAtDefault: boolean
  reloadSettings: () => Promise<void>
  updateCommandRunner: (patch: Partial<AppSettings['commandRunner']>) => Promise<void>
  updateAiTooling: (patch: Partial<AppSettings['aiTooling']>) => Promise<void>
  updateAiFilesystem: (patch: Partial<AppSettings['aiTooling']['filesystem']>) => Promise<void>
  updateAiHttp: (patch: Partial<AppSettings['aiTooling']['http']>) => Promise<void>
  updateAiRunScript: (patch: Partial<AppSettings['aiTooling']['runScript']>) => Promise<void>
  restoreDefaultAppCapabilities: () => Promise<void>
  removeCapabilityFromPolicyList: (key: 'defaultAppCapabilities', capability: string) => Promise<void>
  addCapabilityToPolicyList: (key: 'defaultAppCapabilities', draft: string, reset: () => void) => Promise<void>
  addCapabilityGrant: () => Promise<void>
  removeCapabilityGrant: (grantId: string) => Promise<void>
  patchCapabilityGrant: (grantId: string, patch: Partial<AiToolCapabilityGrant>) => Promise<void>
  addFilesystemRoot: () => Promise<void>
  removeFilesystemRoot: (value: string) => Promise<void>
  addPatchRoot: () => Promise<void>
  removePatchRoot: (value: string) => Promise<void>
  addGitRoot: () => Promise<void>
  removeGitRoot: (value: string) => Promise<void>
  addHttpDenyHost: () => Promise<void>
  removeHttpDenyHost: (value: string) => Promise<void>
  addHttpDenyCidr: () => Promise<void>
  removeHttpDenyCidr: (value: string) => Promise<void>
  addHttpDenyPrefix: () => Promise<void>
  removeHttpDenyPrefix: (value: string) => Promise<void>
  updateRunScriptEntry: (index: number, patch: Partial<AppSettings['aiTooling']['runScript']['entries'][number]>) => Promise<void>
  removeRunScriptEntry: (index: number) => Promise<void>
  addRunScriptEntry: () => Promise<void>
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
  filesystemRootDraft,
  setFilesystemRootDraft,
  patchRootDraft,
  setPatchRootDraft,
  gitRootDraft,
  setGitRootDraft,
  denyHostDraft,
  setDenyHostDraft,
  denyCidrDraft,
  setDenyCidrDraft,
  denyPrefixDraft,
  setDenyPrefixDraft,
  appCapabilityDraft,
  setAppCapabilityDraft,
  grantDraft,
  setGrantDraft,
  runScriptDraft,
  setRunScriptDraft,
  visibleCapabilityGrants,
  isDefaultAppCapabilitiesAtDefault,
  reloadSettings,
  updateCommandRunner,
  updateAiTooling,
  updateAiFilesystem,
  updateAiHttp,
  updateAiRunScript,
  restoreDefaultAppCapabilities,
  removeCapabilityFromPolicyList,
  addCapabilityToPolicyList,
  addCapabilityGrant,
  removeCapabilityGrant,
  patchCapabilityGrant,
  addFilesystemRoot,
  removeFilesystemRoot,
  addPatchRoot,
  removePatchRoot,
  addGitRoot,
  removeGitRoot,
  addHttpDenyHost,
  removeHttpDenyHost,
  addHttpDenyCidr,
  removeHttpDenyCidr,
  addHttpDenyPrefix,
  removeHttpDenyPrefix,
  updateRunScriptEntry,
  removeRunScriptEntry,
  addRunScriptEntry,
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

  <div className={`${cardClass} space-y-4`}>
    <div className="text-sm font-medium text-slate-900 dark:text-white">AI 内置工具总开关</div>
    <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800/80">
      <div>
        <div className="text-sm text-slate-900 dark:text-white">启用 aiTooling</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">关闭后将拒绝所有内置工具（read/list/search/patch/http/script/git）</div>
      </div>
      <button
        className={`relative w-11 h-6 rounded-full transition-colors ${settings.aiTooling.enabled
          ? 'bg-blue-500'
          : 'bg-gray-300 dark:bg-gray-600'
          }`}
        onClick={() => void updateAiTooling({ enabled: !settings.aiTooling.enabled })}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.aiTooling.enabled ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">filesystem 最大读取（bytes）</div>
        <input
          type="number"
          min={1024}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.aiTooling.filesystem.maxReadBytes}
          onChange={(e) => void updateAiFilesystem({ maxReadBytes: Number(e.target.value || 0) })}
        />
      </label>
      <label className="space-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">filesystem 搜索命中上限</div>
        <input
          type="number"
          min={10}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.aiTooling.filesystem.maxSearchHits}
          onChange={(e) => void updateAiFilesystem({ maxSearchHits: Number(e.target.value || 0) })}
        />
      </label>
    </div>
  </div>

  <CapabilityPolicy
    settings={settings}
    visibleCapabilityGrants={visibleCapabilityGrants}
    isDefaultAppCapabilitiesAtDefault={isDefaultAppCapabilitiesAtDefault}
    appCapabilityDraft={appCapabilityDraft}
    setAppCapabilityDraft={setAppCapabilityDraft}
    grantDraft={grantDraft}
    setGrantDraft={setGrantDraft}
    restoreDefaultAppCapabilities={restoreDefaultAppCapabilities}
    removeCapabilityFromPolicyList={removeCapabilityFromPolicyList}
    addCapabilityToPolicyList={addCapabilityToPolicyList}
    addCapabilityGrant={addCapabilityGrant}
    removeCapabilityGrant={removeCapabilityGrant}
    patchCapabilityGrant={patchCapabilityGrant}
    cardClass={cardClass}
    actionButtonClass={actionButtonClass}
    pillClass={pillClass}
  />

  <div className={`${cardClass} space-y-4`}>
    <div className="text-sm font-medium text-slate-900 dark:text-white">路径白名单（allowedRoots / allowedRepoRoots）</div>
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">filesystem.allowedRoots（文件读取/检索范围）</div>
        <div className="space-y-2">
          {(settings.aiTooling.filesystem.allowedRoots || []).map((item) => (
            <div key={`fs-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
              <div className="truncate">{item}</div>
              <button className={actionButtonClass} onClick={() => void removeFilesystemRoot(item)}>删除</button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
          <input
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="新增路径，支持逗号或换行批量"
            value={filesystemRootDraft}
            onChange={(e) => setFilesystemRootDraft(e.target.value)}
          />
          <button className={actionButtonClass} onClick={() => void addFilesystemRoot()}>新增</button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">patch.allowedRoots（补丁应用范围）</div>
        <div className="space-y-2">
          {(settings.aiTooling.patch.allowedRoots || []).map((item) => (
            <div key={`patch-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
              <div className="truncate">{item}</div>
              <button className={actionButtonClass} onClick={() => void removePatchRoot(item)}>删除</button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
          <input
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="新增路径，支持逗号或换行批量"
            value={patchRootDraft}
            onChange={(e) => setPatchRootDraft(e.target.value)}
          />
          <button className={actionButtonClass} onClick={() => void addPatchRoot()}>新增</button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">git.allowedRepoRoots（Git 仓库范围）</div>
        <div className="space-y-2">
          {(settings.aiTooling.git.allowedRepoRoots || []).map((item) => (
            <div key={`git-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
              <div className="truncate">{item}</div>
              <button className={actionButtonClass} onClick={() => void removeGitRoot(item)}>删除</button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
          <input
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="新增路径，支持逗号或换行批量"
            value={gitRootDraft}
            onChange={(e) => setGitRootDraft(e.target.value)}
          />
          <button className={actionButtonClass} onClick={() => void addGitRoot()}>新增</button>
        </div>
      </div>
    </div>
  </div>

  <div className={`${cardClass} space-y-4`}>
    <div className="text-sm font-medium text-slate-900 dark:text-white">HTTP 黑名单与限制</div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">超时（ms）</div>
        <input
          type="number"
          min={1000}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.aiTooling.http.timeoutMs}
          onChange={(e) => void updateAiHttp({ timeoutMs: Number(e.target.value || 0) })}
        />
      </label>
      <label className="space-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">响应体上限（bytes）</div>
        <input
          type="number"
          min={1024}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={settings.aiTooling.http.maxResponseBytes}
          onChange={(e) => void updateAiHttp({ maxResponseBytes: Number(e.target.value || 0) })}
        />
      </label>
    </div>

    <div className="space-y-2">
      <div className="text-xs text-slate-500 dark:text-slate-400">denyHosts（拒绝访问的域名）</div>
      {(settings.aiTooling.http.denyHosts || []).map((item) => (
        <div key={`deny-host-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
          <div className="truncate">{item}</div>
          <button className={actionButtonClass} onClick={() => void removeHttpDenyHost(item)}>删除</button>
        </div>
      ))}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
        <input
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          placeholder="例如 localhost, example.com"
          value={denyHostDraft}
          onChange={(e) => setDenyHostDraft(e.target.value)}
        />
        <button className={actionButtonClass} onClick={() => void addHttpDenyHost()}>新增</button>
      </div>
    </div>

    <div className="space-y-2">
      <div className="text-xs text-slate-500 dark:text-slate-400">denyCidrs（拒绝访问的网段）</div>
      {(settings.aiTooling.http.denyCidrs || []).map((item) => (
        <div key={`deny-cidr-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
          <div className="truncate">{item}</div>
          <button className={actionButtonClass} onClick={() => void removeHttpDenyCidr(item)}>删除</button>
        </div>
      ))}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
        <input
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          placeholder="例如 127.0.0.0/8"
          value={denyCidrDraft}
          onChange={(e) => setDenyCidrDraft(e.target.value)}
        />
        <button className={actionButtonClass} onClick={() => void addHttpDenyCidr()}>新增</button>
      </div>
    </div>

    <div className="space-y-2">
      <div className="text-xs text-slate-500 dark:text-slate-400">denyUrlPrefixes（拒绝访问的 URL 前缀）</div>
      {(settings.aiTooling.http.denyUrlPrefixes || []).map((item) => (
        <div key={`deny-prefix-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
          <div className="truncate">{item}</div>
          <button className={actionButtonClass} onClick={() => void removeHttpDenyPrefix(item)}>删除</button>
        </div>
      ))}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
        <input
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          placeholder="例如 https://internal.example.com/"
          value={denyPrefixDraft}
          onChange={(e) => setDenyPrefixDraft(e.target.value)}
        />
        <button className={actionButtonClass} onClick={() => void addHttpDenyPrefix()}>新增</button>
      </div>
    </div>
  </div>

  <RunScriptRegistry
    settings={settings}
    runScriptDraft={runScriptDraft}
    setRunScriptDraft={setRunScriptDraft}
    updateAiRunScript={updateAiRunScript}
    updateRunScriptEntry={updateRunScriptEntry}
    removeRunScriptEntry={removeRunScriptEntry}
    addRunScriptEntry={addRunScriptEntry}
    cardClass={cardClass}
    actionButtonClass={actionButtonClass}
  />

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
