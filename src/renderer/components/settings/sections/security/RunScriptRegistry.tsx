import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings } from '../../../../../shared/types/settings'
import { parseListDraft } from '../../utils'
import type { RunScriptDraft } from './types'

interface RunScriptRegistryProps {
  settings: AppSettings
  runScriptDraft: RunScriptDraft
  setRunScriptDraft: Dispatch<SetStateAction<RunScriptDraft>>
  updateAiRunScript: (patch: Partial<AppSettings['aiTooling']['runScript']>) => Promise<void>
  updateRunScriptEntry: (index: number, patch: Partial<AppSettings['aiTooling']['runScript']['entries'][number]>) => Promise<void>
  removeRunScriptEntry: (index: number) => Promise<void>
  addRunScriptEntry: () => Promise<void>
  cardClass: string
  actionButtonClass: string
}

export default function RunScriptRegistry({
  settings,
  runScriptDraft,
  setRunScriptDraft,
  updateAiRunScript,
  updateRunScriptEntry,
  removeRunScriptEntry,
  addRunScriptEntry,
  cardClass,
  actionButtonClass
}: RunScriptRegistryProps) {
  return (
    <div className={`${cardClass} space-y-4`}>
      <div className="space-y-1">
        <div className="text-sm font-medium text-slate-900 dark:text-white">runScript 注册表（预置脚本白名单）</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          仅对 `shell.script` 能力生效；不影响 `shell.exec` 的直接命令执行。
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">默认超时（ms）</div>
          <input
            type="number"
            min={1000}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            value={settings.aiTooling.runScript.defaultTimeoutMs}
            onChange={(e) => void updateAiRunScript({ defaultTimeoutMs: Number(e.target.value || 0) })}
          />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">最大超时（ms）</div>
          <input
            type="number"
            min={5000}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            value={settings.aiTooling.runScript.maxTimeoutMs}
            onChange={(e) => void updateAiRunScript({ maxTimeoutMs: Number(e.target.value || 0) })}
          />
        </label>
      </div>

      <div className="space-y-3">
        {(settings.aiTooling.runScript.entries || []).map((entry, index) => (
          <div key={`script-${entry.id}-${index}`} className="space-y-2 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                placeholder="脚本 ID（scriptId）"
                value={entry.id}
                onChange={(e) => void updateRunScriptEntry(index, { id: e.target.value })}
              />
              <input
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                placeholder="命令（command）"
                value={entry.command}
                onChange={(e) => void updateRunScriptEntry(index, { command: e.target.value })}
              />
              <input
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                placeholder="参数 args（逗号分隔）"
                value={(entry.args || []).join(', ')}
                onChange={(e) => void updateRunScriptEntry(index, { args: parseListDraft(e.target.value) })}
              />
              <input
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                placeholder="工作目录 cwd（可选）"
                value={entry.cwd || ''}
                onChange={(e) => void updateRunScriptEntry(index, { cwd: e.target.value || undefined })}
              />
              <input
                type="number"
                min={1000}
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                placeholder="超时 timeoutMs（可选）"
                value={entry.timeoutMs || ''}
                onChange={(e) => {
                  const num = Number(e.target.value || 0)
                  void updateRunScriptEntry(index, { timeoutMs: Number.isFinite(num) && num > 0 ? num : undefined })
                }}
              />
              <input
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                placeholder="允许环境变量 allowEnvKeys（逗号分隔）"
                value={(entry.allowEnvKeys || []).join(', ')}
                onChange={(e) => void updateRunScriptEntry(index, { allowEnvKeys: parseListDraft(e.target.value) })}
              />
            </div>
            <div className="flex justify-end">
              <button className={actionButtonClass} onClick={() => void removeRunScriptEntry(index)}>删除</button>
            </div>
          </div>
        ))}
        {(settings.aiTooling.runScript.entries || []).length === 0 && (
          <div className="text-xs text-slate-500 dark:text-slate-400">暂无脚本条目。</div>
        )}
      </div>

      <div className="space-y-2 rounded-2xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
        <div className="text-xs text-slate-500 dark:text-slate-400">新增条目</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
            placeholder="脚本 ID（scriptId）"
            value={runScriptDraft.id}
            onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, id: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
            placeholder="命令（command）"
            value={runScriptDraft.command}
            onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, command: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
            placeholder="参数 args（逗号分隔）"
            value={runScriptDraft.args}
            onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, args: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
            placeholder="工作目录 cwd（可选）"
            value={runScriptDraft.cwd}
            onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, cwd: e.target.value }))}
          />
          <input
            type="number"
            min={1000}
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
            placeholder="超时 timeoutMs（可选）"
            value={runScriptDraft.timeoutMs}
            onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, timeoutMs: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
            placeholder="允许环境变量 allowEnvKeys（逗号分隔）"
            value={runScriptDraft.allowEnvKeys}
            onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, allowEnvKeys: e.target.value }))}
          />
        </div>
        <div className="flex justify-end">
          <button className={actionButtonClass} onClick={() => void addRunScriptEntry()}>新增 runScript 条目</button>
        </div>
      </div>
    </div>
  )
}
