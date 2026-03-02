interface AiSettingsStatusPanelsProps {
  hasProviderBlockingIssues: boolean
  aiReasoning: string | null
}

export default function AiSettingsStatusPanels({ hasProviderBlockingIssues, aiReasoning }: AiSettingsStatusPanelsProps) {
  if (!hasProviderBlockingIssues && !aiReasoning) return null

  return (
    <div className="shrink-0 space-y-4 pb-4">
      {hasProviderBlockingIssues && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          检测到 Provider 配置问题（重复实例 ID 或缺少 API Key / Base URL），请先修复后再保存。
        </div>
      )}
      {aiReasoning && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-xs text-slate-600 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-300">
          <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">思考过程</div>
          <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{aiReasoning}</div>
        </div>
      )}
    </div>
  )
}
